import { inject, onBeforeUnmount, type InjectionKey, type Ref } from "vue";
import type { PanelManifest, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelInstance } from "./instance";
import type { PanelFormAdapter, ReceivedPanelDraft } from "./draft";

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
  /** The panel's current definition, as registered. */
  readonly panel: ProductPanel;
  readonly manifest: PanelManifest;
  /** This instance: its state, page context, projections and operations. */
  readonly instance: PanelInstance;
  /** The projection record a slot's declaration names, read now from its owner. */
  projection(id: string): Promise<ProductProjection>;
  /** Runs one operation of this instance here, with the reader's own credential and the call it is given. */
  invoke(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** Hears that a projection's definition changed, by ID; the returned function stops it. */
  projectionsChanged(listener: (projectionId: string) => void): () => void;
  /** The draft this instance received from its address, once it arrived. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  /**
   * Tells the host whether this instance holds unsaved changes, so a changed definition never replaces the reader's
   * form. The SDK calls it for a received draft; a form component calls it for its own edits.
   */
  holdUnsaved(flag: Ref<boolean>): () => void;
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
 * Registers a form component's draft handling for the projection it is drawn as. The component supplies its owner's own
 * read and save; the SDK compares what the draft says with what it read and reports the unsaved state to the host, so
 * neither a draft nor a definition change replaces the reader's work unasked.
 */
export function useProjectionForm<Form extends object>(adapter: Omit<PanelFormAdapter<Form, { id?: string }>, "operation">): void {
  const context = usePanelContext();
  const drawn = useProjectionSlot();
  const operation = context.instance.projections.value
    .find((registration) => registration.slot === drawn.slot)?.ports.operations.find((item) => item.kind === "form.save");
  if (!operation) throw new Error(`The projection in slot '${drawn.slot}' publishes no form save`);
  const stop = context.instance.forms.register(drawn.slot, { ...adapter, operation: operation.handlerRef });
  onBeforeUnmount(stop);
}

/** Refresh this projection when a local or server operation changed an object it shows. */
export function useProjectionObjectRefresh(shows: (id: string) => boolean, refresh: (id: string) => void): void {
  const { instance } = usePanelContext();
  const slot = useProjectionSlot();
  onBeforeUnmount(instance.onObjectChanged(({ objectType, primaryKey }) => {
    if (slot.projection.binding.id === objectType && shows(primaryKey)) refresh(primaryKey);
  }));
}
