import { computed, readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelOpenRequestSchema, type PanelManifest, type PanelOperationCall, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createPanelState, panelSelection, type PanelInitialState, type PanelStateStore } from "./state";
import { panelOperations } from "./operations";
import type { PanelProjectionRegistration } from "./ports";
import { PanelFormAdapters, type PageDraftLink, type ReceivedPanelDraft } from "./draft";
import { handlerFor } from "./handlers";
import { pageDraftLink } from "@ontomato/agent-shell-ui";
import type { PanelOperationBinding } from "./types";

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
  /** The page's registration key: the application use's pageKey, which a draft names too. */
  pageKey: string;
  url: () => string;
  label: () => string;
  initial?: PanelInitialState;
  /** Reads a current projection by ID, as the reader. */
  readProjection: (id: string) => Promise<ProductProjection>;
}

export interface PanelInstance {
  readonly manifest: PanelManifest;
  readonly state: PanelStateStore;
  readonly pageContext: DeepReadonly<Ref<PageContext>>;
  readonly operations: DeepReadonly<Ref<readonly PanelOperationBinding[]>>;
  readonly projections: DeepReadonly<Ref<readonly PanelProjectionRegistration[]>>;
  /** The form adapters its projections registered, for the draft its address names. */
  readonly forms: PanelFormAdapters;
  /** The draft this instance received, once one arrived. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  register(registration: PanelProjectionRegistration): () => void;
  /** Runs one described operation here, with the reader's own credential. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Runs one operation a projection publishes, by its handler reference, with the call it is given. */
  runHandler(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** Reads a projection record by ID, as the reader. */
  projection(id: string): Promise<ProductProjection>;
  /** Whether this instance holds unsaved changes: a received draft, or a form the reader edited. */
  dirty(): boolean;
  /** The state an address or an open request may carry, for this instance. */
  deepLink(): Record<string, PanelStateValue>;
}

/**
 * One panel instance: everything belongs to it, so two instances of one panel share the declaration and its reads and
 * nothing else.
 */
export function createPanelInstance(manifest: PanelManifest, options: PanelInstanceOptions): PanelInstance {
  const state = createPanelState(manifest, options.initial);
  const registrations = shallowRef<readonly PanelProjectionRegistration[]>([]);
  const operations = computed(() => panelOperations(manifest, registrations.value, state, forms));
  const forms = new PanelFormAdapters();
  const draft = shallowRef<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const pageContext = computed<PageContext>(() => ({
    pageKey: options.pageKey,
    url: options.url(),
    label: options.label(),
    selection: panelSelection(manifest, state.values.value),
  }));
  return {
    manifest,
    state,
    pageContext,
    operations,
    forms,
    draft: readonly(draft) as Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>,
    projections: readonly(registrations),
    register(registration) {
      registrations.value = [...registrations.value, registration];
      return () => {
        registrations.value = registrations.value.filter((item) => item !== registration);
      };
    },
    invoke(id, input) {
      const found = operations.value.find((operation) => operation.id === id);
      if (!found) throw new Error(`The panel offers no operation '${id}'`);
      return found.invoke(input);
    },
    runHandler: (handlerRef, call) => handlerFor(handlerRef).invoke(call),
    projection: (id) => options.readProjection(id),
    dirty: () => draft.value !== null || forms.dirty(),
    deepLink: () => state.deepLinkable(),
  };
}

/**
 * Applies what an address or an open request carries, checked against the declaration: only the fields the panel offers
 * in an address are restorable, so a credential or a form value never arrives that way.
 */
export function applyPanelRequest(manifest: PanelManifest, state: PanelStateStore, request: unknown): void {
  const parsed = panelOpenRequestSchema.parse(request);
  for (const [name, value] of Object.entries(parsed.state)) {
    if (!manifest.state[name]?.deepLink) continue;
    state.set(name, value);
  }
}

/** The draft link an address carries, if it carries one. */
export function pageDraftLinkOf(address: string): PageDraftLink | null {
  return pageDraftLink(Object.fromEntries(new URL(address, "http://page.invalid").searchParams));
}
