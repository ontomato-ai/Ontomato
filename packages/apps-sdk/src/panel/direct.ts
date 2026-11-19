import { computed, onScopeDispose, shallowReactive, shallowRef, watch, type ComputedRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectPanelManifest, PanelManifest, PanelStateField } from "@ontomato/contracts/panel-manifest";
import { panelOperationAffectedSchema, panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
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
 * The declaration's members are the old declaration's slots for the machinery both kinds of panel share (state, forms,
 * drafts, page context, operations), so a member key is a slot name everywhere in the SDK.
 */

/** The objects and types an operation reports it changed. */
export type PanelOperationAffected = ReturnType<typeof panelOperationAffectedSchema.parse>;

/** One named datum of a member as a component shows it: the host's answer, still loading, or awaiting a selection. */
export type MemberDataState = PanelDataState | { status: "awaiting" };

/** A projection input's value: a JSON value as the member and the run supply it; absent while nothing is supplied. */
export type MemberInputs = Readonly<Record<string, RuntimeJsonValue>>;

export interface DirectPanelInstanceOptions extends Omit<PanelInstanceOptions, "readProjection"> {
  /** Reads one named datum of one member, as the platform's read entry answers it for this panel's source. */
  read(request: Omit<ProductPanelReadRequest, "source">): Promise<ProductPanelReadResponse>;
  /** Reads a member's current projection by ID, as the reader. */
  readProjection(id: string): Promise<DirectProjection>;
}

/** One member's data: the shown data by name, and a read the component asks for with run inputs of its own. */
export interface MemberData {
  /**
   * The datum a component shows, kept current while the component is mounted: called in its setup, it is what makes
   * the instance read the datum at all.
   */
  use(name: string): ComputedRef<MemberDataState>;
  /** One more read of a datum with run inputs (a form's values and changed field); it does not replace the shown one. */
  read(name: string, run: MemberInputs): Promise<MemberDataState>;
}

export interface DirectPanelInstance extends PanelInstance {
  readonly direct: DirectPanelManifest;
  /** The panel's own words, in the current language. */
  readonly text: PanelText;
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
  /** A projection's definition changed: its members read it again and draw it anew. */
  projectionChanged(id: string): void;
  /** How many times a member's projection was read anew, which its drawing is keyed by. */
  projectionVersion(member: string): number;
}

/** The old declaration the shared machinery reads: members as slots, typed state fields as kinds, no state operations. */
function sharedManifest(direct: DirectPanelManifest): PanelManifest {
  return {
    state: Object.fromEntries(Object.entries(direct.state).map(([name, field]) =>
      [name, { ...field.type, deepLink: field.deepLink } as PanelStateField])),
    slots: Object.fromEntries(Object.entries(direct.members).map(([member, declaration]) => [member, {
      projectionId: declaration.target.projectionId,
      inputs: Object.fromEntries(Object.entries(declaration.inputs ?? {}).flatMap(([input, source]) =>
        "state" in source ? [[input, source]] : [])),
      ...(declaration.outputs ? { outputs: declaration.outputs } : {}),
    }])),
    operations: [],
  };
}

/** The object a datum is read from now, when its source is one: the literal, or the input that holds it. */
function sourceObject(data: DirectProjectionData, inputs: MemberInputs): PanelFieldValue | undefined {
  if (!("object" in data.source)) return undefined;
  const object = data.source.object;
  return "literal" in object ? object.literal : (inputs[object.input] as PanelFieldValue | undefined);
}

export function createDirectPanelInstance(direct: DirectPanelManifest, options: DirectPanelInstanceOptions): DirectPanelInstance {
  const defaults = Object.fromEntries(Object.entries(direct.state).flatMap(([name, field]) =>
    field.default === undefined ? [] : [[name, field.default]]));
  const projections = new Map<string, Promise<DirectProjection>>();
  const versions = shallowReactive(new Map<string, number>());
  let active = true;
  const instance = createPanelInstance(sharedManifest(direct), {
    ...options,
    affected: (affected) => directInstance.refresh(affected),
    initial: { ...defaults, ...options.initial },
    // The shared machinery reads no projection of a direct panel; its members are read here.
    readProjection: () => Promise.reject(new Error("A direct panel's members read their projections through the instance")),
  });
  /** Every datum shown now, with how to read it again when an operation reports its source changed. */
  const shown = new Set<{ data: DirectProjectionData; inputs: () => MemberInputs; reread(): void }>();

  const directInstance: DirectPanelInstance = Object.assign(instance, {
    direct,
    text: options.text,
    projectionOf(member: string) {
      const declaration = direct.members[member];
      if (!declaration) throw new Error(`The panel declares no member '${member}'`);
      let found = projections.get(member);
      if (!found) projections.set(member, (found = options.readProjection(declaration.target.projectionId)));
      return found;
    },
    memberData(member: string, projection: DirectProjection, inputs: () => MemberInputs): MemberData {
      async function answer(name: string, values: MemberInputs): Promise<MemberDataState> {
        const data = projection.data[name];
        if (!data) throw new Error(`Member '${member}' declares no datum '${name}'`);
        // A datum read from an object waits for that object; no read is made for nothing.
        if ("object" in data.source && stateObject(sourceObject(data, values)) === null) return { status: "awaiting" };
        const result = await options.read({ memberPath: [{ member }], dataName: name, inputs: values });
        if (result.status !== "ready") return result;
        // The host's answer is checked against the result the owner registered for this read.
        const declaration = directReadDeclaration(projection, data);
        if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
        return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result.value) };
      }

      return {
        use(name) {
          const state = shallowRef<MemberDataState>({ status: "loading" });
          let sequence = 0;
          const reread = () => {
            // Unseen, the instance reads nothing; the refresh when it is seen again reads every shown datum.
            if (!active) return;
            const reading = ++sequence;
            state.value = { status: "loading" };
            // An answer for an earlier read (an earlier selection) is dropped once a later read was asked for.
            void answer(name, inputs()).then((result) => { if (reading === sequence) state.value = result; });
          };
          const entry = { data: projection.data[name]!, inputs, reread };
          shown.add(entry);
          watch(() => JSON.stringify(inputs()), reread, { immediate: true });
          onScopeDispose(() => shown.delete(entry));
          return computed(() => state.value);
        },
        read: (name, run) => answer(name, { ...inputs(), ...run }),
      };
    },
    refresh(affected: PanelOperationAffected) {
      for (const { data, inputs, reread } of shown) {
        const object = stateObject(sourceObject(data, inputs()));
        if (object && affected.objects.some((changed) => changed.objectType === object.className && changed.primaryKey === object.primaryKey))
          reread();
        else if ("type" in data.source && affected.objectTypes.includes(data.source.type)) reread();
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
    projectionChanged(id: string) {
      for (const [member, declaration] of Object.entries(direct.members)) {
        if (declaration.target.projectionId !== id) continue;
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
  };
}
