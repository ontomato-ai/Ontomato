import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import type { ProductOwner } from "../product-governance/service-authentication";
import { HttpError } from "../../utils/errors";
import type {
  JavaPanelRead, JavaPanelReadResult, JavaPanelViewer, PanelReadRanges, PanelReadVisibility, PreparedOwnerReadFacts,
} from "./java-panel-reads";
import type { PanelReadBatchCache } from "./member-path";
import { unwrapReadDirective, withReadDirective } from "./read-directive";
import type { PanelReadSelection } from "./panel-owner-reads";

export interface RegisteredDataReadContext {
  owner: ProductOwner;
  credentials: AssistantCredentials;
  selection: PanelReadSelection;
  params: Record<string, unknown>;
  inputs: Readonly<Record<string, unknown>>;
  projection: ProductProjection;
  cache: PanelReadBatchCache;
  /** The viewer identity returned by the Java read batch, when presentment happens after that batch. */
  javaViewer?: JavaPanelViewer;
  location?: { protocol: string; headers: Record<string, unknown> };
  /** The operations, among those the registration carries, whose facts this page's rows need from this read. */
  rowOperations: readonly string[];
}

export interface RegisteredOwnerReadPlan {
  call?: RegisteredJavaCall;
  visibility?: readonly PanelReadVisibility[];
  present(payload: unknown, ranges: PanelReadRanges | undefined): unknown | Promise<unknown>;
}

export interface RegisteredLocalDataRead {
  visibility?: readonly PanelReadVisibility[];
  /** A mixed owner also needs its Java facts in the same batch item. */
  readJavaFacts?: true;
  read(owner: ProductOwner, ranges: PanelReadRanges | undefined, javaFacts: unknown,
    credentials: AssistantCredentials, primaryKey: string | undefined, params: Record<string, unknown>): unknown | Promise<unknown>;
}

export type RegisteredJavaCall = Omit<NonNullable<JavaPanelRead["call"]>, "parameters"> & { parameters: Record<string, unknown> };

export interface RegisteredDataReadItem {
  call?: RegisteredJavaCall;
  visibleKinds?: readonly PanelReadVisibility[];
}

export function javaReadItem(item: RegisteredDataReadItem): Pick<JavaPanelRead, "call" | "visibleKinds"> {
  return {
    ...(item.visibleKinds && { visibleKinds: item.visibleKinds }),
    ...(item.call && { call: { ...item.call, parameters: runtimeJsonObjectSchema.parse(item.call.parameters) } }),
  };
}

/** An operation's facts for one row's target, as the list read carried them back. */
export type CarriedRowFacts = (operation: string, target: { objectType: string; primaryKey: string }) => unknown;

/** The only read shape a registration contributes to the platform. */
export interface RegisteredDataReadPlan {
  reads: readonly RegisteredDataReadItem[];
  present(results: readonly JavaPanelReadResult[], context: RegisteredDataReadContext): unknown | Promise<unknown>;
  /** The facts of `context.rowOperations` this read carried back, by each row's target. */
  rowFacts?(results: readonly JavaPanelReadResult[]): CarriedRowFacts;
}

export interface RegisteredDataReadRegistration {
  /** Platform reads are exact type and method pairs; customer object reads use kind without a fixed type id. */
  typeId?: string;
  method?: string;
  kind?: "customer";
  /**
   * Operations whose availability facts this list can carry back for its rows: the same facts the operation's own read
   * gives, so the operation's rule decides. The platform asks only for the ones a page needs, in `rowOperations`.
   */
  carries?: readonly string[];
  plan(context: RegisteredDataReadContext): RegisteredDataReadPlan | Promise<RegisteredDataReadPlan>;
}

/**
 * A present function uses this already-shaped failure to choose the exact browser response for a non-ready read item.
 * Outside a panel read response it is the matching HTTP refusal.
 */
