import { computed, onScopeDispose, shallowReactive, shallowRef, watch, type ComputedRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { panelOperationAffectedSchema, panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import { memberProjectionId } from "./projection-element";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { PanelDataState, ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { createPanelInstance, type PanelInstance, type PanelInstanceOptions } from "./instance";
import { stateObject, type PanelFieldValue } from "./state";
import type { PanelText } from "./text";
import type { PanelContext } from "./context";

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

/** One named datum of a member as a component shows it: the host's answer, still loading, or awaiting a selection. */
export type MemberDataState = PanelDataState | { status: "awaiting" };

/** A projection input's value: a JSON value as the member and the run supply it; absent while nothing is supplied. */
export type MemberInputs = Readonly<Record<string, RuntimeJsonValue>>;

/** A member's placement as a read's parameters see it: the panel state its inputs and outputs bind. */
export type MemberPlacement = Pick<PanelManifest["members"][string], "inputs" | "outputs">;

export interface DirectPanelInstanceOptions extends Omit<PanelInstanceOptions, "readProjection"> {
  /** Reads one named datum of one member, as the platform's read entry answers it for this panel's source. */
  read(request: Omit<ProductPanelReadRequest, "source">): Promise<ProductPanelReadResponse>;
  /** Reads a member's current projection by ID, as the reader. */
  readProjection(id: string): Promise<DirectProjection>;
  /**
   * Expands the page's composer with a conversation entry a member's projection declares: its agent and its opening
   * sentence. The record is the platform's own read, so the entry needs no check against it; nothing is sent.
   */
  expandPageComposer(entry: PanelConversationEntry): void;
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
  /** The panel's own words, in the current language. */
  readonly text: PanelText;
  /** The page's composer, expanded with a member's declared conversation entry. */
  expandPageComposer(entry: PanelConversationEntry): void;
  /** The member's projection, read once for this instance. */
  projectionOf(member: string): Promise<DirectProjection>;
  /** The data of one member, whose inputs are `inputs` as the member's placement fills them now. */
  memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs): MemberData;
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
  const instance = createPanelInstance(direct, {
    ...options,
    // The shared machinery reads no projection of a direct panel; its members are read here.
    readProjection: () => Promise.reject(new Error("A direct panel's members read their projections through the instance")),
  });
  /** Every datum shown now, with how to read it again when an operation reports its source changed. */
  const shown = new Set<{ data: DirectProjectionData; inputs: () => MemberInputs; reread(): void }>();

  const directInstance: DirectPanelInstance = Object.assign(instance, {
    direct,
    text: options.text,
    expandPageComposer: options.expandPageComposer,
    projectionOf(member: string) {
      let found = projections.get(member);
      if (!found) {
        found = options.readProjection(memberProjectionId(direct, member)).then((projection) => {
          readRevisions.set(member, projection.revision);
          return projection;
        });
        projections.set(member, found);
      }
      return found;
    },
    memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs): MemberData {
      const own = () => instance.ownParams(member);
      const placement = direct.members[member]!;
      async function answer(name: string, values: MemberInputs, ownRun: MemberInputs = own()): Promise<MemberDataState> {
        const data = projection.data[name];
        if (!data) throw new Error(`Member '${member}' declares no datum '${name}'`);
        // A datum waits for its object or a required parameter; no read is made for nothing.
        if (awaitsInputs(projection, data, placement, values, ownRun)) return { status: "awaiting" };
        // What the member's component set itself goes apart from the author's inputs, and is checked as such.
        const { runtime, authored } = readParams(projection, data, placement, values, ownRun);
        const result = await options.read({
          memberPath: [{ member }], dataName: name, inputs: authored,
          ...(Object.keys(runtime).length ? { runtimeParams: runtime } : {}),
        });
        if (result.status !== "ready") return result;
        // The host's answer is checked against the result the owner registered for this read.
        const declaration = directReadDeclaration(projection, data);
        if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
        return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result.value) as RuntimeJsonValue };
      }

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
            void answer(name, inputs()).then((result) => { if (reading === sequence) state.value = result; });
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
    refresh(affected: PanelOperationAffected) {
      for (const { data, inputs, reread } of shown) {
        const object = stateObject(sourceObject(data, inputs()));
        if (object && affected.objects.some((changed) => changed.objectType === object.className && changed.primaryKey === object.primaryKey))
          reread();
        else if ("type" in data.source && affected.objectTypes.includes(data.source.type.id)) reread();
      }
      for (const object of affected.objects) instance.objectChanged(object);
    },
    refreshAll() {
      for (const { reread } of shown) reread();
      instance.refreshObjects();
    },
    setActive(next: boolean) {
      active = next;
    },
    projectionChanged(id: string, revision?: number) {
      for (const member of Object.keys(direct.members)) {
        if (memberProjectionId(direct, member) !== id) continue;
        if (revision !== undefined && revision <= (readRevisions.get(member) ?? 0)) continue;
        projections.delete(member);
        versions.set(member, (versions.get(member) ?? 0) + 1);
      }
    },
    projectionVersion: (member: string) => versions.get(member) ?? 0,
  });
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
    projection: frameOnly("Reading a projection record"),
    invoke: frameOnly("Running a frame operation"),
    projectionsChanged: () => () => {},
    draft: instance.draft,
    holdUnsaved: () => () => {},
    t: instance.text,
    resources: () => Promise.resolve(),
    // The member's projection is the platform's own record here: its declared entry goes to the page's composer as it is.
    expandPageComposer: async ({ slot: _member, ...entry }) => instance.expandPageComposer(entry),
  };
}
