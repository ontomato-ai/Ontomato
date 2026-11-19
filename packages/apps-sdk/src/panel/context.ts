import { computed, inject, onBeforeUnmount, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { PanelManifest, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelDefinitionContent, ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelInstance } from "./instance";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import type { PanelFormAdapter, PanelFormHandle, ReceivedPanelDraft } from "./draft";
import { adapterPart, type PlatformObjectAdapter } from "./platform-objects";
import { valueAt } from "./form-values";
import type { PanelText } from "./text";

/*
 * The panel context the SDK provides to a panel's own module (overall design 3.3, 3.4): the panel's declaration, the
 * instance it is being shown as, and the platform ports the SDK itself uses. A panel author writes the declaration and
 * places its projections; none of what happens here is written per panel — the SDK reads a projection, draws it,
 * registers its ports, dispatches the draft the address names, reports the page context and runs the operations.
 */

/** The panel context, provided by the host that mounted the panel. */
export const panelContextKey: InjectionKey<PanelContext> = Symbol("panel-context");

/** The projection one component is drawn as: its record and the values its slot passes it. */
export const projectionKey: InjectionKey<ProjectionSlot> = Symbol("panel-projection");

export interface ProjectionSlot {
  /** The slot of the panel's declaration this projection fills. */
  slot: string;
  projection: ProductProjection;
  inputs: Readonly<Record<string, unknown>>;
}

/**
 * What a panel's module gets while it is mounted. Everything here is one instance: the same panel open twice keeps two
 * states, two draft slots and two sets of registered projections.
 */
export interface PanelContext {
  /**
   * What the panel is made of — its content, declaration and SDK version — as the host handed it over. The record's
   * identity and revision stay with the trusted host, which also runs a candidate preview this way.
   */
  readonly panel: PanelDefinitionContent;
  readonly manifest: PanelManifest;
  /** This instance: its state, page context, projections and operations. */
  readonly instance: PanelInstance;
  /** The projection record a slot's declaration names, read now from its owner. */
  projection(id: string): Promise<ProductProjection>;
  /** Runs one operation of this instance here, with the reader's own credential and the call it is given. */
  invoke(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** Hears that a projection's definition changed, by ID; the returned function stops it. */
  projectionsChanged(listener: (projectionId: string, revision?: number) => void): () => void;
  /** The draft this instance received from its address, once it arrived. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  /**
   * Tells the host whether this instance holds unsaved changes, so a changed definition never replaces the reader's
   * form. The SDK calls it for a received draft; a form component calls it for its own edits.
   */
  holdUnsaved(flag: Ref<boolean>): () => void;
  /**
   * The panel's own words (its content's `messages`) in the platform's current language: the current language, else
   * the deployment's default, else the key. The panel's HTML reads the same function as `t(key, params)`.
   */
  readonly t: PanelText;
  /**
   * Fetches and registers the resource clients a projection record binds — its type or operation, and a graph's edge
   * type — before the projection registers its ports, so a panel downloads only the clients of what it shows.
   */
  resources(projection: Pick<ProductProjection, "binding" | "graph">): Promise<void>;
}

/**
 * The panel state one slot's input is filled from: the input a component names, or the slot's first. A component that
 * writes or reads "the object this slot is about" asks this, so it never guesses a state field name.
 */
export function slotState(manifest: PanelManifest, slot: string, input?: string): string {
  const declaration = manifest.slots[slot];
  if (!declaration) throw new Error(`The panel declares no slot '${slot}'`);
  const [name] = input ? [input] : Object.keys(declaration.inputs);
  const ref = name ? declaration.inputs[name] : undefined;
  if (!ref) throw new Error(`Slot '${slot}' fills no input, so it names no panel state`);
  return ref.state;
}

/** The panel context a panel module runs under. */
export function usePanelContext(): PanelContext {
  const context = inject(panelContextKey, null);
  if (!context) throw new Error("A panel's module runs under the SDK's panel host, which provides its context");
  return context;
}

/**
 * What a component drawn as a projection reads: the record it is and the values its slot passed. A form component also
 * registers the adapter that holds its draft, so a draft of this projection reaches the component itself.
 */
export function useProjectionSlot(): ProjectionSlot {
  const slot = inject(projectionKey, null);
  if (!slot) throw new Error("A projection-aware component is drawn by <Projection>, which provides its slot");
  return slot;
}

/**
 * Registers a form component with the instance under its slot: the form other slots' field ports edit, the draft the
 * address names, the header's save and discard and the unsaved state the host is told.
 */
export function useProjectionForm(adapter: PanelFormAdapter): void {
  const context = usePanelContext();
  const drawn = useProjectionSlot();
  const saves = context.instance.projections.value
    .find((registration) => registration.slot === drawn.slot)?.ports.operations.some((item) => item.kind === "form.save");
  if (!saves) throw new Error(`The projection in slot '${drawn.slot}' publishes no form save`);
  onBeforeUnmount(context.instance.forms.register(drawn.slot, adapter));
}

/** One field of a form in this panel instance, as a field projection reads and edits it. */
export interface ProjectionFormField {
  /** The owner's description of the field; undefined until the form has read it. */
  readonly field: ComputedRef<PanelFormField | undefined>;
  readonly value: ComputedRef<RuntimeJsonValue | undefined>;
  readonly error: ComputedRef<string | undefined>;
  readonly changed: ComputedRef<boolean>;
  /** Whether the reader may change it now: the owner's read-only rule and the form's own busy state. */
  readonly disabled: ComputedRef<boolean>;
  set(value: RuntimeJsonValue): void;
}

/**
 * The form field this projection's slot edits (`formField: {slot, path}`): the value and the dirty state are the form's
 * in the named slot, so a choice made here is the form's own edit, saved, discarded and drafted with it. A path the
 * owner's current form does not describe fails visibly once that form has read its fields.
 */
export function useFormField(): ProjectionFormField {
  const { instance, manifest } = usePanelContext();
  const drawn = useProjectionSlot();
  const port = manifest.slots[drawn.slot]?.formField;
  if (!port) throw new Error(`Slot '${drawn.slot}' edits no form field: its declaration names no formField`);
  const handle = computed<PanelFormHandle | undefined>(() => instance.forms.handle(port.slot));
  const field = computed(() => {
    const form = handle.value;
    if (!form || !form.fields.value.length) return undefined;
    const found = form.fields.value.find((item) => item.path === port.path);
    if (!found) throw new Error(`The form in slot '${port.slot}' has no field ${port.path}`);
    return found;
  });
  return {
    field,
    value: computed(() => (handle.value ? valueAt(handle.value.values.value, port.path) : undefined)),
    error: computed(() => handle.value?.errors.value[port.path]),
    changed: computed(() => handle.value?.changed.value.has(port.path) === true),
    disabled: computed(() => !field.value || field.value.readOnly || handle.value!.busy.value),
    set(value) {
      if (!handle.value) throw new Error(`Slot '${port.slot}' holds no form yet`);
      handle.value.set(port.path, value);
    },
  };
}

/** Refresh this projection when a local or server operation changed an object it shows. */
export function useProjectionObjectRefresh(shows: (id: string) => boolean, refresh: () => void): void {
  const { instance } = usePanelContext();
  const slot = useProjectionSlot();
  onBeforeUnmount(instance.onObjectChanged(object => {
    if (!object || (slot.projection.binding.id === object.objectType && shows(object.primaryKey))) refresh();
  }));
}

/**
 * The objects of a type as its owner lists and reads them — the type this projection binds, unless another is named (a
 * graph's edges). Every object read through it names itself to the instance, so the page context names the selected
 * object by its owner's label without any component doing so on its own.
 */
export function useProjectionObjects(objectType?: string): Required<Pick<PlatformObjectAdapter, "list" | "read">> {
  const { instance } = usePanelContext();
  const type = objectType ?? useProjectionSlot().projection.binding.id;
  return {
    async list() {
      const listed = await adapterPart(type, "list")();
      instance.nameObjects(type, listed);
      return listed;
    },
    async read(primaryKey) {
      const found = await adapterPart(type, "read")(primaryKey);
      instance.nameObjects(type, [found]);
      return found;
    },
  };
}