export class RegisteredDataReadFailure extends HttpError {
  constructor(readonly response: ProductPanelReadResponse) {
    super(
      response.status === "forbidden" ? 403 : response.status === "empty" ? 404 : 422,
      response.status === "forbidden" ? response.reason ?? response.status : response.status === "error" ? response.message : response.status,
      response.status === "error" ? response.code : undefined,
    );
  }
}

function resultError(message: string, code: string | null | undefined, messageOnlyCodes?: readonly string[]): ProductPanelReadResponse {
  const messageOnly = code && messageOnlyCodes?.includes(code);
  return { status: "error", message, ...(code && !messageOnly && { code }) };
}

export type ContextualReadyPayloadOptions = ReadyPayloadOptions | ((context: RegisteredDataReadContext) => ReadyPayloadOptions);

export interface ReadyPayloadOptions {
  messageOnlyCodes?: readonly string[];
  errorMessage?(result: Extract<JavaPanelReadResult, { status: "error" }>): string | undefined;
}

function contextualReadyOptions(options: ContextualReadyPayloadOptions | undefined, context: RegisteredDataReadContext): ReadyPayloadOptions | undefined {
  return typeof options === "function" ? options(context) : options;
}

export function readyPayload(
  result: JavaPanelReadResult,
  options: ReadyPayloadOptions = {},
): { payload: unknown; visibility: PanelReadRanges | undefined } {
  if (result.status === "ready") return { payload: result.payload, visibility: result.visibility };
  if (result.status === "empty") throw new RegisteredDataReadFailure({ status: "empty" });
  if (result.status === "forbidden") throw new RegisteredDataReadFailure({ status: "forbidden", reason: result.error });
  const message = options.errorMessage?.(result) ?? result.error;
  throw new RegisteredDataReadFailure(resultError(message, result.code, options.messageOnlyCodes));
}

function rethrowMessageOnlyHttpError(error: unknown, options: ContextualReadyPayloadOptions | undefined, context: RegisteredDataReadContext): never {
  const messageOnlyCodes = contextualReadyOptions(options, context)?.messageOnlyCodes;
  if (error instanceof HttpError && error.code && messageOnlyCodes?.includes(error.code))
    throw new RegisteredDataReadFailure({ status: "error", message: error.message });
  throw error;
}

export function defaultRegisteredJavaCall({ selection, params }: RegisteredDataReadContext): RegisteredJavaCall {
  return {
    type: selection.typeId,
    name: selection.method,
    parameters: {
      ...params,
      ...(selection.primaryKey !== undefined && { primaryKey: selection.primaryKey }),
    },
  };
}

/** Adapt an owner read implementation to the single registered plan shape. */
export function ownerReadPlan(ownerRead: RegisteredOwnerReadPlan, readyOptions?: ContextualReadyPayloadOptions): RegisteredDataReadPlan {
  return {
    reads: [{
      ...(ownerRead.call && { call: ownerRead.call }),
      ...(ownerRead.visibility && { visibleKinds: ownerRead.visibility }),
    }],
    present: (results, _context) => {
      const { payload, visibility } = readyPayload(results[0], contextualReadyOptions(readyOptions, _context));
      return ownerRead.present(payload, visibility);
    },
  };
}

/** Adapt a multi-fact owner implementation to the single registered plan shape. */
export function ownerFactsPlan(facts: PreparedOwnerReadFacts, readyOptions?: ContextualReadyPayloadOptions): RegisteredDataReadPlan {
  return {
    reads: [{}, ...facts.facts],
    async present(results, context) {
      readyPayload(results[0], contextualReadyOptions(readyOptions, context));
      try {
        return await facts.present(context.javaViewer ?? context.owner, results.slice(1));
      } catch (error) {
        rethrowMessageOnlyHttpError(error, readyOptions, context);
      }
    },
  };
}

