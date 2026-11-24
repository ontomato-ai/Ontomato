import type { PanelUploadReceipt } from "@ontomato/contracts/panel-upload";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { computed, nextTick, reactive, readonly, shallowReactive, shallowRef, type ComputedRef, type DeepReadonly, type Ref } from "vue";
import type { PageContext, PageFormSnapshot, PageHighlight } from "@ontomato/contracts/page-context";
import {
  panelOpenRequestSchema, panelOperationId, type PanelDeepLinkStateValue, type PanelManifest, type PanelMemberPath, type PanelOperationCall,
  type PanelStateValue,
} from "@ontomato/contracts/panel-manifest";
import type {
  ExpectedPageTarget,
  FormFillOutcome,
  FormFillRequestInput,
  PageActionConfirmedDispatchResult,
  PageActionOutcome,
  PageActionRequestInput,
  PendingPageActionConfirmation,
} from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { randomId } from "@ontomato/contracts/random-id";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  childObjectNameKey, createPanelState, objectNameKey, panelSelection, stateObject, stateObjects, type PanelInitialState, type PanelObjectRef,
  type PanelStateStore,
} from "./state";
import type { PanelText } from "./text";
import { panelOperations } from "./operations";
import { memberInputValue, type PanelProjectionRegistration } from "./ports";
import { PanelFormAdapters } from "./forms";
import { handlerFor } from "./handlers";
import type { PanelOperationBinding } from "./types";
import type { AppBridgeConfirmPanelOperationResult } from "@ontomato/contracts/app-bridge";
import {
  classifyPanelOperationDispatch,
  type PanelAgentRunRef,
  type PanelHumanOperationDispatchResponse,
  type PanelHumanOperationPreparation,
} from "@ontomato/contracts/panel-agent";
import type { PanelCompletedOperation, PanelOperationAffected, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type {
  ConfirmPanelOperation,
  PanelHumanOperations,
  PanelLocalConfirmationClaimResponse,
  PanelLocalConfirmationRequest,
  PanelLocalConfirmationResponse,
  PanelOperationDescriptor,
  PanelReadCall,
  PanelWriteInvocation,
} from "./human-operations";
import {
  PanelSubmissionStaleError,
  verifySubmissionUnchanged,
  type SubmissionCheckResult,
  type SubmissionEvaluator,
} from "./operation-binding";

/*
 * One panel instance's runtime (overall design 3.4): its state, the projections it registered, the operations it offers,
 * the draft its address named, and the page context a message carries. A panel author declares state and composition
 * and places `<Projection>` elements; none of this is written per panel.
 *
 * The three things that make it one instance and not another: its own state, its own registered projections, and its own
 * page context projected from that state.
 */

/** What an instance needs from the platform: the reader's request path, and the panel's own key and address. */
export interface PanelInstanceOptions {
  /** The page's registration key: the application use's pageKey. */
  pageKey: string;
  url: () => string;
  label: () => string;
  initial?: PanelInitialState;
  /** Reads a current projection by ID, as the reader. */
  readProjection: (id: string) => Promise<ProductProjection>;
  /** Translates platform message keys (such as object-union type display names) in the current locale. */
  translate?: (key: string, params?: Readonly<Record<string, string>>) => string;
  /** The panel's own words (its content's messages) in the current language: what a state operation is called. */
  text: PanelText;
  /** The platform's coordinator, which runs this panel's operations as the reader. */
  operations: PanelHumanOperations;
  /** The host's confirmation and single dispatch of a prepared write. */
  confirmOperation: ConfirmPanelOperation;
  /**
   * Where this instance sits in the panel the reader opened (a panel placed from another's state), or nothing for the
   * opened panel itself: every member path, operation ID and page-context selection of this instance starts with it.
   */
  memberPath?: PanelMemberPath;
  /** A member's segment of a path: its key, with the selection that placed it where the panel's state chose it. */
  segmentOf?: (member: string) => PanelMemberPath[number];
}

/** A path that names at least one member: a nested publisher's, as the platform finds its operations by. */
export type PublisherPath = [PanelMemberPath[number], ...PanelMemberPath];

/** Per-invocation agent context passed explicitly down a single `page_action` call chain. */
export interface PanelAgentActionContext {
  readonly agentRun: PanelAgentRunRef;
  completed?: {
    readonly intentId: string;
    readonly response: PanelHumanOperationDispatchResponse;
  };
}

/** Explicit overrides for write operations (`memberPath`, lifecycle hooks, and per-call agent context). */
export interface PanelWriteOperationOptions {
  memberPath?: PanelMemberPath;
  /** Called right after confirmation passes (or immediately when no confirmation is required), before dispatch begins. */
  onConfirmed?: () => void;
  /** Present only when this write was initiated by an agent `page_action` call. */
  agentContext?: PanelAgentActionContext;
  /**
   * Recomputes the live 4-tuple `(instanceId, operationId, target, payload)` for this UI entry so both
   * default confirmation and full-auto pre-dispatch verify through the single universal check.
   */
  evaluateSubmission?: SubmissionEvaluator;
}

/** Thrown internally by `writeOperation` when an agent-initiated write awaits default conversation confirmation. */
export class PanelOperationDeferred extends Error {
  readonly preparation: PanelHumanOperationPreparation;
  readonly named: PanelWriteResult["named"];
  readonly isStillValid: () => SubmissionCheckResult;
  readonly dispatchNow: () => Promise<AppBridgeConfirmPanelOperationResult>;
  readonly cancelNow: (reason: { readonly code: string; readonly message: string }) => Promise<void>;
  constructor(input: {
    preparation: PanelHumanOperationPreparation;
    named: PanelWriteResult["named"];
    isStillValid: () => SubmissionCheckResult;
    dispatchNow: () => Promise<AppBridgeConfirmPanelOperationResult>;
    cancelNow: (reason: { readonly code: string; readonly message: string }) => Promise<void>;
  }) {
    super("Operation awaiting conversation confirmation");
    this.name = "PanelOperationDeferred";
    this.preparation = input.preparation;
    this.named = input.named;
    this.isStillValid = input.isStillValid;
    this.dispatchNow = input.dispatchNow;
    this.cancelNow = input.cancelNow;
  }
}

/** Thrown by a component after wrapping `PanelOperationDeferred` with its own live guard and post-dispatch settlement. */
export class PanelConfirmationDeferred extends Error {
  readonly confirmation: PendingPageActionConfirmation;
  constructor(confirmation: PendingPageActionConfirmation) {
    super("Operation confirmation prepared by mounted component");
    this.name = "PanelConfirmationDeferred";
    this.confirmation = confirmation;
  }
}

/** Result returned by a mounted component action handler registered on `PanelInstance`. */
export type PanelMountedActionResult =
  | { readonly ok: true; readonly outcome?: unknown }
  | { readonly ok: true; readonly confirmation: PendingPageActionConfirmation }
  | {
      readonly ok: false;
      readonly reason: "unknown";
      readonly outcome?: unknown;
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "action_not_found"
        | "action_unavailable"
        | "action_not_ready"
        | "input_required"
        | "validation_failed"
        | "cancelled"
        | "stale"
        | "partial"
        | "failed";
      readonly code?: string;
      readonly savedFields?: readonly string[];
      readonly outcome?: unknown;
      readonly message?: string;
    };

export type PanelMountedActionHandler = (request: {
  readonly rowKey?: string;
  readonly input?: Readonly<Record<string, RuntimeJsonValue>>;
  readonly expectedEntryInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
  readonly expectedCheckedKeys?: readonly string[];
  readonly agentContext?: PanelAgentActionContext;
}) => Promise<PanelMountedActionResult>;

/** Formats a concise human/agent summary of a dispatched panel operation response. */
export function summarizeDispatchResponse(response: PanelHumanOperationDispatchResponse): string {
  const classified = classifyPanelOperationDispatch(response);
  if (classified.kind === "executed" || classified.kind === "partial") return classified.summary;
  return classified.message;
}

/**
 * Classifies an authoritative dispatch response for a mounted `page_action` handler using the single
 * shared `@ontomato/contracts/panel-agent` classifier so live receipts and server timeout recovery match.
 */
export function classifyDispatchResponseForAction(
  response: PanelHumanOperationDispatchResponse,
): PanelMountedActionResult {
  const classified = classifyPanelOperationDispatch(response);
  if (classified.kind === "executed") {
    return { ok: true, outcome: classified.outcome };
  }
  if (classified.kind === "partial") {
    return {
      ok: false,
      reason: "partial",
      code: classified.code,
      ...(classified.savedFields?.length ? { savedFields: classified.savedFields } : {}),
      outcome: classified.outcome,
      message: classified.message,
    };
  }
  if (classified.kind === "unknown") {
    return {
      ok: false,
      reason: "unknown",
      ...(classified.outcome !== undefined ? { outcome: classified.outcome } : {}),
      message: classified.message,
    };
  }
  return {
    ok: false,
    reason: "failed",
    code: classified.code,
    ...(classified.outcome !== undefined ? { outcome: classified.outcome } : {}),
    message: classified.message,
  };
}

/** Classifies an authoritative dispatch response after the user approves a deferred confirmation in chat. */
export function classifyDispatchResponseForConfirmation(
  intentId: string,
  response: PanelHumanOperationDispatchResponse,
): PageActionConfirmedDispatchResult {
  if (response.kind === "not-dispatched") {
    return { ok: false, intentId, reason: "not_dispatched", code: response.code, message: response.message };
  }
  const classified = classifyPanelOperationDispatch(response, intentId);
  if (classified.kind === "executed") {
    return {
      ok: true,
      intentId,
      outcome: classified.outcome,
      summary: classified.summary,
    };
  }
  if (classified.kind === "partial") {
    return {
      ok: false,
      intentId,
      reason: "partial",
      code: classified.code,
      ...(classified.savedFields?.length ? { savedFields: classified.savedFields } : {}),
      outcome: classified.outcome,
      message: classified.summary,
    };
  }
  if (classified.kind === "unknown") {
    return {
      ok: false,
      intentId,
      reason: "unknown",
      code: classified.code,
      message: classified.message,
    };
  }
  return {
    ok: false,
    intentId,
    reason: "failed",
    code: classified.code,
    message: classified.message,
  };
}

/** What a panel placed in one of an instance's members publishes into it: its operations, its unsaved changes. */
export interface NestedPublisher {
  readonly instanceId: string;
  formRegistries(): PanelFormAdapters[];
  readonly operations: readonly PanelOperationBinding[];
  dirty(): boolean;
  readonly context: PageContext | null;
  memberInstances?(): Readonly<Record<string, string>>;
  entryInstances?(): Readonly<Record<string, string>>;
  checkedKeys?(): Readonly<Record<string, readonly string[]>>;
  isLoading?(): boolean;
  fillForm?(request: FormFillRequestInput): Promise<FormFillOutcome>;
  executeAction?(request: PageActionRequestInput): Promise<PageActionOutcome>;
}

/** A completed panel write operation reported by the host. */
export interface PanelOperationCompletion {
  readonly operation: PanelCompletedOperation;
  readonly affected?: PanelOperationAffected;
}

export interface PanelInstance {
  /** Unique immutable identifier for this mounted panel instance; changes on remount or nested member swap. */
  readonly instanceId: string;
  /** True once this panel instance has been disposed/unmounted. */
  isDisposed(): boolean;
  /** Marks this panel instance as disposed so any pending confirmation or full-auto dispatch is invalidated. */
  markDisposed(): void;
  readonly manifest: PanelManifest;
  readonly state: PanelStateStore;
  // A computed context, read only at its top: a deep read-only type of it recurses through the member paths' JSON values
  // (a nested panel's selection) without end.
  readonly pageContext: ComputedRef<PageContext>;
  /** Computed afresh from the registered projections; a reader never changes it. */
  readonly operations: Readonly<Ref<readonly PanelOperationBinding[]>>;
  /** A member handed over a value at one of its outputs: the state field the member binds it to takes it. */
  output(member: string, output: string, value: RuntimeJsonValue): void;
  /**
   * One parameter of a member, as its component reads and sets it: the panel state the member binds it to (its input of
   * that name, else its output of that name), or, unbound, the member's own value, which lives in this member alone.
   */
  memberParam(member: string, name: string): { readonly value: ComputedRef<RuntimeJsonValue | null>; set(value: RuntimeJsonValue | null): void };
  /** The values a member's component set for parameters bound to no state, by name. */
  ownParams(member: string): Readonly<Record<string, RuntimeJsonValue>>;
  readonly projections: DeepReadonly<Ref<readonly PanelProjectionRegistration[]>>;
  /** The mounted form adapters its projections registered for live filling, submission, and visibility. */
  readonly forms: PanelFormAdapters;
  blocksFormInputChange(fields: ReadonlySet<string>): boolean;
  applyStatePreservingDrafts(patch: Readonly<Record<string, RuntimeJsonValue>>): Promise<boolean>;
  formRegistries(): PanelFormAdapters[];
  /** True while an external address update changing deep-link state is held pending reactivation. */
  readonly addressPending?: Readonly<Ref<boolean>>;
  register(registration: PanelProjectionRegistration): () => void;
  /** Runs one described operation here, with the reader's own credential. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Runs one operation a projection publishes, by its handler reference, with the call it is given. */
  runHandler(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** The owner's description of one of this panel's operations, by its ID. */
  describeOperation(operationId: string): Promise<PanelOperationDescriptor>;
  /** Stages a file the reader picked for one of this panel's operations that declares an upload (see `PanelHumanOperations.upload`). */
  uploadFile(operationId: string, file: File): Promise<PanelUploadReceipt>;
  /** Runs a read-only operation as the reader: what it read, with nothing written and nothing reported changed. */
  readOperation(operationId: string, call: PanelReadCall): Promise<PanelReadOperationResult>;
  /**
   * Runs a write as the reader, the way an agent's runs: one intent freezes the calls, the host confirms it where the
   * owner or a batch asks and dispatches it once. What the owner reports changed comes back through the host's refresh
   * port, not from here. A cancelled confirmation writes nothing. With the answer come the targets the owner named
   * when it prepared the write (each by its own label, as the confirmation shows them), for a receipt to name them too.
   */
  writeOperation(
    operationId: string,
    invocation: PanelWriteInvocation,
    writeOptions?: PanelWriteOperationOptions,
  ): Promise<PanelWriteResult>;
  objectChanged(object: PanelObjectIdentity): void;
  /**
   * Lets go of objects a write removed: dirty forms targeting them (or bound to state fields being cleared) are
   * discarded first, then any state holding a removed object is cleared and any list state drops it, so nothing keeps
   * choosing, prompting for, or reading what is no longer there.
   */
  letGo(removed: readonly PanelObjectIdentity[]): void;
  /**
   * Anything this panel shows may have changed: every datum it shows is read again, as the page header's refresh reads
   * it, and every component that reads its own data is told so. The page's own code calls it to keep what it shows
   * current (polling while a run goes on); an operation's reported changes need no call.
   */
  refreshObjects(): void;
  onObjectChanged(listener: (object: PanelObjectIdentity | null) => void): () => void;
  /** Reads a projection record by ID, as the reader. */
  projection(id: string): Promise<ProductProjection>;
  /**
   * Keeps the names the owner of a type gave the objects this instance read, so the page context names a selected object
   * by its owner's label. Only reads call it: a name is never typed in, guessed or carried in an address.
   */
  nameObjects(objectType: string, objects: readonly { primaryKey: string; label: string }[]): void;
  /** Looks up the last known display label of an object recorded on this panel instance. */
  objectName(objectType: string, primaryKey: string): string | null;
  /** Keeps owner labels for child objects read under a parent identity and declared collection. */
  nameChildObjects(parent: PanelObjectIdentity, collection: string, objects: readonly { primaryKey: string; label: string }[]): void;
  /** Reactive map of read-only outputs published by projection members (`outputs[member][name]`), separate from writable `state`. */
  readonly outputs: Readonly<Record<string, Readonly<Record<string, RuntimeJsonValue | null>>>>;
  /** Publish or clear one read-only output for a projection member. */
  setMemberOutput(member: string, name: string, value: RuntimeJsonValue | null): void;
  /** Whether this instance holds unsaved changes: a form the reader edited, or a panel placed in it. */
  dirty(): boolean;
  /** A member's path in the panel the reader opened: this instance's own, then the member's segment. */
  memberPathOf(member: string): PublisherPath;
  /** The ID a member's operation is published under: its path's member keys, then the operation's name. */
  operationIdOf(member: string, name: string): string;
  /** The path of the member that publishes an operation, which the platform finds it by; the opened panel's own need none. */
  operationPath(operationId: string): PanelMemberPath | undefined;
  /** A panel placed in one of this instance's members publishes into it, until the returned function ends that. */
  publish(member: string, publisher: Readonly<Ref<NestedPublisher>>): () => void;
  /**
   * Publishes what one member currently highlights (such as search matches or a directed path result) into
   * `pageContext.highlights`, until the returned disposer runs.
   */
  reportHighlight(member: string, highlight: Readonly<Ref<PageHighlight | null>>): () => void;
  /** The state an address or an open request may carry, for this instance. */
  deepLink(): Record<string, PanelDeepLinkStateValue>;
  /** All declared public state fields with their current values. */
  publicState(): Record<string, RuntimeJsonValue>;
  /** Instance IDs of currently mounted nested panel members keyed by dotted member path. */
  memberInstances(): Readonly<Record<string, string>>;
  /** Instance IDs of currently mounted action/form/list entries keyed by full operation ID (or `row:<opId>`). */
  entryInstances(): Readonly<Record<string, string>>;
  /** Current checked row keys (`<className>:<primaryKey>`) per object-list state field (including nested panels). */
  checkedKeys(): Readonly<Record<string, readonly string[]>>;
  /** Posts a conversation confirmation question for a destructive local UI action (e.g. discarding dirty form edits). */
  requestLocalConfirmation?(input: PanelLocalConfirmationRequest): Promise<PanelLocalConfirmationResponse>;
  /** Atomically claims a pending local confirmation question before executing the local UI action. */
  claimLocalConfirmation?(questionId: string): Promise<PanelLocalConfirmationClaimResponse>;
  /** Cancels a pending local confirmation question when the form changes, closes, or the user declines. */
  cancelLocalConfirmation?(questionId: string, reason: { code: string; message: string }): Promise<void>;
  /** Fills explicit fields on a mounted live form (top-level or nested panel) using the form's own edit entry. */
  fillForm(request: FormFillRequestInput): Promise<FormFillOutcome>;
  /** Executes a declared operation or local semantic action through the mounted component's own UI entry. */
  executeAction(request: PageActionRequestInput): Promise<PageActionOutcome>;
  /** Registers a mounted component's actual UI action entry (form save, button runner, list row runner, local action). */
  registerActionHandler(
    id: string,
    handler: PanelMountedActionHandler,
    options?: { readonly scope?: "default" | "row"; readonly entryInstanceId?: () => string },
  ): () => void;
  /** Notifies mounted members that a panel operation completed. */
  operationCompleted(event: PanelOperationCompletion): void;
  onOperationCompleted(listener: (event: PanelOperationCompletion) => void): () => void;
}

/**
 * One panel instance: everything belongs to it, so two instances of one panel share the declaration and its reads and
 * nothing else.
 */
/** A write's answer, with the targets its owner named when it prepared it; a target it left unnamed is not among them. */
export type PanelWriteResult = AppBridgeConfirmPanelOperationResult & {
  readonly named: readonly { readonly target: PanelObjectIdentity; readonly label: string }[];
};

/** The targets a preparation names: a batch's, by the labels its owner gave them. */
function namedTargets(confirmation: PanelHumanOperationPreparation["confirmation"]): PanelWriteResult["named"] {
  return confirmation.kind === "batch" ? confirmation.targets.objects : [];
}

export function createPanelInstance(manifest: PanelManifest, options: PanelInstanceOptions): PanelInstance {
  const instanceId = randomId();
  let disposed = false;
  const state = createPanelState(manifest, options.initial);
  const objectListeners = new Set<(object: PanelObjectIdentity | null) => void>();
  const operationCompletedListeners = new Set<(event: PanelOperationCompletion) => void>();
  const objectChanged = (object: PanelObjectIdentity | null) => {
    for (const listener of objectListeners) listener(object);
  };
  const registrations = shallowRef<readonly PanelProjectionRegistration[]>([]);
  /** Each member's own parameter values: those its component set and no panel state holds. */
  const own = shallowRef<Readonly<Record<string, Readonly<Record<string, RuntimeJsonValue>>>>>({});
  const prefix = options.memberPath ?? [];
  const segmentOf = options.segmentOf ?? ((member: string) => ({ member }));
  const memberPathOf = (member: string): PublisherPath => {
    const segment = segmentOf(member);
    const [first, ...rest] = prefix;
    return first ? [first, ...rest, segment] : [segment];
  };
  const operationIdOf = (member: string, name: string) => panelOperationId(memberPathOf(member).map((segment) => segment.member), name);
  /** A member's path as the platform needs it to find its operation: none for a fixed member of the opened panel. */
  const publisherPath = (member: string): PublisherPath | undefined => {
    const path = memberPathOf(member);
    return prefix.length || path.at(-1)!.selection ? path : undefined;
  };
  /** The panels placed in this instance's members, publishing into it. */
  const publishers = shallowReactive(new Map<string, Readonly<Ref<NestedPublisher>>>());
  function operationPath(operationId: string): PanelMemberPath | undefined {
    return operations.value.find((operation) => operation.id === operationId)?.memberPath;
  }
  const actionHandlers = new Map<
    string,
    { scope: "default" | "row"; handler: PanelMountedActionHandler; entryInstanceId: () => string }[]
  >();

  function registerActionHandler(
    id: string,
    handler: PanelMountedActionHandler,
    handlerOptions?: { readonly scope?: "default" | "row"; readonly entryInstanceId?: () => string },
  ) {
    const scope = handlerOptions?.scope ?? "default";
    const defaultEntryId = randomId();
    const entryInstanceId = handlerOptions?.entryInstanceId ?? (() => defaultEntryId);
    const list = actionHandlers.get(id) ?? [];
    const entry = { scope, handler, entryInstanceId };
    list.push(entry);
    actionHandlers.set(id, list);
    return () => {
      const current = actionHandlers.get(id);
      if (!current) return;
      const next = current.filter((item) => item !== entry);
      if (next.length) actionHandlers.set(id, next);
      else actionHandlers.delete(id);
    };
  }

  async function writeOperation(
    operationId: string,
    invocation: PanelWriteInvocation,
    writeOptions?: PanelWriteOperationOptions,
  ) {
    // What the owner reports the write changed reaches the instance through the host's one refresh port, as an agent's
    // write does, and is read again from there; the receipt itself rereads nothing.
    const path = writeOptions?.memberPath ?? operationPath(operationId);
    const agentScope = writeOptions?.agentContext;
    const evaluator = writeOptions?.evaluateSubmission;
    const frozen = agentScope && evaluator ? evaluator("prepare") : null;
    if (frozen && !frozen.ok) {
      throw new PanelSubmissionStaleError(frozen.message);
    }
    const preparation = agentScope?.agentRun
      ? await options.operations.prepare(operationId, invocation, path, agentScope.agentRun)
      : await options.operations.prepare(operationId, invocation, path);
    const named = namedTargets(preparation.confirmation);
    const verifyOrCancel = async (phase: "auto-dispatch" | "confirm") => {
      if (!frozen?.ok || !evaluator) return;
      const check = verifySubmissionUnchanged(frozen, evaluator, phase);
      if (!check.ok) {
        await options.operations.cancel?.(preparation.intentId, {
          code: "ACTION_CONFIRMATION_STALE",
          message: check.message,
        }).catch(() => undefined);
        throw new PanelSubmissionStaleError(check.message, preparation.intentId);
      }
    };
    if (agentScope && preparation.autoMode === false && preparation.questionId) {
      await verifyOrCancel("auto-dispatch");
      const isStillValid: () => SubmissionCheckResult = frozen?.ok && evaluator
        ? () => verifySubmissionUnchanged(frozen, evaluator, "confirm")
        : () => ({ ok: true as const });
      throw new PanelOperationDeferred({
        preparation,
        named,
        isStillValid,
        dispatchNow: () => options.confirmOperation(preparation, {
          ...(writeOptions?.onConfirmed ? { onConfirmed: writeOptions.onConfirmed } : {}),
          skipDialog: true,
          beforeDispatch: () => verifyOrCancel("confirm"),
        }),
        cancelNow: (reason) => options.operations.cancel?.(preparation.intentId, reason) ?? Promise.resolve(),
      });
    }
    if (agentScope && preparation.autoMode === true) {
      // Full-auto skips only the conversation question — never the universal 4-tuple verification before dispatch.
      await verifyOrCancel("auto-dispatch");
    }
    const skipDialog = Boolean(agentScope && preparation.autoMode === true);
    const confirmHooks = writeOptions?.onConfirmed || skipDialog
      ? {
          ...(writeOptions?.onConfirmed ? { onConfirmed: writeOptions.onConfirmed } : {}),
          ...(skipDialog ? { skipDialog: true } : {}),
          ...(skipDialog ? { beforeDispatch: () => verifyOrCancel("auto-dispatch") } : {}),
        }
      : undefined;
    const confirmed = confirmHooks
      ? await options.confirmOperation(preparation, confirmHooks)
      : await options.confirmOperation(preparation);
    if (agentScope && confirmed.decision === "confirm") {
      agentScope.completed = { intentId: preparation.intentId, response: confirmed.response };
    }
    return { ...confirmed, named };
  }
  const operations = computed<PanelOperationBinding[]>(() => [
    ...panelOperations(instance, registrations.value, forms, writeOperation,
      (operationId, call) => options.operations.read(operationId, call, operationPath(operationId)),
      (member, name) => ({ id: operationIdOf(member, name), memberPath: publisherPath(member) })),
    // A placed panel's operations are published under their own full paths and run by that panel.
    ...[...publishers.values()].flatMap((publisher) => publisher.value.operations),
  ]);
  /** A member's output: the state it binds takes the value. */
  function output(member: string, name: string, value: RuntimeJsonValue) {
    const declaration = manifest.members[member];
    if (!declaration) throw new Error(`The panel declares no member '${member}'`);
    const bound = declaration.outputs?.[name];
    if (bound) state.set(bound.state, value as never);
  }
  async function invoke(id: string, input?: Readonly<Record<string, unknown>>) {
    const found = operations.value.find((operation) => operation.id === id);
    if (!found) throw new Error(`The panel offers no operation '${id}'`);
    return found.invoke(input);
  }
  async function fillForm(request: FormFillRequestInput): Promise<FormFillOutcome> {
    if (request.expectedPanelInstanceId !== undefined && request.expectedPanelInstanceId !== instanceId) {
      return {
        ok: false,
        reason: "stale",
        ...(request.member ? { member: request.member } : {}),
        ...(request.memberPath?.length ? { memberPath: request.memberPath } : {}),
        message: "The mounted panel definition was replaced or remounted since the last observation.",
      };
    }
    if (request.memberPath?.length) {
      const [head, ...rest] = request.memberPath;
      const publisher = publishers.get(head!)?.value;
      if (!publisher?.fillForm) {
        return {
          ok: false,
          reason: request.expectedMemberInstanceId !== undefined || request.expectedFormInstanceId !== undefined ? "stale" : "form_not_found",
          ...(request.member ? { member: request.member } : {}),
          memberPath: request.memberPath,
          message: `Nested panel member '${head}' is not mounted.`,
        };
      }
      const { expectedPanelInstanceId: _checkedRoot, ...childRequest } = request;
      const nested = await publisher.fillForm({
        ...childRequest,
        memberPath: rest.length ? rest : undefined,
      });
      return {
        ...nested,
        memberPath: [head!, ...(nested.memberPath ?? [])],
      };
    }
    if (request.member) {
      if (request.expectedMemberInstanceId !== undefined && request.expectedMemberInstanceId !== instanceId) {
        return {
          ok: false,
          reason: "stale",
          member: request.member,
          message: "The target panel member instance was replaced or remounted.",
        };
      }
      return forms.fill(request.member, request.values, {
        overwriteUnsaved: request.overwriteUnsaved,
        ...(request.expectedFormInstanceId !== undefined ? { expectedFormInstanceId: request.expectedFormInstanceId } : {}),
        ...(request.expectedTarget ? { expectedTarget: request.expectedTarget } : {}),
      });
    }
    const mounted = forms.mountedSlots().map((slot) => ({ member: slot, memberPath: undefined as readonly string[] | undefined }));
    for (const [member, publisher] of publishers.entries()) {
      for (const form of publisher.value.context?.forms ?? []) {
        mounted.push({
          member: form.member,
          memberPath: [member, ...(form.memberPath?.map((segment) => segment.member) ?? [])],
        });
      }
    }
    if (mounted.length === 0) {
      return {
        ok: false,
        reason: request.expectedMemberInstanceId !== undefined || request.expectedFormInstanceId !== undefined ? "stale" : "form_not_found",
        message: "No form is currently open on this page.",
      };
    }
    if (mounted.length > 1) {
      return {
        ok: false,
        reason: "form_ambiguous",
        message: `Multiple forms are open (${mounted.map((item) => [...(item.memberPath ?? []), item.member].join(".")).join(", ")}); specify member (and memberPath if nested).`,
      };
    }
    const only = mounted[0]!;
    return fillForm({ ...request, member: only.member, memberPath: only.memberPath });
  }
  async function executeAction(request: PageActionRequestInput): Promise<PageActionOutcome> {
    if (request.expectedPanelInstanceId !== undefined && request.expectedPanelInstanceId !== instanceId) {
      return {
        ok: false,
        reason: "stale",
        operation: request.operation,
        message: "The mounted panel definition was replaced or remounted since the last observation.",
      };
    }
    if (request.memberPath?.length) {
      const [head, ...rest] = request.memberPath;
      const publisher = publishers.get(head!)?.value;
      if (!publisher?.executeAction) {
        return {
          ok: false,
          reason: request.expectedMemberInstanceId !== undefined || request.expectedEntryInstanceId !== undefined ? "stale" : "action_not_found",
          operation: request.operation,
          message: `Nested panel member '${head}' is not mounted.`,
        };
      }
      const { expectedPanelInstanceId: _checkedRoot, ...childRequest } = request;
      return publisher.executeAction({
        ...childRequest,
        memberPath: rest.length ? rest : undefined,
      });
    }
    if (request.operation === "page.refresh") {
      if (request.expectedMemberInstanceId !== undefined && request.expectedMemberInstanceId !== instanceId) {
        return {
          ok: false,
          reason: "stale",
          operation: request.operation,
          message: "The target nested panel member was replaced or remounted.",
        };
      }
      objectChanged(null);
      return { ok: true, kind: "executed", operation: "page.refresh" };
    }
    // Allow addressing nested panel actions via "<nestedMember>.<op>" as published in panel operations.
    const dot = request.operation.indexOf(".");
    if (dot > 0) {
      const prefixMember = request.operation.slice(0, dot);
      const nestedPublisher = publishers.get(prefixMember)?.value;
      if (nestedPublisher?.executeAction) {
        const { expectedPanelInstanceId: _checkedRoot, ...childRequest } = request;
        return nestedPublisher.executeAction({
          ...childRequest,
          operation: request.operation.slice(dot + 1),
        });
      }
    }

    if (request.expectedMemberInstanceId !== undefined && request.expectedMemberInstanceId !== instanceId) {
      return {
        ok: false,
        reason: "stale",
        operation: request.operation,
        message: "The target nested panel member was replaced or remounted.",
      };
    }

    const fullOperationId = prefix.length
      ? `${prefix.map((segment) => segment.member).join(".")}.${request.operation}`
      : request.operation;
    const entries = actionHandlers.get(fullOperationId) ?? actionHandlers.get(request.operation) ?? [];
    const preferredScope = request.rowKey !== undefined ? "row" : "default";
    const matchedEntry =
      entries.find((entry) => entry.scope === preferredScope)
      ?? (request.rowKey === undefined ? entries[0] : undefined);

    if (!matchedEntry) {
      return {
        ok: false,
        reason: request.expectedEntryInstanceId !== undefined ? "stale" : "action_not_found",
        operation: request.operation,
        message: request.expectedEntryInstanceId !== undefined
          ? `Action entry '${request.operation}' was unmounted or replaced since the last observation.`
          : request.rowKey !== undefined
            ? `Row action '${request.operation}' is not mounted on a list member.`
            : `The currently displayed page offers no mounted action '${request.operation}'.`,
      };
    }

    if (
      request.expectedEntryInstanceId !== undefined
      && matchedEntry.entryInstanceId() !== request.expectedEntryInstanceId
    ) {
      return {
        ok: false,
        reason: "stale",
        operation: request.operation,
        message: `Action entry '${request.operation}' changed its bound target or was remounted since the last observation.`,
      };
    }

    const matchedHandler = matchedEntry.handler;

    const agentContext: PanelAgentActionContext = { agentRun: request.agentRun };
    try {
      const result = await matchedHandler({
        ...(request.rowKey !== undefined ? { rowKey: request.rowKey } : {}),
        ...(request.input !== undefined ? { input: request.input } : {}),
        ...(request.expectedEntryInstanceId !== undefined ? { expectedEntryInstanceId: request.expectedEntryInstanceId } : {}),
        ...(request.expectedTarget !== undefined ? { expectedTarget: request.expectedTarget } : {}),
        ...(request.expectedCheckedKeys !== undefined ? { expectedCheckedKeys: request.expectedCheckedKeys } : {}),
        agentContext,
      });
      const toPageActionOutcome = (mountedResult: PanelMountedActionResult): PageActionOutcome => {
        if (!mountedResult.ok) {
          if (mountedResult.reason === "unknown") {
            const unknownOutcome = mountedResult.outcome !== undefined
              ? mountedResult.outcome
              : agentContext.completed?.response.kind === "dispatched"
                ? agentContext.completed.response.outcome
                : undefined;
            return {
              ok: false,
              kind: "unknown",
              reason: "outcome_unknown",
              operation: request.operation,
              ...(agentContext.completed ? { intentId: agentContext.completed.intentId } : {}),
              ...(unknownOutcome !== undefined ? { outcome: unknownOutcome } : {}),
              ...(mountedResult.message ? { message: mountedResult.message } : {}),
            };
          }
          if (mountedResult.reason === "partial") {
            const partialOutcome = mountedResult.outcome !== undefined
              ? mountedResult.outcome
              : agentContext.completed?.response.kind === "dispatched"
                ? agentContext.completed.response.outcome
                : undefined;
            return {
              ok: false,
              kind: "partially_executed",
              reason: "partial_completion",
              operation: request.operation,
              ...(agentContext.completed ? { intentId: agentContext.completed.intentId } : {}),
              code: mountedResult.code ?? "PARTIAL_COMPLETION",
              message: mountedResult.message ?? "Operation partially completed with refusals or failures.",
              ...(mountedResult.savedFields?.length ? { savedFields: mountedResult.savedFields } : {}),
              outcome: partialOutcome,
            };
          }
          return {
            ok: false,
            reason: mountedResult.reason,
            operation: request.operation,
            ...(agentContext.completed ? { intentId: agentContext.completed.intentId } : {}),
            ...(mountedResult.code ? { code: mountedResult.code } : {}),
            ...(mountedResult.message ? { message: mountedResult.message } : {}),
          };
        }
        if ("confirmation" in mountedResult) {
          return {
            ok: true,
            kind: "awaiting_confirmation",
            operation: request.operation,
            intentId: mountedResult.confirmation.intentId,
            questionId: mountedResult.confirmation.questionId,
            label: mountedResult.confirmation.label,
            confirmation: mountedResult.confirmation,
          };
        }
        if (agentContext.completed) {
          const classified = classifyDispatchResponseForAction(agentContext.completed.response);
          if (!classified.ok) return toPageActionOutcome(classified);
        }
        return {
          ok: true,
          kind: "executed",
          operation: request.operation,
          ...(agentContext.completed ? { intentId: agentContext.completed.intentId } : {}),
          outcome: mountedResult.outcome ?? (agentContext.completed?.response.kind === "dispatched" ? agentContext.completed.response.outcome : agentContext.completed?.response),
        };
      };
      return toPageActionOutcome(result);
    } catch (error) {
      if (error instanceof PanelConfirmationDeferred) {
        const { confirmation } = error;
        return {
          ok: true,
          kind: "awaiting_confirmation",
          operation: request.operation,
          intentId: confirmation.intentId,
          questionId: confirmation.questionId,
          label: confirmation.label,
          confirmation,
        };
      }
      if (error instanceof PanelSubmissionStaleError) {
        return {
          ok: false,
          reason: "stale",
          operation: request.operation,
          ...(error.intentId ? { intentId: error.intentId } : {}),
          message: error.message,
        };
      }
      if (agentContext.completed) {
        const classified = classifyDispatchResponseForAction(agentContext.completed.response);
        if (!classified.ok) {
          if (classified.reason === "unknown") {
            return {
              ok: false,
              kind: "unknown",
              reason: "outcome_unknown",
              operation: request.operation,
              intentId: agentContext.completed.intentId,
              ...(classified.outcome !== undefined ? { outcome: classified.outcome } : {}),
              ...(classified.message ? { message: classified.message } : {}),
            };
          }
          if (classified.reason === "partial") {
            return {
              ok: false,
              kind: "partially_executed",
              reason: "partial_completion",
              operation: request.operation,
              intentId: agentContext.completed.intentId,
              code: classified.code ?? "PARTIAL_COMPLETION",
              message: classified.message ?? "Operation partially completed with refusals or failures.",
              ...(classified.savedFields?.length ? { savedFields: classified.savedFields } : {}),
              outcome: classified.outcome,
            };
          }
          return {
            ok: false,
            reason: classified.reason,
            operation: request.operation,
            intentId: agentContext.completed.intentId,
            ...(classified.code ? { code: classified.code } : {}),
            ...(classified.message ? { message: classified.message } : {}),
          };
        }
      }
      return {
        ok: false,
        reason: "failed",
        operation: request.operation,
        ...(agentContext.completed ? { intentId: agentContext.completed.intentId } : {}),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const topLevelMemberKeys = Object.keys(manifest.members);
  const forms = new PanelFormAdapters(topLevelMemberKeys);
  function memberStateInputs(member: string, visited: Set<string>, fields: Set<string>) {
    if (visited.has(member)) return;
    visited.add(member);
    const declaration = manifest.members[member]!;
    if ("fromState" in declaration.target) fields.add(declaration.target.fromState);
    for (const input of Object.values(declaration.inputs ?? {})) {
      if ("state" in input) fields.add(input.state);
      if ("output" in input) {
        const { member, name } = input.output;
        const source = manifest.members[member]!;
        const output = source.outputs?.[name];
        if (output && !source.inputs?.[name]) fields.add(output.state);
        memberStateInputs(member, visited, fields);
      }
    }
  }
  function blocksFormInputChange(changed: ReadonlySet<string>): boolean {
    const fields = new Set<string>();
    const visited = new Set<string>();
    for (const { member, fields: bound } of forms.dirtyInputs()) {
      memberStateInputs(member, visited, fields);
      for (const field of bound) fields.add(field);
    }
    for (const [member, publisher] of publishers) {
      if (publisher.value.dirty()) memberStateInputs(member, visited, fields);
    }
    return [...fields].some((field) => changed.has(field));
  }

  const formRegistries = (): PanelFormAdapters[] => [
    forms,
    ...[...publishers.values()].flatMap((publisher) => publisher.value.formRegistries()),
  ];
  async function applyStatePreservingDrafts(patch: Readonly<Record<string, RuntimeJsonValue>>): Promise<boolean> {
    const registries = formRegistries();
    const drafts = registries.flatMap((registry) => registry.captureDirtyDrafts());
    const previous = state.values.value;
    for (const registry of registries) registry.probing = true;
    try {
      state.setState(patch);
      await nextTick();
      if (drafts.every((draft) => draft.stillMounted())) return true;
      const restored = drafts.map((draft) => draft.restoreOnRemount());
      state.setState(previous);
      await nextTick();
      // Projection components can resolve asynchronously even when their definitions are already held.
      await Promise.all(restored);
      await nextTick();
      return false;
    } finally {
      for (const registry of registries) registry.probing = false;
    }
  }
  const memberOutputStore = reactive<Record<string, Record<string, RuntimeJsonValue | null>>>({});
  function setMemberOutput(member: string, name: string, value: RuntimeJsonValue | null) {
    let bucket = memberOutputStore[member];
    if (value === null) {
      if (bucket && Object.hasOwn(bucket, name)) {
        bucket[name] = null;
      }
      return;
    }
    if (!bucket) {
      bucket = {};
      memberOutputStore[member] = bucket;
    }
    bucket[name] = value;
  }
  const names = shallowReactive(new Map<string, string>());
  const highlights = shallowReactive(new Map<string, Readonly<Ref<PageHighlight | null>>>());
  const translate = options.translate ?? ((key: string) => key);
  function publicState(): Record<string, RuntimeJsonValue> {
    const result: Record<string, RuntimeJsonValue> = {};
    for (const name of Object.keys(manifest.state)) {
      result[name] = (state.values.value[name] ?? null) as RuntimeJsonValue;
    }
    return result;
  }
  const pageContext = computed<PageContext>(() => {
    const reportedHighlights = [
      ...[...highlights.values()].flatMap((entry) => {
        const value = entry.value;
        if (!value) return [];
        return [prefix.length ? { ...value, memberPath: prefix as PublisherPath } : value];
      }),
      ...[...publishers.values()].flatMap((publisher) => publisher.value.context?.highlights ?? []),
    ];
    const currentPublicState = publicState();
    const reportedForms: PageFormSnapshot[] = [
      ...forms.snapshots().map((form) => (prefix.length ? { ...form, memberPath: prefix as PublisherPath } : form)),
      ...[...publishers.values()].flatMap((publisher) => publisher.value.context?.forms ?? []),
    ];
    return {
      pageKey: options.pageKey,
      url: options.url(),
      label: options.label(),
      selection: [
        // A placed panel's own selections say which placed panel they are, by its path.
        ...panelSelection(manifest, state.values.value, names, translate)
          .map((selected) => (prefix.length ? { ...selected, memberPath: prefix as PublisherPath } : selected)),
        ...[...publishers.values()].flatMap((publisher) => publisher.value.context?.selection ?? []),
      ],
      ...(reportedHighlights.length ? { highlights: reportedHighlights } : {}),
      ...(Object.keys(currentPublicState).length ? { state: currentPublicState } : {}),
      ...(reportedForms.length ? { forms: reportedForms } : {}),
    };
  });
  function memberInstances(): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [member, publisher] of publishers.entries()) {
      result[member] = publisher.value.instanceId;
      for (const [subKey, subId] of Object.entries(publisher.value.memberInstances?.() ?? {})) {
        result[`${member}.${subKey}`] = subId;
      }
    }
    return result;
  }
  function entryInstances(): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [opId, list] of actionHandlers.entries()) {
      const defaultEntry = list.find((entry) => entry.scope === "default");
      if (defaultEntry) result[opId] = defaultEntry.entryInstanceId();
      const rowEntry = list.find((entry) => entry.scope === "row");
      if (rowEntry) result[`row:${opId}`] = rowEntry.entryInstanceId();
    }
    for (const publisher of publishers.values()) {
      Object.assign(result, publisher.value.entryInstances?.() ?? {});
    }
    return result;
  }
  function checkedKeys(): Readonly<Record<string, readonly string[]>> {
    const result: Record<string, readonly string[]> = {};
    for (const [name, { type }] of Object.entries(manifest.state)) {
      if (type.kind === "list" && type.items.kind === "object") {
        result[name] = stateObjects(state.values.value[name]).map(
          ({ className, primaryKey }) => `${className}:${primaryKey}`,
        );
      }
    }
    for (const [member, publisher] of publishers.entries()) {
      for (const [subKey, keys] of Object.entries(publisher.value.checkedKeys?.() ?? {})) {
        result[`${member}.${subKey}`] = keys;
      }
    }
    return result;
  }
  const instance: PanelInstance = {
    instanceId,
    isDisposed: () => disposed,
    markDisposed() {
      disposed = true;
    },
    manifest,
    state,
    pageContext,
    operations,
    forms,
    projections: readonly(registrations),
    register(registration) {
      // In the declaration's slot order, whichever projection finished loading first: the operations an agent lists and
      // the header draws keep the panel's own order.
      const order = Object.keys(manifest.members);
      registrations.value = [...registrations.value, registration]
        .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
      return () => {
        registrations.value = registrations.value.filter((item) => item !== registration);
      };
    },
    invoke,
    memberParam(member, name) {
      const declaration = manifest.members[member];
      if (!declaration) throw new Error(`The panel declares no member '${member}'`);
      const input = declaration.inputs?.[name];
      const outputBinding = declaration.outputs?.[name];
      if (input && (!("state" in input) || "field" in input)) {
        return {
          value: computed(() => memberInputValue(instance, input) ?? null),
          set: () => { throw new Error(`Member '${member}' fixes '${name}'; it cannot be set`); },
        };
      }
      const bound = input?.state ?? outputBinding?.state;
      if (bound !== undefined) {
        return {
          value: computed(() => (state.values.value[bound] ?? null) as RuntimeJsonValue | null),
          set: (value) => state.set(bound, value as never),
        };
      }
      return {
        value: computed(() => own.value[member]?.[name] ?? null),
        set(value) {
          const kept = { ...own.value[member] };
          if (value === null) delete kept[name];
          else kept[name] = value;
          own.value = { ...own.value, [member]: kept };
        },
      };
    },
    ownParams: (member) => own.value[member] ?? {},
    output,
    async runHandler(handlerRef, call) {
      const result = await handlerFor(handlerRef).invoke(call);
      if (call.target?.kind === "object") objectChanged(call.target);
      return result;
    },
    describeOperation: (operationId) => options.operations.describe(operationId, operationPath(operationId)),
    readOperation: (operationId, call) => options.operations.read(operationId, call, operationPath(operationId)),
    uploadFile: (operationId, file) => options.operations.upload(operationId, file, operationPath(operationId)),
    writeOperation,
    objectChanged,
    letGo(removed) {
      if (!removed.length) return;
      const gone = (object: PanelObjectRef) =>
        removed.some(({ objectType, primaryKey }) => objectType === object.className && primaryKey === object.primaryKey);
      const clearedStateKeys = new Set<string>();
      for (const [name, { type }] of Object.entries(manifest.state)) {
        if (type.kind !== "object") continue;
        const held = stateObject(state.values.value[name]);
        if (held && gone(held)) clearedStateKeys.add(name);
      }
      // Discard dirty forms targeting removed objects (or bound to state fields being cleared) before mutating panel
      // state so target watchers do not prompt to keep editing or write deleted objects back into state.
      for (const registry of formRegistries()) {
        registry.discardRemoved(removed, registry === forms ? clearedStateKeys : undefined);
      }
      for (const [name, { type }] of Object.entries(manifest.state)) {
        const value = state.values.value[name];
        if (type.kind === "object") {
          const held = stateObject(value);
          if (held && gone(held)) state.set(name, null);
        } else if (type.kind === "list" && type.items.kind === "object") {
          const held = stateObjects(value);
          if (held.some(gone)) state.set(name, held.filter((object) => !gone(object)));
        }
      }
    },
    refreshObjects: () => objectChanged(null),
    onObjectChanged(listener) {
      objectListeners.add(listener);
      return () => objectListeners.delete(listener);
    },
    projection: (id) => options.readProjection(id),
    nameObjects(objectType, objects) {
      for (const { primaryKey, label } of objects) names.set(objectNameKey(objectType, primaryKey), label);
    },
    objectName(objectType, primaryKey) {
      return names.get(objectNameKey(objectType, primaryKey)) ?? null;
    },
    nameChildObjects(parent, collection, objects) {
      for (const { primaryKey, label } of objects) names.set(childObjectNameKey(parent, collection, primaryKey), label);
    },
    outputs: memberOutputStore,
    setMemberOutput,
    dirty: () => forms.probing || forms.dirty() || [...publishers.values()].some((publisher) => publisher.value.dirty()),
    blocksFormInputChange,
    applyStatePreservingDrafts,
    formRegistries,
    memberPathOf,
    operationIdOf,
    operationPath,
    publish(member, publisher) {
      publishers.set(member, publisher);
      return () => {
        if (publishers.get(member) === publisher) publishers.delete(member);
      };
    },
    reportHighlight(member, highlight) {
      highlights.set(member, highlight);
      return () => {
        if (highlights.get(member) === highlight) highlights.delete(member);
      };
    },
    deepLink: () => state.deepLinkable(),
    publicState,
    memberInstances,
    entryInstances,
    checkedKeys,
    ...(options.operations.requestLocalConfirmation
      ? { requestLocalConfirmation: (input: PanelLocalConfirmationRequest) => options.operations.requestLocalConfirmation!(input) }
      : {}),
    ...(options.operations.claimLocalConfirmation
      ? { claimLocalConfirmation: (questionId: string) => options.operations.claimLocalConfirmation!(questionId) }
      : {}),
    ...(options.operations.cancelLocalConfirmation
      ? { cancelLocalConfirmation: (questionId: string, reason: { code: string; message: string }) => options.operations.cancelLocalConfirmation!(questionId, reason) }
      : {}),
    fillForm,
    executeAction,
    registerActionHandler,
    operationCompleted(event) {
      for (const listener of operationCompletedListeners) listener(event);
    },
    onOperationCompleted(listener) {
      operationCompletedListeners.add(listener);
      return () => operationCompletedListeners.delete(listener);
    },
  };
  return instance;
}

/**
 * Applies what an address or an open request carries, checked against the declaration: only the fields the panel offers
 * in an address are restorable, so a credential or a form value never arrives that way.
 */
export function applyPanelRequest(manifest: PanelManifest, state: PanelStateStore, request: unknown): void {
  const parsed = panelOpenRequestSchema.parse(request);
  const patch: Record<string, PanelStateValue> = {};
  for (const [name, value] of Object.entries(parsed.state)) {
    if (!manifest.state[name]?.deepLink) continue;
    patch[name] = value;
  }
  state.setState(patch);
}
