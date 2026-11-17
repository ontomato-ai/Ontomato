import { computed, readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelOpenRequestSchema, type PanelManifest, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { createPanelState, panelSelection, type PanelInitialState, type PanelStateStore } from "./state";
import { panelOperations } from "./operations";
import type { PanelProjectionRegistration } from "./projection";
import type { PanelOperationBinding } from "./types";

/*
 * One panel instance's runtime (overall design 3.4): its state, the projections it registered, the operations it
 * offers, and the page context a message carries. A panel author declares state and composition in `definePanel` and
 * writes none of this: no hand-rolled context report, no deep-link parsing, no draft dispatch, no button adapter.
 *
 * The three things that make it one instance and not another:
 *
 * - its own state, so the same panel open twice keeps two selections apart;
 * - its own registered projections, so a slot's operations reach that instance's values;
 * - its own page context, projected from the state. Only the object-typed fields that hold a value become selections,
 *   in declaration order, and the entry address rides on the first message or when it changes (the one `PageContext`
 *   line the shell already writes).
 */

/** What a panel instance reports, its state, what it contains, and what it offers. */
export interface PanelInstance {
  readonly manifest: PanelManifest;
  readonly state: PanelStateStore;
  /** The page context a message from this instance carries now. */
  readonly pageContext: DeepReadonly<Ref<PageContext>>;
  /** The operations it offers: its projections' and its own state changes. */
  readonly operations: DeepReadonly<Ref<readonly PanelOperationBinding[]>>;
  /** Everything `<projection>` mounts for this instance, by slot. */
  readonly projections: DeepReadonly<Ref<readonly PanelProjectionRegistration[]>>;
  /** Registers one slot's projection; returns the call that unregisters it when the projection unmounts. */
  register(registration: PanelProjectionRegistration): () => void;
  /** Runs one described operation here, with the person's own credential. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** The state an address or an open request may carry, for this instance. */
  deepLink(): Record<string, PanelStateValue>;
}

export interface PanelInstanceOptions {
  /** The page's registration key: the application use's pageKey, which a draft names too. */
  pageKey: string;
  /** This instance's address, as the reader sees it (the panel use's path plus whatever it shows). */
  url: () => string;
  /** What the page is called in a message: the panel's own name, or its name and the object in view. */
  label: () => string;
  /** What the instance starts with, from an open request or a link. */
  initial?: PanelInitialState;
}

/**
 * Creates one panel instance from its declaration. Every mount creates its own: two instances of one panel share the
 * declaration and nothing else.
 */
export function createPanelInstance(manifest: PanelManifest, options: PanelInstanceOptions): PanelInstance {
  const state = createPanelState(manifest, options.initial);
  const registrations = shallowRef<readonly PanelProjectionRegistration[]>([]);
  const operations = computed(() => panelOperations(manifest, registrations.value, state));
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
    deepLink: () => state.deepLinkable(),
  };
}

/**
 * Applies what an address or an open request carries, checking it against the declaration: only the fields the panel
 * offers in an address are restorable, so a credential or a form value never arrives that way.
 */
export function applyPanelRequest(manifest: PanelManifest, state: PanelStateStore, request: unknown): void {
  const parsed = panelOpenRequestSchema.parse(request);
  for (const [name, value] of Object.entries(parsed.state)) {
    if (!manifest.state[name]?.deepLink) continue;
    state.set(name, value);
  }
}
