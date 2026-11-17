import { createApp, h, provide, ref, watch, type Component, type Ref } from "vue";
import { createAppContext, type AppContext } from "../context";
import { createAssistantClient } from "../chat";
import {
  PANEL_HOST_CHANNEL,
  panelHostFrameMessageSchema,
  panelHostMessageSchema,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel } from "@ontomato/contracts/product-panels";
import { panelContextKey, type PanelContext } from "./context";
import { applyPanelRequest, createPanelInstance, type PanelInstance } from "./instance";
import { PanelFormAdapters, receivePanelDraft, type PageDraftLink, type ReceivedPanelDraft } from "./draft";
import type { PanelFormAdapter } from "./draft";
import type { PanelProjectionRegistration, ProjectionPorts } from "./projection";

/*
 * How a panel's module runs (overall design 3.3, 3.4): the platform's panel host opens a frame for one instance and
 * writes that run's facts into its document (the channel and the record are the contracts' `panel-host`). This module
 * mounts the panel's component with everything the SDK does for it already done — the platform context connected, the
 * state created and restored from the address, the projection slots registered, the draft dispatched, and what the
 * reader looks at reported. A panel author exports a declaration and a component; none of this is written per panel.
 */

/** A panel module's default export: the component drawn inside the panel's HTML. */
export type PanelComponent = Component;

/** What a panel module's `mount` receives. */
export interface PanelMount {
  /** The panel's own context: its record, declaration, instance, slots and drafts. */
  context: PanelContext;
  /** The platform context, for a panel that reads MetricViews or Actions itself. */
  appContext: AppContext;
}

/**
 * Mounts the panel into `element`, which the panel's HTML designates. The instance's state, the page context and
 * whether it holds unsaved changes reach the host as they change: the host keeps the address, and asks before it
 * replaces a definition.
 */
export async function mountPanel(component: PanelComponent, element: Element): Promise<PanelMount> {
  const message = hostMessage();
  const appContext = createAppContext();
  const instance = createPanelInstance(message.panel.manifest, {
    pageKey: message.pageKey,
    url: () => message.url,
    label: () => message.label,
    initial: message.state,
  });
  const adapters = new PanelFormAdapters();
  const draft = ref<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const unsaved = new Set<Ref<boolean>>();
  const context: PanelContext = {
    panel: message.panel,
    manifest: message.panel.manifest,
    instance,
    slot(slot: string, ports: ProjectionPorts, invoke: PanelProjectionRegistration["invoke"]) {
      const declaration = message.panel.manifest.slots[slot];
      if (!declaration) throw new Error(`The panel declares no slot '${slot}'`);
      return instance.register({ slot, projectionId: declaration.projectionId, ports, invoke });
    },
    form(slot: string, adapter: PanelFormAdapter<Record<string, unknown>, { id?: string }>) {
      adapters.register(slot, adapter);
    },
    draft,
    async receiveDraft(link: PageDraftLink, confirm: () => Promise<boolean>) {
      const received = await receivePanelDraft<Record<string, unknown>>(message.pageKey, adapters, createAssistantClient(appContext), link, confirm);
      if (received) draft.value = received;
      return received;
    },
    holdUnsaved(flag: Ref<boolean>) {
      unsaved.add(flag);
      return () => unsaved.delete(flag);
    },
  };
  const app = createApp({ setup: () => (provide(panelContextKey, context), () => h(component)) });
  app.use(appContext);
  app.mount(element);
  report({ instance, draft, unsaved });
  return { context, appContext };
}

/** The run's facts as the host wrote them into this document, before the module ran. */
function hostMessage(): PanelHostMessage {
  const element = document.querySelector("script[data-panel-host-message]");
  if (!element) throw new Error("This document is not a panel run: it carries no host message");
  return panelHostMessageSchema.parse(JSON.parse(element.textContent ?? ""));
}

interface ReportOptions {
  instance: PanelInstance;
  draft: Ref<ReceivedPanelDraft<Record<string, unknown>> | null>;
  unsaved: ReadonlySet<Ref<boolean>>;
}

/**
 * What one instance tells its host, and what it takes back. The host owns the address and the record; a changed
 * definition is read by its ID there and offered here, and an unsaved form is never replaced by it.
 */
function report({ instance, draft, unsaved }: ReportOptions) {
  const send = (value: unknown) => window.parent.postMessage({ channel: PANEL_HOST_CHANNEL, ...(value as object) }, "*");
  const context = (): PageContext => instance.pageContext.value;
  const state = (): Record<string, PanelStateValue> => instance.deepLink();
  const isDirty = () => draft.value !== null || [...unsaved].some((flag) => flag.value);

  send({ kind: "context", context: context() });
  send({ kind: "state", state: state() });
  watch(
    () => [instance.state.values.value, context().url],
    () => {
      send({ kind: "context", context: context() });
      send({ kind: "state", state: state() });
    },
    { deep: true },
  );
  watch([...unsaved], () => send({ kind: "dirty", dirty: isDirty() }), { immediate: true });

  window.addEventListener("message", (event) => {
    if (event.data?.channel !== PANEL_HOST_CHANNEL) return;
    if (!panelHostFrameMessageSchema.safeParse(event.data).success) return;
    // An unsaved form is the reader's: the host keeps the old definition until they save or drop it.
    send({ kind: "reloaded", reloaded: !isDirty() });
  });
}

export { applyPanelRequest };
export type { PageContext, PanelStateValue, ProductPanel, ReceivedPanelDraft };