/** Adapt a Node-local read implementation to the single registered plan shape. */
export function localReadPlan(
  context: RegisteredDataReadContext,
  local: RegisteredLocalDataRead,
  call?: RegisteredJavaCall,
  readyOptions?: ContextualReadyPayloadOptions,
): RegisteredDataReadPlan {
  const javaCall = call ?? (local.readJavaFacts ? defaultRegisteredJavaCall(context) : undefined);
  return {
    reads: [{
      ...(javaCall && { call: javaCall }),
      ...(local.visibility && { visibleKinds: local.visibility }),
    }],
    present: async results => {
      const { payload, visibility } = readyPayload(results[0], contextualReadyOptions(readyOptions, context));
      return local.read(context.owner, visibility, payload, context.credentials, context.selection.primaryKey, context.params);
    },
  };
}

export function ownerReadRegistration(
  typeId: string, method: string,
  prepare: (context: RegisteredDataReadContext) => RegisteredOwnerReadPlan | undefined | Promise<RegisteredOwnerReadPlan | undefined>,
  readyOptions?: ContextualReadyPayloadOptions,
): RegisteredDataReadRegistration {
  return { typeId, method, plan: async context => ownerReadPlan((await prepare(context))!, readyOptions) };
}

export function ownerFactsRegistration(
  typeId: string, method: string,
  facts: (context: RegisteredDataReadContext) => PreparedOwnerReadFacts | undefined | Promise<PreparedOwnerReadFacts | undefined>,
  readyOptions?: ContextualReadyPayloadOptions,
): RegisteredDataReadRegistration {
  return { typeId, method, plan: async context => ownerFactsPlan((await facts(context))!, readyOptions) };
}

export function localReadRegistration(
  typeId: string, method: string,
  local: RegisteredLocalDataRead,
  call?: (context: RegisteredDataReadContext) => RegisteredJavaCall | Promise<RegisteredJavaCall>,
  readyOptions?: ContextualReadyPayloadOptions,
): RegisteredDataReadRegistration {
  return { typeId, method, plan: async context => localReadPlan(context, local, call && await call(context), readyOptions) };
}

export function managedRegisteredOpsRead<Adapter>(
  adapter: (owner: ProductOwner, locale: string | undefined, facts: unknown) => Adapter,
  read: (adapter: Adapter, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalDataRead {
  return {
    readJavaFacts: true,
    read: (owner, _ranges, facts, credentials, primaryKey, params) =>
      read(adapter(owner, credentials.locale, facts), primaryKey!, params),
  };
}

export function registeredDataReadKey(typeId: string, method: string) {
  return `${typeId}.${method}`;
}

/** Render the value inside a read directive envelope and carry that envelope's directives through presentment. */
export async function renderReadPayload(payload: unknown, render: (value: unknown) => unknown | Promise<unknown>) {
  const { value, directive } = unwrapReadDirective(payload);
  const rendered = await render(value);
  return directive ? withReadDirective(rendered, directive) : rendered;
}

export function defaultReadRegistration(
  typeId: string, method: string, readyOptions?: ContextualReadyPayloadOptions,
  validate?: (context: RegisteredDataReadContext) => void,
): RegisteredDataReadRegistration {
  return {
    typeId, method,
    plan: context => {
      validate?.(context);
      return {
        reads: [{ call: defaultRegisteredJavaCall(context) }],
        present: results => readyPayload(results[0], contextualReadyOptions(readyOptions, context)).payload,
      };
    },
  };
}

export function presentedRegisteredDataRead(
  typeId: string, method: string,
  factory: (locale?: string) => object,
  validate?: (context: RegisteredDataReadContext) => void,
  readyOptions?: ContextualReadyPayloadOptions,
  call?: (context: RegisteredDataReadContext) => RegisteredJavaCall,
): RegisteredDataReadRegistration {
  return {
    typeId, method,
    plan(context) {
      validate?.(context);
      return {
        reads: [{ call: (call ?? defaultRegisteredJavaCall)(context) }],
        present(results) {
          const { payload } = readyPayload(results[0], contextualReadyOptions(readyOptions, context));
          const presenters = factory(context.credentials.locale) as Partial<Record<string, (value: unknown, params: Record<string, unknown>) => unknown>>;
          const render = presenters[method]!;
          return renderReadPayload(payload, value => render(value, { ...context.params, primaryKey: context.selection.primaryKey! }));
        },
      };
    },
  };
}
