import type { PageComposerRequest } from "@ontomato/agent-shell-ui";
import { computed, effectScope, onScopeDispose, ref, shallowReactive, shallowRef, watch, type Component, type ComputedRef, type EffectScope, type Ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import { OBJECT_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { AppMenuGroup, DirectPanelRun } from "@ontomato/platform-shell";
import { panelOperationAffectedSchema, panelReadResultSchemas, type PanelCompletedOperation } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directObjectSourceType, directReadDeclaration, readParameterUsesStateField, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { ApplicationEntryMenu, CurrentApplicationEntry, DirectProjection } from "@ontomato/contracts/product-panels";
import type { PanelCurrentUser, PanelDataState, ProductPanelNestedReadRequest, ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { createPanelInstance, type PanelInstance, type PanelInstanceOptions, type PanelOperationCompletion, type PublisherPath } from "./instance";
import type { ComponentPackageReader } from "./component-packages";
import { stateChildObject, stateObject, stateObjects, type PanelFieldValue, type PanelObjectRef } from "./state";
import type { PanelText } from "./text";
import type { PanelContext } from "./context";
import type { PanelLocalDraftStore } from "./local-drafts";
import { admittedOperations, watchMemberOperations, type MemberOperationsState } from "./member-operations";
import type { PanelMemberContext } from "./member";
import { portsOf } from "./ports-of";
import { memberInputValue, slotInputValues } from "./ports";
import { memberComponentId } from "./projection-element";

/*
 * A panel drawn directly in the platform's own document (design 4.2): the instance holds its state and its members'
 * named data. The host gives it one read port — the platform's read entry under the reader's identity — and the instance
 * decides when to read what: a member's datum is read when a component first shows it, again when the member's inputs
 * change, and again when an operation reports it changed. A read whose source object is not selected yet is not made;
 * the datum says a selection is needed. An answer for an earlier selection is never shown for the new one.
 *
 * A panel's frame and the platform's document read the same declaration; a member key is what the SDK calls a slot.
 */

/** The objects and types an operation reports it changed. */
export type PanelOperationAffected = ReturnType<typeof panelOperationAffectedSchema.parse>;

import { withMemberReadRetry, type MemberDataState, type MemberReadyData } from "./member-data-state";

export { withMemberReadRetry, type MemberDataState, type MemberReadyData };

/** A projection input's value: a JSON value as the member and the run supply it; absent while nothing is supplied. */
export type MemberInputs = Readonly<Record<string, RuntimeJsonValue>>;

/** A member's placement as a read's parameters see it: the panel state its inputs and outputs bind. */
export type MemberPlacement = Pick<PanelManifest["members"][string], "inputs" | "outputs">;

export interface DirectProjectionReadOptions {
  /** True when the member picks its projection from public panel state rather than a fixed manifest target. */
  readonly dynamic?: boolean;
}

export interface DirectPanelInstanceOptions extends Omit<PanelInstanceOptions, "readProjection"> {
  overlayRoot?: DirectPanelRun["overlayRoot"];
  windowOverlayRoot?: DirectPanelRun["windowOverlayRoot"];
  shown?: DirectPanelRun["shown"];
  /** Only for an application's frame: the entry the platform resolved, its menu, and where its content goes. */
  currentEntry?: DirectPanelRun["currentEntry"];
  /** Current application frame state when this panel runs inside a framed application entry. */
  frameState?: DirectPanelRun["frameState"];
  /** Registers a panel-local back/close step (LIFO) with the host's history and Escape coordinator. */
  registerBackHandler?: DirectPanelRun["registerBackHandler"];
  /** Unified host confirmation for leaving unsaved edits. */
  confirmLeaveUnsaved?: DirectPanelRun["confirmLeaveUnsaved"];
  /** Current signed-in user's public display info. */
  currentUser?: DirectPanelRun["currentUser"];
  /** Platform-owned local draft persistence store for `persistDraft` forms and list/picker draft indicators. */
  localDrafts?: PanelLocalDraftStore;
  /** Reads an installed component package's current release, for a member whose component is the package's. */
  readComponentPackage: ComponentPackageReader;
  loadDomainComponent?(projection: DirectProjection): Promise<Component>;
  /** Reads one named datum of one member, as the platform's read entry answers it for this panel's source. */
  read: PanelReadPort;
  /** Reads a member's current projection by ID, as the reader. */
  readProjection(id: string, options?: DirectProjectionReadOptions): Promise<DirectProjection>;
  /**
   * Expands the page's composer with a conversation entry a member's projection declares: its agent and its opening
   * sentence, with the official entry control applying the declared click behavior.
   */
  expandPageComposer(entry: PageComposerRequest): unknown;
  /**
   * Opens one of the platform's addresses. When it cannot (not the platform's address, a page the reader may not open, a
   * guard that stopped it), the host says why on the page and rejects with the same reason.
   */
  navigate(address: string): Promise<void>;
  /**
   * Leaves the current detail panel by stepping back one browser history entry when an in-platform previous page
   * exists, otherwise navigating to `fallback`. Defaults to `navigate(fallback)` when omitted.
   */
  navigateBack?(fallback: string): Promise<void>;
  /**
   * Runs the panel a member places from the panel's state (see the mount's options): `memberPath` is that member's
   * segment with the selection, relative to this instance; `run` is how the placed panel reports to this one.
   */
  nested(memberPath: ProductPanelNestedReadRequest["memberPath"], run: DirectPanelRun): Promise<{ element: HTMLElement; mount: NestedPanelMount }>;
}

/** What this instance needs of a placed panel's run: its own instance, and how the host drives and ends it. */
export interface NestedPanelMount {
  readonly instance: PanelInstance;
  refresh(target: null, affected?: PanelOperationAffected): void;
  projectionsChanged(projections: readonly { id: string; revision?: number }[]): void;
  activate(active: boolean): void;
  isLoading?(): boolean;
  dispose(): void;
}

/**
 * Why a member could not be placed: the reader may not use what was chosen (403), or it is not there, or not among the
 * member's candidates (404). The member shows it in its own place; the rest of the panel goes on.
 */
export class PanelMemberUnavailable extends Error {
  constructor(readonly status: 403 | 404, message: string) {
    super(message);
    this.name = "PanelMemberUnavailable";
  }
}

/**
 * What a member places now: a projection, drawn by its component; a panel, run in an element of its own; or nothing
 * yet, while the panel's state chooses nothing for it.
 */
export type MemberPlacing =
  | { kind: "projection"; context: PanelMemberContext }
  | { kind: "panel"; element: HTMLElement; failure: Readonly<Ref<Error | null>> }
  | { kind: "awaiting" }
  /** The platform's current entry is placed only in an application's frame; this panel is not running as one. */
  | { kind: "outsideFrame" };

/**
 * The target a state value chooses for a member placed from it: the panel or projection it names. A member that places
 * the chosen object's detail panel has no target of its own here: the platform finds the panel by the object's type.
 */
function chosenTarget(direct: PanelManifest, member: string, value: unknown): { panelId: string } | { projectionId: string } | "objectDetail" | null {
  const chosen = stateObject(value as PanelFieldValue);
  if (chosen === null) return null;
  const { target } = direct.members[member]!;
  if ("fromState" in target && "rule" in target.candidates && target.candidates.rule === "objectDetail") return "objectDetail";
  if (chosen.className === PRODUCT_PANEL) return { panelId: chosen.primaryKey };
  if (chosen.className === PRODUCT_PROJECTION) return { projectionId: chosen.primaryKey };
  throw new Error(`Member '${member}' is placed from ${chosen.className}, which names neither a panel nor a projection`);
}

/** One member's data: the shown data by name, and a read the component asks for with run inputs of its own. */
/** Optional per-datum defaults passed to `MemberData.use`, isolated to that datum read. */
export interface MemberDataUseOptions {
  /** Fixed runtime defaults for this datum (e.g. a collection component's single-shot page size). */
  readonly fixedParams?: MemberInputs;
  /** Read parameter names not implicitly inherited from member outputs/inputs unless explicitly bound in `data.params`. */
  readonly ignoreImplicitParams?: readonly string[];
}

export interface MemberData {
  /**
   * The datum a component shows, kept current while the component is mounted: called in its setup, it is what makes
   * the instance read the datum at all.
   */
  use(name: string, options?: MemberDataUseOptions): ComputedRef<MemberDataState>;
  /**
   * One more read of a datum with values of the component's own, by the read's parameter names (a form's values and
   * changed field, a picker's keyword), and inputs it overrides (the object a form is read for). A value goes to the
   * input the projection maps its parameter to, else it is the component's run-time value. It does not replace the
   * shown datum.
   */
  read(name: string, params: MemberInputs, inputs?: MemberInputs): Promise<MemberDataState>;
  /** Re-read one named datum (or all active data of this member when `name` is omitted) without reloading other members. */
  refresh?(name?: string): void;
}

export interface DirectPanelInstance extends PanelInstance {
  readonly overlayRoot?: PanelContext["overlayRoot"];
  readonly windowOverlayRoot?: PanelContext["windowOverlayRoot"];
  readonly overlayShown?: PanelContext["overlayShown"];
  readonly direct: PanelManifest;
  /** In an application's frame, the entry shown now; null elsewhere. It follows the reader to another entry. */
  readonly currentEntry: ComputedRef<CurrentApplicationEntry | null>;
  /** In an application's frame, the menu the same resolution gave; null elsewhere. */
  readonly entryMenu: ComputedRef<ApplicationEntryMenu | null>;
  /** Optional host-supplied menu groups for hybrid built-in applications mixing panel entries and native pages. */
  readonly hostMenu: ComputedRef<readonly AppMenuGroup[] | null>;
  /** Current signed-in user's public display info; null in editions without sign-in. */
  readonly currentUser: ComputedRef<PanelCurrentUser | null>;
  /** Platform-owned local draft persistence store (internal to SDK components; not exposed on `PanelContext`). */
  readonly localDrafts?: PanelLocalDraftStore;
  /** Reactive read-only check for whether the given object has any unsaved local draft in this browser. */
  hasLocalDraft(ref: PanelObjectRef): boolean;
  /** Reads an installed component package's current release (see the options). */
  readonly readComponentPackage: ComponentPackageReader;
  readonly loadDomainComponent?: DirectPanelInstanceOptions["loadDomainComponent"];
  /** The panel's own words, in the current language. */
  readonly text: PanelText;
  /** Current application frame state, when running inside a framed application entry. */
  frameState(): Readonly<Record<string, RuntimeJsonValue>> | undefined;
  /** The page's composer, expanded with a member's declared conversation entry. */
  expandPageComposer(entry: PageComposerRequest, click?: MouseEvent): void | Promise<void>;
  /** Opens one of the platform's addresses, or says on the page why it cannot (see the options). */
  navigate(address: string): Promise<void>;
  /** Leaves the current detail panel using browser history when an in-platform previous page exists, else `fallback`. */
  navigateBack(fallback: string): Promise<void>;
  /** The member's projection, read once for this instance: its fixed one, or the one the panel's state chose. */
  projectionOf(member: string): Promise<DirectProjection>;
  /** The member's projection and resolved Vue component, cached once per member and reused across all rows. */
  memberDefinition(member: string): Promise<{ projection: DirectProjection; component: Component }>;
  /** What the member places now, held from the start, drawn or not, and placed anew when the state choosing it changes. */
  placing(member: string): Promise<MemberPlacing>;
  /**
   * Create an isolated per-instance projection context for a `<Projection slot="..." :inputs="{ ... }">` mounted inside
   * a Vue slot (such as `ObjectList`'s `#row-detail` / `#cell-*` or an `ObjectForm` array row). Returns the context and a
   * disposer that tears down its own reads and operations when the slot instance unmounts.
   */
  placingScoped(
    member: string,
    overrideInputs: () => MemberInputs,
    rowItemKey?: import("@ontomato/contracts/panel-manifest").PanelMemberItemKey,
  ): Promise<{ context: PanelMemberContext; dispose(): void }>;
  /**
   * The member as the instance holds it, drawn or not: its projection, the inputs its placement fills now, its data and
   * the operations its owners admit, registered with the instance once its projection is read. A member is held once per
   * reading of its projection; one its definition changed is held anew.
   */
  memberContext(member: string): Promise<PanelMemberContext>;
  /** The data of one member, whose inputs are `inputs` as the member's placement fills them now. */
  memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs, ownParams?: () => MemberInputs, scoped?: boolean): MemberData;
  /** The operations one member can do now, as the owner admits them for its inputs; kept current while it is drawn. */
  memberOperations(member: string, projection: DirectProjection, inputs: () => MemberInputs): ComputedRef<MemberOperationsState>;
  /** An operation's reported changes: the shown data they concern are read again. */
  refresh(affected: PanelOperationAffected, operation?: PanelCompletedOperation): void;
  /** True while a new external address with changed deep-link state is held pending reactivation. */
  readonly addressPending: Readonly<Ref<boolean>>;
  /** Updates whether a new external address is held pending reactivation. */
  setAddressPending(pending: boolean): void;
  /** While the reader does not see the instance it reads nothing; a refresh when seen again brings it up to date. */
  setActive(active: boolean): void;
  /**
   * A projection's definition changed: its members read it again and draw it anew. A revision no later than the one a
   * member was read at (a snapshot naming every projection as it is) changes nothing for that member.
   */
  projectionChanged(id: string, revision?: number): void;
  /** How many times a member's projection was read anew, which its drawing is keyed by. */
  projectionVersion(member: string): number;
  /** True while any declared projection or nested panel member is still resolving asynchronously. */
  isLoading(): boolean;
  /** Platform toast channel shared by read and write operations on this direct panel instance. */
  readonly notify: NonNullable<PanelInstanceOptions["notify"]>;
  /** Registers a panel-local back/close step (LIFO) with the enclosing host. */
  readonly registerBackHandler?: DirectPanelRun["registerBackHandler"];
  /** Unified host confirmation for leaving unsaved edits. */
  readonly confirmLeaveUnsaved?: DirectPanelRun["confirmLeaveUnsaved"];
}

/**
 * What a datum's read takes now, parameter by parameter of its owner's signature, from three places in this order: the
 * projection's own mapping (a literal, or one of its inputs); the member's panel state of the same name (an input or an
 * output bound to it), which is the author's binding though the projection writes no mapping; and the member's own value
 * the component set (`params`), which the platform checks against the component's catalogue as a run-time parameter.
 */
export function readParams(
  projection: DirectProjection,
  data: DirectProjectionData,
  member: MemberPlacement,
  inputs: MemberInputs,
  own: MemberInputs,
  ignoreImplicitParams?: readonly string[],
) {
  const values: Record<string, RuntimeJsonValue | null> = {};
  const runtime: Record<string, RuntimeJsonValue> = {};
  // What goes to the owner as the author's: the projection's own inputs, and the member's state bound to a parameter.
  const authored: Record<string, RuntimeJsonValue> = Object.fromEntries(Object.keys(projection.inputs)
    .filter((name) => Object.hasOwn(inputs, name)).map((name) => [name, inputs[name]!]));
  const declaration = directReadDeclaration(projection, data);
  const signature = declaration?.parameterMode === "fixed" ? Object.keys(declaration.params) : [];
  for (const param of new Set([...Object.keys(data.params), ...signature])) {
    if (ignoreImplicitParams?.includes(param) && !Object.hasOwn(data.params, param)) {
      values[param] = null;
      continue;
    }
    // The contract's one rule for where an authored value comes from: the mapping, else the member's state of the name.
    const source = authoredReadParameterSource(data.params, param, member);
    if (source && "literal" in source) values[param] = source.literal;
    else if (source && "input" in source) values[param] = inputs[source.input] ?? null;
    else if (source) {
      values[param] = inputs[param] ?? null;
      if (Object.hasOwn(inputs, param)) authored[param] = inputs[param]!;
    }
    else if (own[param] !== undefined && own[param] !== null) values[param] = runtime[param] = own[param];
    else values[param] = null;
  }
  return { values, runtime, authored };
}

/** What a datum reads now, as one comparable text: it is read again only when this changes. */
export const memberReadKey = (
  projection: DirectProjection,
  data: DirectProjectionData,
  member: MemberPlacement,
  inputs: MemberInputs,
  own: MemberInputs,
  ignoreImplicitParams?: readonly string[],
) =>
  JSON.stringify([sourceObject(data, inputs) ?? null, readParams(projection, data, member, inputs, own, ignoreImplicitParams).values]);

/** The value each of a datum's read parameters takes now (see `readParams`). */
export function paramValues(
  projection: DirectProjection,
  data: DirectProjectionData,
  member: MemberPlacement,
  inputs: MemberInputs,
  own: MemberInputs,
  ignoreImplicitParams?: readonly string[],
) {
  return readParams(projection, data, member, inputs, own, ignoreImplicitParams).values;
}

/**
 * A component's own values for one read, by parameter name: those the projection maps to an input go to that input; the
 * rest are the component's run-time values.
 */
export function runValues(projection: DirectProjection, name: string, params: MemberInputs) {
  const data = projection.data[name];
  if (!data) throw new Error(`Projection ${projection.id} declares no datum '${name}'`);
  const inputs: Record<string, RuntimeJsonValue> = {};
  const own: Record<string, RuntimeJsonValue> = {};
  for (const [param, value] of Object.entries(params)) {
    const source = data.params[param];
    if (source && "input" in source) inputs[source.input] = value;
    else own[param] = value;
  }
  return { inputs, own };
}

/**
 * Whether a datum waits for what its read cannot go without: the object it is read from, or a parameter its owner
 * requires (a type to list objects of, a node to expand). A waiting datum is read nowhere; a literal is always there.
 */
export function awaitsInputs(
  projection: DirectProjection,
  data: DirectProjectionData,
  member: MemberPlacement,
  inputs: MemberInputs,
  own: MemberInputs,
  ignoreImplicitParams?: readonly string[],
): boolean {
  if ("object" in data.source) {
    const target = stateObject(sourceObject(data, inputs));
    if (!target || target.className !== directObjectSourceType(projection, data.source.object)) return true;
  }
  const values = paramValues(projection, data, member, inputs, own, ignoreImplicitParams);
  const declaration = directReadDeclaration(projection, data);
  const required = declaration?.parameterMode === "fixed" ? declaration.requiredParams ?? [] : [];
  // An empty state, an unmapped parameter and a literal null all leave a required parameter without a value.
  return required.some(param => values[param] == null) || Object.entries(values).some(([param, value]) =>
    value == null
    && !(ignoreImplicitParams?.includes(param) && !Object.hasOwn(data.params, param))
    && readParameterUsesStateField(authoredReadParameterSource(data.params, param, member), member));
}

/** One read of a member's — a named datum, or the operations it can do — without the panel, which the host fills in. */
export type PanelMemberReadRequest =
  | (Omit<Extract<ProductPanelReadRequest, { dataName: string }>, "source"> & { operations?: never })
  | (Omit<Extract<ProductPanelReadRequest, { operations: true }>, "source"> & { dataName?: never });

/** The platform's read entry for a panel's members, as the reader: the host fills in which panel it is. */
export type PanelReadPort = (request: PanelMemberReadRequest, independent?: true) => Promise<ProductPanelReadResponse>;

/**
 * One named datum of a member, read through the platform's read entry: unread while it waits for its object or a
 * required parameter; the author's values as inputs and the component's own as run-time parameters; the owner's answer
 * checked against the result its registered read declares. A directly rendered panel and a panel's frame read the same
 * way and differ only in the port: the host's own, or the frame's request path through its bridge.
 */
export async function readMemberDatum(
  read: PanelReadPort,
  projection: DirectProjection,
  memberPath: PublisherPath,
  placement: MemberPlacement,
  name: string,
  values: MemberInputs,
  own: MemberInputs,
  ignoreImplicitParams?: readonly string[],
): Promise<MemberDataState> {
  const member = memberPath.at(-1)!.member;
  const data = projection.data[name];
  if (!data) throw new Error(`Member '${member}' declares no datum '${name}'`);
  // A datum waits for its object or a required parameter; no read is made for nothing.
  if (awaitsInputs(projection, data, placement, values, own, ignoreImplicitParams)) return { status: "awaiting" };
  // What the member's component set itself goes apart from the author's inputs, and is checked as such.
  const { runtime, authored } = readParams(projection, data, placement, values, own, ignoreImplicitParams);
  // A read the platform answered with a failure (unavailable, refused before the owner) is this datum's failure, with the
  // platform's reason; one it never answered (the request reached nothing) is unreachable. The member shows either where
  // its data would be.
  const declaration = directReadDeclaration(projection, data);
  const request: PanelMemberReadRequest = {
    memberPath, dataName: name, inputs: authored,
    ...(Object.keys(runtime).length ? { runtimeParams: runtime } : {}),
  };
  const pending = declaration?.result === "metricOutput" ? read(request, true) : read(request);
  const result: MemberDataState = await pending.catch((reason: unknown) => {
    const code = reason && typeof reason === "object" && typeof (reason as { code?: unknown }).code === "string"
      ? (reason as { code: string }).code
      : reason && typeof reason === "object" && (reason as { status?: unknown }).status === 409
        ? "GRAPH_VERSION_CHANGED"
        : undefined;
    return {
      status: "error" as const,
      message: reason instanceof Error ? reason.message : String(reason),
      ...(code ? { code } : {}),
      // A browser or gateway failure has no reader-facing explanation.
      ...(reason instanceof TypeError || reason instanceof SyntaxError ? { unreachable: true as const } : {}),
    };
  });
  if (result.status !== "ready") return result;
  // The host's answer is checked against the result the owner registered for this read.
  if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
  return {
    status: "ready",
    value: panelReadResultSchemas[declaration.result].parse(result.value) as RuntimeJsonValue,
    ...(result.rereadAfterMs !== undefined ? { rereadAfterMs: result.rereadAfterMs } : {}),
    ...(result.rowOperations ? { rowOperations: result.rowOperations } : {}),
  };
}

/** The object a datum is read from now, when its source is one: the literal, or the input that holds it. */
function sourceObject(data: DirectProjectionData, inputs: MemberInputs): PanelFieldValue | undefined {
  if (!("object" in data.source)) return undefined;
  const object = data.source.object;
  return "literal" in object ? object.literal : (inputs[object.input] as PanelFieldValue | undefined);
}

/** Whether a member's admitted operations may have changed for the object types reported by an operation's refresh. */
function shouldRereadOperations(
  projection: DirectProjection,
  inputs: MemberInputs,
  affectedTypes: ReadonlySet<string>,
): boolean {
  const operations = projection.operations;
  if (!operations || Object.keys(operations).length === 0) return false;

  for (const data of Object.values(projection.data)) {
    if ("type" in data.source && affectedTypes.has(data.source.type.id)) return true;
    if ("object" in data.source && "literal" in data.source.object && affectedTypes.has(data.source.object.literal.className)) {
      return true;
    }
  }

  for (const value of Object.values(inputs)) {
    const object = stateObject(value);
    if (object && affectedTypes.has(object.className)) return true;
    const child = stateChildObject(value);
    if (child && affectedTypes.has(child.parent.objectType)) return true;
    for (const item of stateObjects(value)) {
      const entry = stateObject(item as PanelFieldValue);
      if (entry && affectedTypes.has(entry.className)) return true;
      const childEntry = stateChildObject(item as PanelFieldValue);
      if (childEntry && affectedTypes.has(childEntry.parent.objectType)) return true;
    }
  }

  for (const binding of Object.values(operations)) {
    if (!binding.target) return true;
    if ("literal" in binding.target && affectedTypes.has(binding.target.literal.className)) return true;
    if (("row" in binding.target || "rowField" in binding.target) && Object.keys(projection.data).length === 0) {
      return true;
    }
  }

  return false;
}

export function createDirectPanelInstance(direct: PanelManifest, options: DirectPanelInstanceOptions): DirectPanelInstance {
  const projections = new Map<string, Promise<DirectProjection>>();
  /** Cached projection + component resolution per member so repeated slot instances load each definition once. */
  const definitions = new Map<string, Promise<{ projection: DirectProjection; component: Component }>>();
  /** The revision each member's projection was last read at. */
  const readRevisions = new Map<string, number>();
  /** The newest revision reported for each projection ID, to reconcile in-flight initial reads without duplicating them. */
  const latestRevisions = new Map<string, number>();
  const versions = shallowReactive(new Map<string, number>());
  let active = true;
  /** A member's segment of a path: its key, and for one placed from the panel's state the selection that chose it. */
  const segmentOf = (member: string): PanelMemberPath[number] => {
    const target = direct.members[member]?.target;
    if (!target || !("fromState" in target)) return { member };
    const stateValue = (instance.state.values.value[target.fromState] ?? null) as RuntimeJsonValue;
    const chosen = chosenTarget(direct, member, stateValue);
    // A detail panel's member reads and operates nothing of its own: what it places is found by the object, below.
    return chosen && chosen !== "objectDetail" ? { member, selection: { stateValue, target: chosen } } : { member };
  };
  /** The segment the host reads a placed panel at: the member's, or for an object's detail the object alone. */
  const nestedSegment = (member: string): ProductPanelNestedReadRequest["memberPath"][number] => {
    const target = direct.members[member]!.target;
    const stateValue = "fromState" in target ? instance.state.values.value[target.fromState] ?? null : null;
    return chosenTarget(direct, member, stateValue) === "objectDetail"
      ? { member, selection: { stateValue: stateObject(stateValue as PanelFieldValue)! } }
      : segmentOf(member);
  };
  const notify: NonNullable<PanelInstanceOptions["notify"]> =
    options.notify ?? (({ kind, text }) => {
      // Mount toasts on the page region container (the overlay root's parent) rather than the per-panel overlay root
      // so a toast emitted right before navigating to another panel in the same area (e.g. create -> detail, delete ->
      // list) stays visible instead of being hidden or removed when the source panel leaves.
      const appendTo = options.overlayRoot?.isConnected
        ? options.overlayRoot.parentElement ?? options.overlayRoot
        : undefined;
      ElMessage({
        type: kind,
        message: text,
        grouping: true,
        ...(appendTo ? { appendTo } : {}),
      });
    });
  const instance = createPanelInstance(direct, {
    ...options,
    overlayRoot: options.overlayRoot,
    notify,
    segmentOf,
    // The shared machinery reads no projection of a direct panel; its members are read here.
    readProjection: () => Promise.reject(new Error("A direct panel's members read their projections through the instance")),
  });
  /** Every datum shown now, with how to read it again when an operation reports its source changed. */
  const shown = new Set<{
    data: DirectProjectionData;
    inputs: () => MemberInputs;
    isMetricOutput: boolean;
    sourceObjectTypes: () => readonly string[] | undefined;
    reread(): Promise<void>;
    pauseReread(): void;
    resumeReread(): void;
  }>();
  /** Every member's operations read now, read again when refreshed or when an affected type matches. */
  const operationReads = new Set<{
    projection: DirectProjection;
    inputs: () => MemberInputs;
    reread(): Promise<void>;
  }>();
  /** Where the members the instance holds live, each in its own scope, so a member held anew ends the old one. */
  const membersScope = effectScope();
  const members = new Map<string, { scope: EffectScope; placing: Promise<MemberPlacing> }>();
  let pendingPlacings = 0;
  /** The panels placed in this instance's members, which follow it as it is refreshed, seen and changed. */
  const nestedMounts = new Set<NestedPanelMount>();
  // That anything may have changed — the page header's refresh, or the page's own code keeping what it shows current
  // (`refreshObjects()`) — reads everything shown again: every datum, every member's operations and every panel placed
  // here; the components that read their own data hear it as well.
  instance.onObjectChanged((object) => {
    if (object !== null) return;
    const tasks: Promise<unknown>[] = [];
    for (const { reread } of shown) tasks.push(reread());
    for (const { reread } of operationReads) tasks.push(reread());
    for (const mount of nestedMounts) mount.refresh(null);
    if (tasks.length) return Promise.allSettled(tasks);
  });
  /** The projection a member places now: its fixed one, or the one the panel's state chose; none for a panel. */
  const placedProjectionId = (member: string): string | null => {
    const declaration = direct.members[member];
    if (!declaration) throw new Error(`The panel declares no member '${member}'`);
    const { target } = declaration;
    if ("projectionId" in target) return target.projectionId;
    if ("fromState" in target) {
      const selection = segmentOf(member).selection;
      return selection && "target" in selection && "projectionId" in selection.target ? selection.target.projectionId : null;
    }
    return null;
  };
  /** A member placed anew: what it held ends, and whoever draws it draws it again. */
  function release(member: string) {
    projections.delete(member);
    definitions.delete(member);
    readRevisions.delete(member);
    versions.set(member, (versions.get(member) ?? 0) + 1);
    const held = members.get(member);
    if (!held) return;
    held.scope.stop();
    members.delete(member);
  }
  /** The state a placed panel's inputs take from this instance, by the placed panel's names. */
  const nestedInputs = (member: string) => Object.fromEntries(Object.entries(direct.members[member]!.inputs ?? {}).map(([name, from]) => [
    name, memberInputValue(instance, from) ?? null,
  ])) as Record<string, PanelFieldValue>;
  /** Holds the projection a member places: its inputs, its operations as its owners admit them, and its data. */
  async function placeProjection(member: string, scope: EffectScope): Promise<MemberPlacing> {
    const projection = await directInstance.projectionOf(member);
    const context = scope.run(() => {
      const inputs = computed(() => slotInputValues(instance, member));
      const operations = directInstance.memberOperations(member, projection, () => inputs.value);
      const memberContext: PanelMemberContext = {
        key: member,
        projection,
        inputs,
        operations,
        data: directInstance.memberData(member, projection, () => inputs.value),
      };
      onScopeDispose(instance.register({
        slot: member, projectionId: projection.id, ports: portsOf(projection),
        get operations() { return admittedOperations(operations.value); },
        ...(projection.operations ? { operationBindings: projection.operations } : {}),
      }));
      return memberContext;
    })!;
    return { kind: "projection", context };
  }
  /**
   * The entry the reader opened, in its frame: the content the host admitted and runs is placed in an element of this
   * member's, never started again here, and taken out when the member lets it go. Outside a frame there is none.
   */
  function placeCurrentEntry(scope: EffectScope): MemberPlacing {
    const current = options.currentEntry;
    if (!current) return { kind: "outsideFrame" };
    const element = document.createElement("div");
    element.className = "sdk-current-entry";
    const placed = current.place(element);
    scope.run(() => onScopeDispose(() => placed.dispose()));
    return { kind: "panel", element, failure: shallowRef(null) };
  }
  /** Runs the panel a member places, publishing into this instance and following it until the member is placed anew. */
  async function placePanel(member: string, scope: EffectScope): Promise<MemberPlacing> {
    const failure = shallowRef<Error | null>(null);
    const outputs = Object.entries(direct.members[member]!.outputs ?? {});
    const run: DirectPanelRun = {
      pageKey: options.pageKey, url: options.url, label: options.label,
      initial: nestedInputs(member) as never,
      boundOutputs: new Set(outputs.map(([name]) => name)),
      // The placed panel's state stays its own; what this one takes of it is its declared outputs, read below.
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {},
      failed: (reason) => { failure.value = reason instanceof Error ? reason : new Error(String(reason)); },
      // The theme this panel gives where it places the other: the host lays it over that panel's own.
      ...(direct.members[member]!.theme ? { theme: direct.members[member]!.theme } : {}),
      ...(options.frameState ? { frameState: options.frameState } : {}),
      ...(options.registerBackHandler ? { registerBackHandler: options.registerBackHandler } : {}),
      ...(options.navigateBack ? { navigateBack: (fallback: string) => options.navigateBack!(fallback) } : {}),
      ...(options.confirmLeaveUnsaved ? { confirmLeaveUnsaved: options.confirmLeaveUnsaved } : {}),
      ...(options.currentUser ? { currentUser: options.currentUser } : {}),
    };
    const { element, mount } = await options.nested([nestedSegment(member)], run);
    scope.run(() => {
      nestedMounts.add(mount);
      const placed = mount.instance;
      onScopeDispose(instance.publish(member, computed(() => ({
        instanceId: placed.instanceId,
        formRegistries: placed.formRegistries,
        operations: placed.operations.value,
        dirty: () => placed.dirty(),
        context: placed.pageContext.value,
        findAffectedDirtyForms: (changedKeys, nextValues) => placed.findAffectedDirtyForms(changedKeys, nextValues),
        allDirtyForms: () => placed.allDirtyForms(),
        memberInstances: () => placed.memberInstances(),
        entryInstances: () => placed.entryInstances(),
        checkedKeys: () => placed.checkedKeys(),
        isLoading: () => mount.isLoading?.() ?? false,
        fillForm: (request) => placed.fillForm(request),
        executeAction: (request) => placed.executeAction(request),
      }))));
      // Apply changes that arrived while the child was mounting, then follow the live bindings.
      watch(() => JSON.stringify(nestedInputs(member)), (next, previous) => {
        if (next !== (previous ?? JSON.stringify(run.initial))) placed.state.setState(nestedInputs(member));
      }, { immediate: true });
      for (const [name, to] of outputs)
        watch(() => placed.state.values.value[name], (value) => instance.state.set(to.state, (value ?? null) as never), { immediate: true });
      onScopeDispose(() => {
        nestedMounts.delete(mount);
        placed.markDisposed();
        mount.dispose();
      });
    });
    return { kind: "panel", element, failure };
  }

  const addressPending = shallowRef(false);
  const localDraftVersion = ref(0);
  if (options.localDrafts) {
    membersScope.run(() => {
      onScopeDispose(options.localDrafts!.subscribe(() => {
        localDraftVersion.value++;
      }));
    });
  }

  const notifyOperationCompleted = instance.operationCompleted;
  const directInstance: DirectPanelInstance = Object.assign(instance, {
    overlayRoot: options.overlayRoot,
    windowOverlayRoot: options.windowOverlayRoot,
    overlayShown: computed(() => options.shown?.() ?? true),
    currentEntry: computed(() => options.currentEntry?.entry.value ?? null),
    entryMenu: computed(() => options.currentEntry?.menu.value ?? null),
    hostMenu: computed(() => options.currentEntry?.hostMenu?.value ?? null),
    currentUser: computed<PanelCurrentUser | null>(() => {
      const raw = options.currentUser?.() ?? null;
      const name = raw?.displayName?.trim();
      return name ? { displayName: name } : null;
    }),
    ...(options.localDrafts ? { localDrafts: options.localDrafts } : {}),
    hasLocalDraft(target: PanelObjectRef) {
      void localDraftVersion.value;
      return Boolean(options.localDrafts?.hasObject(target.className, target.primaryKey));
    },
    direct,
    readComponentPackage: options.readComponentPackage,
    loadDomainComponent: options.loadDomainComponent,
    text: options.text,
    frameState: () => options.frameState?.(),
    async expandPageComposer(entry: PageComposerRequest, click?: MouseEvent) {
      if (entry.submit || entry.newSession) {
        if (!click?.isTrusted || !click.currentTarget || !entry.slot) {
          throw new Error("This conversation entry requires a reader click");
        }
        const projection = await directInstance.projectionOf(entry.slot);
        const matchesEntry = (candidate: { target: unknown; submit?: boolean; newSession?: boolean } | undefined) =>
          Boolean(
            candidate
            && JSON.stringify(candidate.target) === JSON.stringify(entry.target)
            && candidate.submit === entry.submit
            && candidate.newSession === entry.newSession,
          );
        const declared = projection.conversationEntry;
        const rowActionItems = (projection.config as { rowActions?: { items?: readonly unknown[] } } | undefined)?.rowActions?.items;
        const matchedRowAction = Array.isArray(rowActionItems) && rowActionItems.some((raw) => {
          if (!raw || typeof raw !== "object") return false;
          const item = raw as { kind?: unknown; target?: unknown; submit?: boolean; newSession?: boolean };
          if (item.kind !== "conversation") return false;
          return matchesEntry({
            target: item.target ?? declared?.target ?? { kind: "page-default" },
            submit: item.submit ?? declared?.submit,
            newSession: item.newSession ?? declared?.newSession,
          });
        });
        if (!matchesEntry(declared) && !matchedRowAction) {
          throw new Error("This conversation entry is not declared by the panel");
        }
      }
      await options.expandPageComposer(entry);
    },
    navigate: options.navigate,
    navigateBack: (fallback: string) => (options.navigateBack ? options.navigateBack(fallback) : options.navigate(fallback)),
    projectionOf(member: string) {
      let found = projections.get(member);
      if (!found) {
        const id = placedProjectionId(member);
        if (id === null) throw new Error(`Member '${member}' places no projection now`);
        const dynamic = "fromState" in direct.members[member]!.target;
        const readPromise = dynamic ? options.readProjection(id, { dynamic: true }) : options.readProjection(id);
        found = readPromise.then((projection) => {
          if (projections.get(member) === found) {
            readRevisions.set(member, projection.revision);
            const newest = latestRevisions.get(id);
            if (newest !== undefined && projection.revision < newest) {
              queueMicrotask(() => directInstance.projectionChanged(id, newest));
            }
          }
          return projection;
        }).catch((reason: unknown) => {
          if (projections.get(member) === found) projections.delete(member);
          // Whether the reader may use it, or it is there at all, is what the member says in its place, as it is.
          if (reason instanceof PanelMemberUnavailable) throw reason;
          const message = reason instanceof Error ? reason.message : String(reason);
          throw new Error(`Member '${member}': ${message}`, { cause: reason });
        });
        projections.set(member, found);
      }
      return found;
    },
    memberDefinition(member: string) {
      let found = definitions.get(member);
      if (!found) {
        found = directInstance.projectionOf(member).then(async (projection) => {
          const componentId = memberComponentId(projection);
          const component = isDomainComponentId(componentId)
            ? await directInstance.loadDomainComponent?.(projection)
            : await (await import("../catalogue-components")).componentFor(componentId, directInstance.readComponentPackage);
          if (!component) throw new Error(`Component '${componentId}' has no runtime for this projection`);
          return { projection, component };
        }).catch((reason: unknown) => {
          if (definitions.get(member) === found) definitions.delete(member);
          throw reason;
        });
        definitions.set(member, found);
      }
      return found;
    },
    async memberContext(member: string) {
      const placing = await directInstance.placing(member);
      if (placing.kind === "projection") return placing.context;
      if (placing.kind === "panel") throw new Error(`Member '${member}' places a panel: its data and operations are that panel's`);
      throw new Error(`Member '${member}' waits for the panel's state to choose what it places`);
    },
    placing(member: string) {
      const held = members.get(member);
      if (held) return held.placing;
      if (!Object.hasOwn(direct.members, member)) throw new Error(`The panel declares no member '${member}'`);
      const declaration = direct.members[member]!;
      const scope = membersScope.run(() => effectScope())!;
      const { target } = declaration;
      if ("fromPlatform" in target) {
        const placing = Promise.resolve(placeCurrentEntry(scope));
        members.set(member, { scope, placing });
        return placing;
      }
      const chosen = "fromState" in target ? chosenTarget(direct, member, instance.state.values.value[target.fromState] ?? null) : undefined;
      const isAsyncPlacement = chosen !== null;
      if (isAsyncPlacement) pendingPlacings += 1;
      const placing: Promise<MemberPlacing> = chosen === null
        ? Promise.resolve({ kind: "awaiting" })
        : "panelId" in target || chosen === "objectDetail" || (chosen !== undefined && "panelId" in chosen)
          ? placePanel(member, scope)
          : placeProjection(member, scope);
      const tracked = placing.catch((reason: unknown) => {
        if (members.get(member)?.placing === tracked) {
          scope.stop();
          members.delete(member);
        }
        throw reason;
      }).finally(() => {
        if (isAsyncPlacement) pendingPlacings -= 1;
      });
      members.set(member, { scope, placing: tracked });
      return tracked;
    },
    async placingScoped(member: string, overrideInputs: () => MemberInputs, rowItemKey?: import("@ontomato/contracts/panel-manifest").PanelMemberItemKey) {
      if (!Object.hasOwn(direct.members, member)) throw new Error(`The panel declares no member '${member}'`);
      const projection = await directInstance.projectionOf(member);
      const scope = membersScope.run(() => effectScope())!;
      const ownParamsRef = shallowRef<Record<string, RuntimeJsonValue>>({});
      const context = scope.run(() => {
        const inputs = computed<MemberInputs>(() => ({
          ...slotInputValues(instance, member),
          ...overrideInputs(),
        }));
        const operations = directInstance.memberOperations(member, projection, () => inputs.value);
        const param = (name: string) => ({
          value: computed(() => ownParamsRef.value[name] ?? null),
          set(value: RuntimeJsonValue | null) {
            const next = { ...ownParamsRef.value };
            if (value === null) delete next[name];
            else next[name] = value;
            ownParamsRef.value = next;
            return true as const;
          },
        });
        const memberContext: PanelMemberContext = {
          key: member,
          projection,
          inputs,
          operations,
          param,
          scoped: true,
          ...(rowItemKey !== undefined ? { rowItemKey } : {}),
          data: directInstance.memberData(member, projection, () => inputs.value, () => ownParamsRef.value, true),
        };
        return memberContext;
      })!;
      return { context, dispose: () => scope.stop() };
    },
    memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs, ownParams?: () => MemberInputs, scoped = false): MemberData {
      const own = ownParams ?? (() => instance.ownParams(member));
      const placement = direct.members[member]!;
      const answer = (name: string, values: MemberInputs, ownRun: MemberInputs = own(), ignoreImplicitParams?: readonly string[]) =>
        readMemberDatum(options.read, projection, instance.memberPathOf(member), placement, name, values, ownRun, ignoreImplicitParams);
      const readers = new Map<string, Set<() => void>>();

      return {
        use(name, useOptions) {
          const fixedParams = useOptions?.fixedParams;
          const ignoreImplicitParams = useOptions?.ignoreImplicitParams;
          const ownForDatum = (): MemberInputs => (fixedParams ? { ...fixedParams, ...own() } : own());
          const state = shallowRef<MemberDataState>({ status: "loading" });
          const loadedTargetKey = shallowRef<string | null>(null);
          let sequence = 0;
          const entryData = projection.data[name]!;
          const declaration = directReadDeclaration(projection, entryData);
          const declaredReadOutputs = !scoped && declaration?.outputs ? Object.entries(declaration.outputs) : [];
          const isMetricOutput = declaration?.result === "metricOutput";
          const isObjectDatum = "object" in entryData.source;
          const requiredParams = declaration?.parameterMode === "fixed" ? declaration.requiredParams ?? [] : [];
          const hasTarget = isObjectDatum || requiredParams.length > 0;
          const datumTargetKeyOf = (): string | null => {
            if (!hasTarget) return null;
            const object = isObjectDatum ? (sourceObject(entryData, inputs()) ?? null) : null;
            if (requiredParams.length === 0) return JSON.stringify(object);
            const values = paramValues(projection, entryData, placement, inputs(), ownForDatum(), ignoreImplicitParams);
            return JSON.stringify([object, requiredParams.map((param) => values[param] ?? null)]);
          };
          let lastTargetKey: string | null = null;
          let lastReady: MemberReadyData | undefined;
          let metricSourceObjectTypes: readonly string[] | undefined;
          const snapshotReady = (ready: Extract<MemberDataState, { status: "ready" }>): MemberReadyData =>
            ready.rowOperations !== undefined
              ? { status: "ready", value: ready.value, rowOperations: ready.rowOperations }
              : { status: "ready", value: ready.value };
          let rereadTimer: ReturnType<typeof setTimeout> | null = null;
          let pendingRereadAfterMs: number | undefined;
          let datumDisposed = false;
          const isDocumentVisible = () => (typeof document === "undefined" ? true : documentVisible());
          const clearRereadTimer = () => {
            if (rereadTimer !== null) {
              clearTimeout(rereadTimer);
              rereadTimer = null;
            }
          };
          const scheduleReread = (delayMs: number) => {
            clearRereadTimer();
            if (datumDisposed || !active || !isDocumentVisible()) return;
            rereadTimer = setTimeout(() => {
              rereadTimer = null;
              if (datumDisposed || !active || !isDocumentVisible()) return;
              void reread();
            }, delayMs);
          };
          const reread = (): Promise<void> => {
            clearRereadTimer();
            // Unseen, the instance reads nothing; `lastTargetKey` stays on the last target read while active so
            // returning to a different target clears the stale record immediately.
            if (!active || datumDisposed) return Promise.resolve();
            const reading = ++sequence;
            const nextTargetKey = datumTargetKeyOf();
            const targetChanged = hasTarget && nextTargetKey !== lastTargetKey;
            lastTargetKey = nextTargetKey;
            // Re-reading the same target keeps the shown record on screen until the new answer arrives. Switching to
            // a different target (or clearing it) drops the previous target's ready state immediately so neither the
            // view nor derived outputs treat the earlier target's data as ready for the new target.
            if (targetChanged) {
              lastReady = undefined;
              state.value = awaitsInputs(projection, entryData, placement, inputs(), ownForDatum(), ignoreImplicitParams)
                ? { status: "awaiting" }
                : { status: "loading" };
            } else if (state.value.status === "ready") {
              if (!state.value.refreshing) {
                state.value = { ...state.value, refreshing: true };
              }
            } else {
              state.value = lastReady ? { status: "loading", previous: lastReady } : { status: "loading" };
            }
            // An answer for an earlier read (an earlier selection) is dropped once a later read was asked for.
            return answer(name, inputs(), ownForDatum(), ignoreImplicitParams).then((result) => {
              if (datumDisposed || reading !== sequence) return;
              if (isMetricOutput && result.status === "ready" && result.value && typeof result.value === "object" && !Array.isArray(result.value)) {
                const rawTypes = (result.value as { sourceObjectTypes?: unknown }).sourceObjectTypes;
                if (Array.isArray(rawTypes) && rawTypes.every((item): item is string => typeof item === "string")) {
                  metricSourceObjectTypes = rawTypes;
                }
              }
              loadedTargetKey.value = nextTargetKey;
              if (result.status === "ready") {
                lastReady = snapshotReady(result);
                state.value = result;
                if (result.rereadAfterMs !== undefined) {
                  pendingRereadAfterMs = result.rereadAfterMs;
                  scheduleReread(result.rereadAfterMs);
                } else {
                  pendingRereadAfterMs = undefined;
                  clearRereadTimer();
                }
              } else if (result.status === "error") {
                pendingRereadAfterMs = undefined;
                clearRereadTimer();
                // A failure is read again on request, and keeps the same target's last ready answer beside the reason.
                state.value = withMemberReadRetry(result, lastReady, () => { void reread(); });
              } else {
                pendingRereadAfterMs = undefined;
                clearRereadTimer();
                // Losing permission (`forbidden`), `empty`, or `awaiting` clears any previous answer immediately.
                lastReady = undefined;
                state.value = result;
              }
            });
          };
          const pauseReread = () => {
            clearRereadTimer();
          };
          const resumeReread = () => {
            if (datumDisposed || !active || pendingRereadAfterMs === undefined || !isDocumentVisible()) return;
            reread();
          };
          const stopVisibility = typeof document !== "undefined"
            ? onDocumentVisibility((visible) => {
                if (!visible) clearRereadTimer();
                else if (active && pendingRereadAfterMs !== undefined && !datumDisposed) reread();
              })
            : undefined;
          const entry = {
            data: entryData,
            inputs,
            isMetricOutput,
            sourceObjectTypes: () => metricSourceObjectTypes,
            reread,
            pauseReread,
            resumeReread,
          };
          shown.add(entry);
          let namedReaders = readers.get(name);
          if (!namedReaders) {
            namedReaders = new Set();
            readers.set(name, namedReaders);
          }
          namedReaders.add(reread);
          watch(() => memberReadKey(projection, entry.data, placement, inputs(), ownForDatum(), ignoreImplicitParams), () => {
            clearRereadTimer();
            if (!active) pendingRereadAfterMs = undefined;
            reread();
          }, { immediate: true });
          const effectiveState = computed<MemberDataState>(() => {
            if (addressPending.value && hasTarget) return { status: "loading" };
            const hasTargetData = state.value.status === "ready"
              || ((state.value.status === "error" || state.value.status === "loading") && state.value.previous !== undefined);
            if (hasTarget && hasTargetData && datumTargetKeyOf() !== loadedTargetKey.value) {
              return awaitsInputs(projection, entryData, placement, inputs(), ownForDatum(), ignoreImplicitParams)
                ? { status: "awaiting" }
                : { status: "loading" };
            }
            return state.value;
          });
          if (declaredReadOutputs.length > 0) {
            // Publish only named, typed scalar outputs explicitly declared by the read's owner.
            watch(
              effectiveState,
              (current) => {
                const rawOutputs = current.status === "ready" && current.value && typeof current.value === "object" && !Array.isArray(current.value)
                  ? (current.value as { outputs?: unknown }).outputs
                  : undefined;
                const map = rawOutputs && typeof rawOutputs === "object" && !Array.isArray(rawOutputs)
                  ? (rawOutputs as Record<string, unknown>)
                  : undefined;
                for (const [outputName, outputType] of declaredReadOutputs) {
                  const raw = map && Object.hasOwn(map, outputName) ? map[outputName] : undefined;
                  const valid =
                    (outputType.type === "boolean" && typeof raw === "boolean")
                    || (outputType.type === "string" && typeof raw === "string")
                    || (outputType.type === "number" && typeof raw === "number" && Number.isFinite(raw));
                  instance.setMemberOutput(member, outputName, valid ? (raw as RuntimeJsonValue) : null);
                }
              },
              { immediate: true },
            );
          }
          onScopeDispose(() => {
            datumDisposed = true;
            pendingRereadAfterMs = undefined;
            clearRereadTimer();
            stopVisibility?.();
            shown.delete(entry);
            const set = readers.get(name);
            if (set) {
              set.delete(reread);
              if (set.size === 0) readers.delete(name);
            }
            for (const [outputName] of declaredReadOutputs) instance.setMemberOutput(member, outputName, null);
          });
          return effectiveState;
        },
        read: (name, params, overrides = {}) => {
          const { inputs: run, own: ownRun } = runValues(projection, name, params);
          return answer(name, { ...inputs(), ...overrides, ...run }, { ...own(), ...ownRun });
        },
        refresh: (name) => {
          if (name !== undefined) {
            const set = readers.get(name);
            if (set) for (const fn of set) fn();
            return;
          }
          for (const set of readers.values()) for (const fn of set) fn();
        },
      };
    },
    memberOperations(member: string, projection: DirectProjection, inputs: () => MemberInputs) {
      const { state, reread } = watchMemberOperations(options.read, projection, () => instance.memberPathOf(member), inputs, () => active);
      const entry = { projection, inputs, reread };
      operationReads.add(entry);
      onScopeDispose(() => operationReads.delete(entry));
      return state;
    },
    operationCompleted(event: PanelOperationCompletion) {
      notifyOperationCompleted(event);
      for (const mount of nestedMounts) mount.instance.operationCompleted(event);
    },
    refresh(affected: PanelOperationAffected, operation?: PanelCompletedOperation) {
      if (operation) instance.operationCompleted({ operation, affected });
      // What the write removed is let go of first, so nothing below reads it again.
      if (affected.removed) instance.letGo(affected.removed);
      const affectedTypes = new Set<string>([
        ...affected.objectTypes,
        ...affected.objects.map((changed) => changed.objectType),
        ...(affected.removed?.map((removed) => removed.objectType) ?? []),
      ]);
      for (const { data, inputs, isMetricOutput, sourceObjectTypes, reread } of shown) {
        const object = stateObject(sourceObject(data, inputs()));
        if (object && affected.objects.some((changed) => changed.objectType === object.className && changed.primaryKey === object.primaryKey)) {
          reread();
        } else if ("type" in data.source && affected.objectTypes.includes(data.source.type.id)) {
          reread();
        } else if (isMetricOutput && affectedTypes.size > 0) {
          const dependencies = sourceObjectTypes();
          if (dependencies === undefined || dependencies.some((type) => affectedTypes.has(type))) {
            reread();
          }
        }
      }
      if (affectedTypes.size > 0) {
        for (const entry of operationReads) {
          if (shouldRereadOperations(entry.projection, entry.inputs(), affectedTypes)) {
            entry.reread();
          }
        }
      }
      if (affectedTypes.has(OBJECT_TYPE)) {
        const affectedClasses = new Set(
          affected.objects.filter((item) => item.objectType === OBJECT_TYPE).map((item) => item.primaryKey),
        );
        for (const [member, declaration] of Object.entries(direct.members)) {
          const { target } = declaration;
          if (!("fromState" in target) || !("rule" in target.candidates) || target.candidates.rule !== "objectDetail") continue;
          const selectedRef = stateObject(instance.state.values.value[target.fromState] ?? null);
          if (!selectedRef || (affectedClasses.size > 0 && !affectedClasses.has(selectedRef.className))) continue;
          const held = members.has(member);
          release(member);
          if (held) void directInstance.placing(member).catch(() => undefined);
        }
      }
      for (const object of affected.objects) instance.objectChanged(object);
      // What changed may be shown by a panel placed here, too.
      for (const mount of nestedMounts) mount.refresh(null, affected);
    },
    addressPending,
    setAddressPending(pending: boolean) {
      addressPending.value = pending;
    },
    setActive(next: boolean) {
      const wasActive = active;
      active = next;
      if (!next) {
        for (const entry of shown) entry.pauseReread();
      } else if (!wasActive) {
        for (const entry of shown) entry.resumeReread();
      }
      for (const mount of nestedMounts) mount.activate(next);
    },
    projectionChanged(id: string, revision?: number) {
      if (revision !== undefined) {
        latestRevisions.set(id, Math.max(latestRevisions.get(id) ?? 0, revision));
      }
      for (const member of Object.keys(direct.members)) {
        if (placedProjectionId(member) !== id) continue;
        if (revision !== undefined) {
          if (readRevisions.has(member)) {
            if (revision <= readRevisions.get(member)!) continue;
          } else if (projections.has(member)) {
            // Initial read is still in flight; it will reconcile against `latestRevisions` once it resolves.
            continue;
          }
        }
        // A member the instance held is held anew from the newer definition, drawn or not.
        const held = members.has(member);
        release(member);
        if (held) void directInstance.placing(member).catch(() => undefined);
      }
      for (const mount of nestedMounts)
        mount.projectionsChanged([revision === undefined ? { id } : { id, revision }]);
    },
    projectionVersion: (member: string) => versions.get(member) ?? 0,
    isLoading: () => pendingPlacings > 0 || [...nestedMounts].some((mount) => mount.isLoading?.() ?? false),
    notify,
    ...(options.registerBackHandler ? { registerBackHandler: options.registerBackHandler } : {}),
    ...(options.confirmLeaveUnsaved ? { confirmLeaveUnsaved: options.confirmLeaveUnsaved } : {}),
  });
  // A member placed from the panel's state is placed anew when that state chooses something else: what it held ends
  // (a placed panel is let go, its operations and context leave this instance) and whoever draws it draws the new one.
  for (const [member, declaration] of Object.entries(direct.members)) {
    const { target } = declaration;
    if (!("fromState" in target)) continue;
    membersScope.run(() => watch(() => JSON.stringify(instance.state.values.value[target.fromState] ?? null), () => {
      const held = members.has(member);
      release(member);
      if (held) void directInstance.placing(member).catch(() => undefined);
    }));
  }
  return directInstance;
}

/**
 * The panel context its members' components read in the platform's document: the instance, its declaration as the
 * shared machinery reads it and its words. What only a frame has — the definition handed to it, its resource clients'
 * requests, frame operations such as an upload — is not there, and asking for it says so.
 */
export function directPanelContext(instance: DirectPanelInstance): PanelContext {
  const frameOnly = (what: string) => () => { throw new Error(`${what} is a panel frame's; a directly rendered panel has none`); };
  return {
    overlayRoot: instance.overlayRoot,
    windowOverlayRoot: instance.windowOverlayRoot,
    overlayShown: instance.overlayShown,
    get panel(): never { return frameOnly("The handed-over definition")(); },
    manifest: instance.manifest,
    instance,
    refreshing: instance.refreshing,
    refreshObjects: () => instance.refreshObjects(),
    currentEntry: instance.currentEntry,
    entryMenu: instance.entryMenu,
    hostMenu: instance.hostMenu,
    currentUser: instance.currentUser,
    hasLocalDraft: (ref) => instance.hasLocalDraft(ref),
    projection: frameOnly("Reading a projection record"),
    invoke: frameOnly("Running a frame operation"),
    projectionsChanged: () => () => {},
    holdUnsaved: () => () => {},
    t: instance.text,
    resources: () => Promise.resolve(),
    // The member's projection is the platform's own record here: its declared entry goes to the page's composer as it is.
    expandPageComposer: async (entry, click) => instance.expandPageComposer(entry, click),
    navigate: (address) => instance.navigate(address),
    navigateBack: (fallback) => instance.navigateBack(fallback),
    notify: (message) => instance.notify(message),
    // A member here reads through the instance's own port; nothing asks the context for it.
    readPanelData: frameOnly("Reading a member's data over the frame's request path"),
    ...(instance.registerBackHandler ? { registerBackHandler: instance.registerBackHandler } : {}),
    ...(instance.confirmLeaveUnsaved ? { confirmLeaveUnsaved: instance.confirmLeaveUnsaved } : {}),
  };
}
