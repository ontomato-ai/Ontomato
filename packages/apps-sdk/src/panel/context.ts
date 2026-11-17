import { inject, type InjectionKey, type Ref } from "vue";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel } from "@ontomato/contracts/product-panels";
import type { PanelInstance } from "./instance";
import type { PanelFormAdapter, PageDraftLink, ReceivedPanelDraft } from "./draft";
import type { PanelProjectionRegistration, ProjectionPorts } from "./projection";

/*
 * The panel context the SDK provides to a panel's own module (overall design 3.3, 3.4): what the panel declares, the
 * instance it is being shown as, and the ports it hands the platform. A panel author writes the declaration and the
 * composition; the context reports what the reader looks at, dispatches drafts, lists the operations and runs them, so
 * none of that is written per panel.
 */

/** The one key a panel module injects: its own context. */
export const panelContextKey: InjectionKey<PanelContext> = Symbol("panel-context");

/**
 * What a panel's module gets when it is mounted. Everything here is one instance: the same panel open twice keeps two
 * states, two draft slots and two registered projections.
 */
export interface PanelContext {
  /** The panel's current definition, as registered: its identity, its text and its declaration. */
  readonly panel: ProductPanel;
  readonly manifest: PanelManifest;
  /** This instance: its state, page context, projections and operations. */
  readonly instance: PanelInstance;
  /** Registers a slot's projection: what it binds, what it takes and the operations it publishes. */
  slot(slot: string, ports: ProjectionPorts, invoke: PanelProjectionRegistration["invoke"]): () => void;
  /** Registers the form adapter of the slot whose projection saves an object; a draft of that operation reaches it. */
  form(slot: string, adapter: PanelFormAdapter<Record<string, unknown>, { id?: string }>): void;
  /** The draft this instance received, once one arrived: the slot that took it and the fields it changed. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  /**
   * Reads the draft a link names for this panel and dispatches it to its form slot. `confirm` is asked when the form
   * already has unsaved changes, and the draft is dropped when it answers no.
   */
  receiveDraft(link: PageDraftLink, confirm: () => Promise<boolean>): Promise<ReceivedPanelDraft<Record<string, unknown>> | null>;
  /**
   * Tells the host whether this instance holds unsaved changes, so a changed definition never replaces the reader's
   * form. A panel that keeps one form's draft state in a ref hands it over once and stops holding it on unmount.
   */
  holdUnsaved(flag: Ref<boolean>): () => void;
}

/** The panel context a panel module runs under, provided by the host that mounted it. */
export function usePanelContext(): PanelContext {
  const context = inject(panelContextKey, null);
  if (!context) throw new Error("A panel's module runs under the SDK's panel host, which provides its context");
  return context;
}
