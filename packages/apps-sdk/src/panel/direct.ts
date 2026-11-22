import { computed, effectScope, onScopeDispose, shallowReactive, shallowRef, watch, type Component, type ComputedRef, type EffectScope, type Ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import { PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { DirectPanelRun } from "@ontomato/platform-shell";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { panelOperationAffectedSchema, panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { ApplicationEntryMenu, CurrentApplicationEntry, DirectProjection } from "@ontomato/contracts/product-panels";
import type { PanelDataState, ProductPanelNestedReadRequest, ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { createPanelInstance, type PanelInstance, type PanelInstanceOptions, type PublisherPath } from "./instance";
import type { ComponentPackageReader } from "./component-packages";
import { stateObject, type PanelFieldValue } from "./state";
import type { PanelText } from "./text";
import type { PanelContext } from "./context";
import { admittedOperations, watchMemberOperations, type MemberOperationsState } from "./member-operations";
import type { PanelMemberContext } from "./member";
import { portsOf, readsOwnerForm } from "./ports-of";
import { slotInputValues } from "./ports";

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

/**
 * One named datum of a member as a component shows it: the host's answer, still loading, or awaiting a selection. A
 * failure carries `retry`, which reads it again; one the platform never answered (the page reached nothing) is
 * `unreachable`, and is worded in the reader's language where it is shown, not with the browser's own words.
 */
export type MemberDataState =
  | Exclude<PanelDataState, { status: "error" }>
  | { status: "error"; message: string; unreachable?: true; retry?: () => void }
  | { status: "awaiting" };

/** A projection input's value: a JSON value as the member and the run supply it; absent while nothing is supplied. */
export type MemberInputs = Readonly<Record<string, RuntimeJsonValue>>;

/** A member's placement as a read's parameters see it: the panel state its inputs and outputs bind. */
export type MemberPlacement = Pick<PanelManifest["members"][string], "inputs" | "outputs">;

export interface DirectPanelInstanceOptions extends Omit<PanelInstanceOptions, "readProjection"> {
  /** Only for an application's frame: the entry the platform resolved, its menu, and where its content goes. */
  currentEntry?: DirectPanelRun["currentEntry"];
  /** Reads an installed component package's current release, for a member whose component is the package's. */
  readComponentPackage: ComponentPackageReader;
  loadDomainComponent?(projection: DirectProjection): Promise<Component>;
  /** Reads one named datum of one member, as the platform's read entry answers it for this panel's source. */
  read: PanelReadPort;
  /** Reads a member's current projection by ID, as the reader. */
  readProjection(id: string): Promise<DirectProjection>;
  /**
   * Expands the page's composer with a conversation entry a member's projection declares: its agent and its opening
   * sentence. The record is the platform's own read, so the entry needs no check against it; nothing is sent.
   */
  expandPageComposer(entry: PanelConversationEntry): void;
  /**
   * Opens one of the platform's addresses. When it cannot (not the platform's address, a page the reader may not open, a
   * guard that stopped it), the host says why on the page and rejects with the same reason.
   */
  navigate(address: string): Promise<void>;
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
  projectionsChanged(projections: readonly { id: string; revision: number }[]): void;
  activate(active: boolean): void;
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
export interface MemberData {
  /**
   * The datum a component shows, kept current while the component is mounted: called in its setup, it is what makes
   * the instance read the datum at all.
   */
  use(name: string): ComputedRef<MemberDataState>;
  /**
   * One more read of a datum with values of the component's own, by the read's parameter names (a form's values and
   * changed field, a picker's keyword), and inputs it overrides (the object a form is read for). A value goes to the
   * input the projection maps its parameter to, else it is the component's run-time value. It does not replace the
   * shown datum.
   */
  read(name: string, params: MemberInputs, inputs?: MemberInputs): Promise<MemberDataState>;
}

export interface DirectPanelInstance extends PanelInstance {
  readonly direct: PanelManifest;
  /** In an application's frame, the entry shown now; null elsewhere. It follows the reader to another entry. */
  readonly currentEntry: ComputedRef<CurrentApplicationEntry | null>;
  /** In an application's frame, the menu the same resolution gave; null elsewhere. */
  readonly entryMenu: ComputedRef<ApplicationEntryMenu | null>;
  /** Reads an installed component package's current release (see the options). */
  readonly readComponentPackage: ComponentPackageReader;
  readonly loadDomainComponent?: DirectPanelInstanceOptions["loadDomainComponent"];
  /** The panel's own words, in the current language. */
  readonly text: PanelText;
  /** The page's composer, expanded with a member's declared conversation entry. */
  expandPageComposer(entry: PanelConversationEntry): void;
  /** Opens one of the platform's addresses, or says on the page why it cannot (see the options). */
  navigate(address: string): Promise<void>;
  /** The member's projection, read once for this instance: its fixed one, or the one the panel's state chose. */
  projectionOf(member: string): Promise<DirectProjection>;
  /** What the member places now, held from the start, drawn or not, and placed anew when the state choosing it changes. */
  placing(member: string): Promise<MemberPlacing>;
  /**
   * The member as the instance holds it, drawn or not: its projection, the inputs its placement fills now, its data and
   * the operations its owners admit, registered with the instance once its projection is read. A member is held once per
   * reading of its projection; one its definition changed is held anew.
   */
  memberContext(member: string): Promise<PanelMemberContext>;
  /** The data of one member, whose inputs are `inputs` as the member's placement fills them now. */
  memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs): MemberData;
  /** The operations one member can do now, as the owner admits them for its inputs; kept current while it is drawn. */
  memberOperations(member: string, projection: DirectProjection, inputs: () => MemberInputs): ComputedRef<MemberOperationsState>;
  /** An operation's reported changes: the shown data they concern are read again. */
  refresh(affected: PanelOperationAffected): void;
  /** Every shown datum is read again, and every component that reads its own data is told to. */
  refreshAll(): void;
  /** While the reader does not see the instance it reads nothing; a refresh when seen again brings it up to date. */
  setActive(active: boolean): void;
  /**
   * A projection's definition changed: its members read it again and draw it anew. A revision no later than the one a
   * member was read at (a snapshot naming every projection as it is) changes nothing for that member.
   */
  projectionChanged(id: string, revision?: number): void;
  /** How many times a member's projection was read anew, which its drawing is keyed by. */
  projectionVersion(member: string): number;
}

/**
 * What a datum's read takes now, parameter by parameter of its owner's signature, from three places in this order: the
 * projection's own mapping (a literal, or one of its inputs); the member's panel state of the same name (an input or an
 * output bound to it), which is the author's binding though the projection writes no mapping; and the member's own value
 * the component set (`params`), which the platform checks against the component's catalogue as a run-time parameter.
 */
export function readParams(projection: DirectProjection, data: DirectProjectionData, member: MemberPlacement, inputs: MemberInputs, own: MemberInputs) {
  const values: Record<string, RuntimeJsonValue | null> = {};
  const runtime: Record<string, RuntimeJsonValue> = {};
  // What goes to the owner as the author's: the projection's own inputs, and the member's state bound to a parameter.
  const authored: Record<string, RuntimeJsonValue> = Object.fromEntries(Object.keys(projection.inputs)
    .filter((name) => Object.hasOwn(inputs, name)).map((name) => [name, inputs[name]!]));
  const declaration = directReadDeclaration(projection, data);
  const signature = declaration?.parameterMode === "fixed" ? Object.keys(declaration.params) : [];
  for (const param of new Set([...Object.keys(data.params), ...signature])) {
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
export const memberReadKey = (projection: DirectProjection, data: DirectProjectionData, member: MemberPlacement, inputs: MemberInputs, own: MemberInputs) =>
  JSON.stringify([sourceObject(data, inputs) ?? null, readParams(projection, data, member, inputs, own).values]);

/** The value each of a datum's read parameters takes now (see `readParams`). */
export function paramValues(projection: DirectProjection, data: DirectProjectionData, member: MemberPlacement, inputs: MemberInputs, own: MemberInputs) {
  return readParams(projection, data, member, inputs, own).values;
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
export function awaitsInputs(projection: DirectProjection, data: DirectProjectionData, member: MemberPlacement, inputs: MemberInputs, own: MemberInputs): boolean {
  if ("object" in data.source && stateObject(sourceObject(data, inputs)) === null) return true;
  const values = paramValues(projection, data, member, inputs, own);
  const declaration = directReadDeclaration(projection, data);
  const required = declaration?.parameterMode === "fixed" ? declaration.requiredParams ?? [] : [];
  // An empty state, an unmapped parameter and a literal null all leave a required parameter without a value.
  return required.some((param) => values[param] === null || values[param] === undefined);
}

/** One read of a member's — a named datum, or the operations it can do — without the panel, which the host fills in. */
export type PanelMemberReadRequest =
  | (Omit<Extract<ProductPanelReadRequest, { dataName: string }>, "source"> & { operations?: never })
  | (Omit<Extract<ProductPanelReadRequest, { operations: true }>, "source"> & { dataName?: never });

/** The platform's read entry for a panel's members, as the reader: the host fills in which panel it is. */
export type PanelReadPort = (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse>;

/**
 * One named datum of a member, read through the platform's read entry: unread while it waits for its object or a
 * required parameter; the author's values as inputs and the component's own as run-time parameters; the owner's answer
 * checked against the result its registered read declares. A directly rendered panel and a panel's frame read the same
 * way and differ only in the port: the host's own, or the frame's request path through its bridge.
 */
export async function readMemberDatum(read: PanelReadPort, projection: DirectProjection, memberPath: PublisherPath,
  placement: MemberPlacement, name: string, values: MemberInputs, own: MemberInputs): Promise<MemberDataState> {
  const member = memberPath.at(-1)!.member;
  const data = projection.data[name];
  if (!data) throw new Error(`Member '${member}' declares no datum '${name}'`);
  // A datum waits for its object or a required parameter; no read is made for nothing.
  if (awaitsInputs(projection, data, placement, values, own)) return { status: "awaiting" };
  // What the member's component set itself goes apart from the author's inputs, and is checked as such.
  const { runtime, authored } = readParams(projection, data, placement, values, own);
  // A read the platform answered with a failure (unavailable, refused before the owner) is this datum's failure, with the
  // platform's reason; one it never answered (the request reached nothing) is unreachable. The member shows either where
  // its data would be.
  const result: MemberDataState = await read({
    memberPath, dataName: name, inputs: authored,
    ...(Object.keys(runtime).length ? { runtimeParams: runtime } : {}),
  }).catch((reason: unknown) => ({
    status: "error" as const, message: reason instanceof Error ? reason.message : String(reason),
    // No answer at all: the request reached nothing (the browser's network failure) or what came back was no answer of
    // the platform's (a gateway's page while a service is replaced). A failure the platform states keeps its words.
    ...(reason instanceof TypeError || reason instanceof SyntaxError ? { unreachable: true as const } : {}),
  }));
  if (result.status !== "ready") return result;
  // The host's answer is checked against the result the owner registered for this read.
  const declaration = directReadDeclaration(projection, data);
  if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
  return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result.value) as RuntimeJsonValue };
}

/** The object a datum is read from now, when its source is one: the literal, or the input that holds it. */
function sourceObject(data: DirectProjectionData, inputs: MemberInputs): PanelFieldValue | undefined {
  if (!("object" in data.source)) return undefined;
  const object = data.source.object;
  return "literal" in object ? object.literal : (inputs[object.input] as PanelFieldValue | undefined);
}

export function createDirectPanelInstance(direct: PanelManifest, options: DirectPanelInstanceOptions): DirectPanelInstance {
  const projections = new Map<string, Promise<DirectProjection>>();
  /** The revision each member's projection was last read at. */
  const readRevisions = new Map<string, number>();
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
  const instance = createPanelInstance(direct, {
    ...options,
    segmentOf,
    // The shared machinery reads no projection of a direct panel; its members are read here.
    readProjection: () => Promise.reject(new Error("A direct panel's members read their projections through the instance")),
  });
  /** Every datum shown now, with how to read it again when an operation reports its source changed. */
  const shown = new Set<{ data: DirectProjectionData; inputs: () => MemberInputs; reread(): void }>();
  /** Every member's operations read now, read again with everything shown. */
  const operationReads = new Set<() => void>();
  /** Where the members the instance holds live, each in its own scope, so a member held anew ends the old one. */
  const membersScope = effectScope();
  const members = new Map<string, { scope: EffectScope; placing: Promise<MemberPlacing> }>();
  /** The panels placed in this instance's members, which follow it as it is refreshed, seen and changed. */
  const nestedMounts = new Set<NestedPanelMount>();
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
    versions.set(member, (versions.get(member) ?? 0) + 1);
    const held = members.get(member);
    if (!held) return;
    held.scope.stop();
    members.delete(member);
  }
  /** The state a placed panel's inputs take from this instance, by the placed panel's names. */
  const nestedInputs = (member: string) => Object.fromEntries(Object.entries(direct.members[member]!.inputs ?? {}).map(([name, from]) => [
    name, "literal" in from ? from.literal : "state" in from ? instance.state.values.value[from.state] ?? null : null,
  ])) as Record<string, PanelFieldValue>;
  /** Holds the projection a member places: its inputs, its operations as its owners admit them, and its data. */
  async function placeProjection(member: string, scope: EffectScope): Promise<MemberPlacing> {
    const projection = await directInstance.projectionOf(member);
    const context = scope.run(() => {
      const inputs = computed(() => slotInputValues(direct, member, instance.state.values.value) as MemberInputs);
      const operations = directInstance.memberOperations(member, projection, () => inputs.value);
      onScopeDispose(instance.register({
        slot: member, projectionId: projection.id, ports: portsOf(projection),
        get operations() { return admittedOperations(operations.value); },
        takesDrafts: readsOwnerForm(projection),
      }));
      return { key: member, projection, inputs, operations, data: directInstance.memberData(member, projection, () => inputs.value) };
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
    const run: DirectPanelRun = {
      pageKey: options.pageKey, url: options.url, label: options.label,
      initial: nestedInputs(member) as never,
      // The placed panel's state stays its own; what this one takes of it is its declared outputs, read below.
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      // The page's draft is told about by the panel the reader opened, above it; a placed panel adds no notice of its own.
      draftRefused: () => {}, draftOpened: () => {},
      failed: (reason) => { failure.value = reason instanceof Error ? reason : new Error(String(reason)); },
      // The theme this panel gives where it places the other: the host lays it over that panel's own.
      ...(direct.members[member]!.theme ? { theme: direct.members[member]!.theme } : {}),
    };
    const { element, mount } = await options.nested([nestedSegment(member)], run);
    scope.run(() => {
      nestedMounts.add(mount);
      const placed = mount.instance;
      onScopeDispose(instance.publish(member, computed(() => ({
        operations: placed.operations.value, dirty: () => placed.dirty(), context: placed.pageContext.value,
      }))));
      // Its inputs follow this instance's state; its outputs write it.
      watch(() => JSON.stringify(nestedInputs(member)), () => placed.state.setState(nestedInputs(member)));
      for (const [name, to] of Object.entries(direct.members[member]!.outputs ?? {}))
        watch(() => placed.state.values.value[name], (value) => instance.state.set(to.state, (value ?? null) as never), { immediate: true });
      onScopeDispose(() => {
        nestedMounts.delete(mount);
        mount.dispose();
      });
    });
    return { kind: "panel", element, failure };
  }

  const directInstance: DirectPanelInstance = Object.assign(instance, {
    currentEntry: computed(() => options.currentEntry?.entry.value ?? null),
    entryMenu: computed(() => options.currentEntry?.menu.value ?? null),
    direct,
    readComponentPackage: options.readComponentPackage,
    loadDomainComponent: options.loadDomainComponent,
    text: options.text,
    expandPageComposer: options.expandPageComposer,
    navigate: options.navigate,
    projectionOf(member: string) {
      let found = projections.get(member);
      if (!found) {
        const id = placedProjectionId(member);
        if (id === null) throw new Error(`Member '${member}' places no projection now`);
        found = options.readProjection(id).then((projection) => {
          readRevisions.set(member, projection.revision);
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
      const scope = membersScope.run(() => effectScope())!;
      const { target } = direct.members[member]!;
      if ("fromPlatform" in target) {
        const placing = Promise.resolve(placeCurrentEntry(scope));
        members.set(member, { scope, placing });
        return placing;
      }
      const chosen = "fromState" in target ? chosenTarget(direct, member, instance.state.values.value[target.fromState] ?? null) : undefined;
      const placing: Promise<MemberPlacing> = chosen === null
        ? Promise.resolve({ kind: "awaiting" })
        : chosen === "objectDetail" || (chosen !== undefined && "panelId" in chosen)
          ? placePanel(member, scope)
          : placeProjection(member, scope);
      const tracked = placing.catch((reason: unknown) => {
        if (members.get(member)?.placing === tracked) {
          scope.stop();
          members.delete(member);
        }
        throw reason;
      });
      members.set(member, { scope, placing: tracked });
      return tracked;
    },
    memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs): MemberData {
      const own = () => instance.ownParams(member);
      const placement = direct.members[member]!;
      const answer = (name: string, values: MemberInputs, ownRun: MemberInputs = own()) =>
        readMemberDatum(options.read, projection, instance.memberPathOf(member), placement, name, values, ownRun);

      return {
        use(name) {
          const state = shallowRef<MemberDataState>({ status: "loading" });
          let sequence = 0;
          const reread = () => {
            // Unseen, the instance reads nothing; the refresh when it is seen again reads every shown datum.
            if (!active) return;
            const reading = ++sequence;
            // A datum already shown stays on screen until its new answer arrives: rereading replaces what it shows, never
            // the component drawing it. Only a first read (or one after an empty, refused or failed answer) shows loading.
            if (state.value.status !== "ready") state.value = { status: "loading" };
            // An answer for an earlier read (an earlier selection) is dropped once a later read was asked for.
            void answer(name, inputs()).then((result) => {
              if (reading !== sequence) return;
              // A failure is read again on request, as a refresh reads it.
              state.value = result.status === "error" ? { ...result, retry: () => { state.value = { status: "loading" }; reread(); } } : result;
            });
          };
          const entry = { data: projection.data[name]!, inputs, reread };
          shown.add(entry);
          watch(() => memberReadKey(projection, entry.data, placement, inputs(), own()), reread, { immediate: true });
          onScopeDispose(() => shown.delete(entry));
          return computed(() => state.value);
        },
        read: (name, params, overrides = {}) => {
          const { inputs: run, own: ownRun } = runValues(projection, name, params);
          return answer(name, { ...inputs(), ...overrides, ...run }, { ...own(), ...ownRun });
        },
      };
    },
    memberOperations(member: string, projection: DirectProjection, inputs: () => MemberInputs) {
      const { state, reread } = watchMemberOperations(options.read, projection, () => instance.memberPathOf(member), inputs, () => active);
      operationReads.add(reread);
      onScopeDispose(() => operationReads.delete(reread));
      return state;
    },
    refresh(affected: PanelOperationAffected) {
      // What the write removed is let go of first, so nothing below reads it again.
      if (affected.removed) instance.letGo(affected.removed);
      for (const { data, inputs, reread } of shown) {
        const object = stateObject(sourceObject(data, inputs()));
        if (object && affected.objects.some((changed) => changed.objectType === object.className && changed.primaryKey === object.primaryKey))
          reread();
        else if ("type" in data.source && affected.objectTypes.includes(data.source.type.id)) reread();
      }
      for (const object of affected.objects) instance.objectChanged(object);
      // What changed may be shown by a panel placed here, too.
      for (const mount of nestedMounts) mount.refresh(null, affected);
    },
    refreshAll() {
      for (const { reread } of shown) reread();
      for (const reread of operationReads) reread();
      instance.refreshObjects();
      for (const mount of nestedMounts) mount.refresh(null);
    },
    setActive(next: boolean) {
      active = next;
      for (const mount of nestedMounts) mount.activate(next);
    },
    projectionChanged(id: string, revision?: number) {
      for (const member of Object.keys(direct.members)) {
        if (placedProjectionId(member) !== id) continue;
        if (revision !== undefined && revision <= (readRevisions.get(member) ?? 0)) continue;
        // A member the instance held is held anew from the newer definition, drawn or not.
        const held = members.has(member);
        release(member);
        if (held) void directInstance.placing(member).catch(() => undefined);
      }
      if (revision !== undefined) for (const mount of nestedMounts) mount.projectionsChanged([{ id, revision }]);
    },
    projectionVersion: (member: string) => versions.get(member) ?? 0,
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
    get panel(): never { return frameOnly("The handed-over definition")(); },
    manifest: instance.manifest,
    instance,
    currentEntry: instance.currentEntry,
    entryMenu: instance.entryMenu,
    projection: frameOnly("Reading a projection record"),
    invoke: frameOnly("Running a frame operation"),
    projectionsChanged: () => () => {},
    draft: instance.draft,
    holdUnsaved: () => () => {},
    t: instance.text,
    resources: () => Promise.resolve(),
    // The member's projection is the platform's own record here: its declared entry goes to the page's composer as it is.
    expandPageComposer: async ({ slot: _member, ...entry }) => instance.expandPageComposer(entry),
    navigate: (address) => instance.navigate(address),
    notify: ({ kind, text }) => { ElMessage({ type: kind, message: text, grouping: true }); },
    // A member here reads through the instance's own port; nothing asks the context for it.
    readPanelData: frameOnly("Reading a member's data over the frame's request path"),
  };
}
