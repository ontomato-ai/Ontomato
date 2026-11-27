import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import type { ProductOwner } from "../product-governance/service-authentication";
import type {
  JavaPanelRead, JavaPanelReadResult, PanelReadRanges, PanelReadVisibility, PreparedOwnerReadFacts,
} from "./java-panel-reads";
import type { PanelReadBatchCache } from "./member-path";
import type { PanelReadSelection } from "./panel-owner-reads";

export interface RegisteredDataReadContext {
  owner: ProductOwner;
  credentials: AssistantCredentials;
  selection: PanelReadSelection;
  params: Record<string, unknown>;
  inputs: Readonly<Record<string, unknown>>;
  projection: ProductProjection;
  cache: PanelReadBatchCache;
  location?: { protocol: string; headers: Record<string, unknown> };
}

export interface RegisteredOwnerReadPlan {
  call?: RegisteredJavaCall;
  visibility?: readonly PanelReadVisibility[];
  present(payload: unknown, ranges: PanelReadRanges | undefined): unknown | Promise<unknown>;
  rowOperations?(
    payload: unknown, inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[],
  ): Promise<PanelRowOperationsMap | undefined>;
}

export interface RegisteredLocalDataRead {
  visibility?: readonly PanelReadVisibility[];
  /** A mixed owner also needs its Java facts in the same batch item. */
  readJavaFacts?: true;
  /** Cache this local read's result inside one registered batch. */
  cache?: true;
  read(owner: ProductOwner, ranges: PanelReadRanges | undefined, javaFacts: unknown,
    credentials: AssistantCredentials, primaryKey: string | undefined, params: Record<string, unknown>): unknown | Promise<unknown>;
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

export type RegisteredJavaCall = Omit<NonNullable<JavaPanelRead["call"]>, "parameters"> & { parameters: Record<string, unknown> };

export interface RegisteredDataReadRegistration {
  /** Platform reads are exact type and method pairs; customer object reads use kind without a fixed type id. */
  typeId?: string;
  method?: string;
  kind?: "customer";
  validate?(context: RegisteredDataReadContext): void | Promise<void>;
  prepare?(context: RegisteredDataReadContext): RegisteredOwnerReadPlan | undefined | Promise<RegisteredOwnerReadPlan | undefined>;
  facts?(context: RegisteredDataReadContext): PreparedOwnerReadFacts | undefined | Promise<PreparedOwnerReadFacts | undefined>;
  local?: RegisteredLocalDataRead;
  javaCall?(context: RegisteredDataReadContext): RegisteredJavaCall | Promise<RegisteredJavaCall>;
  present?(payload: unknown, context: RegisteredDataReadContext): unknown | Promise<unknown>;
  messageOnlyCodes?: readonly string[];
  errorMessage?(result: Extract<JavaPanelReadResult, { status: "error" }>, context: RegisteredDataReadContext): string | undefined;
  /** Customer owner failures are presented like direct member-read failures. */
  memberReadRefusal?: true;
}

export function registeredDataReadKey(typeId: string, method: string) {
  return `${typeId}.${method}`;
}

export function presentedRegisteredDataRead(
  typeId: string, method: string,
  factory: (locale?: string) => object,
): RegisteredDataReadRegistration {
  return {
    typeId, method,
    present(payload, context) {
      const presenters = factory(context.credentials.locale) as Partial<Record<string, (value: unknown, params: Record<string, unknown>) => unknown>>;
      const render = presenters[method]!;
      return render(payload, { ...context.params, primaryKey: context.selection.primaryKey! });
    },
  };
}
