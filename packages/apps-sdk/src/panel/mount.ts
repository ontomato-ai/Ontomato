import { createApp, h, provide, ref, watch, type Component, type Ref } from "vue";
import { createAppContext, type AppContext } from "../context";
import { createAssistantClient } from "../chat";
import {
  PANEL_HOST_CHANNEL,
  panelHostFrameMessageSchema,
  panelHostMessageSchema,
  panelMessageOf,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { panelContextKey, type PanelContext, type ProjectionSlot } from "./context";
import { applyPanelRequest, createPanelInstance, pageDraftLinkOf, type PanelInstance } from "./instance";
import { receivePanelDraft, type ReceivedPanelDraft } from "./draft";
import PanelProjection from "./Projection.vue";
import { contextTransport } from "../context";

/*
 * How a panel's module runs (overall design 3.3, 3.4): the platform's panel host opens a frame for one instance and
 * writes that run's facts into its document (the channel and the record are the contracts' `panel-host`). This module
 * mounts the panel's component with everything the SDK does for it already done — the platform context connected, the
 * state restored from the address, the draft the address names read and dispatched, the projections registered as they
 * appear, and what the reader looks at reported. A panel author exports a declaration and a component that places
 * `<Projection slot="…"/>`; nothing about reads, drafts, links or buttons is written per panel.
 */

/** A panel module's default export: the component drawn inside the panel's HTML. */
export type PanelComponent = Component;

/** What a panel module's `mount` receives. */
export interface PanelMount {
  /** The panel's own context: its record, declaration, instance and draft. */
  context: PanelContext;
  /** The platform context, for a panel that reads MetricViews or Actions itself. */
  appContext: AppContext;
}

/**
 * Mounts the panel into `element`, which the panel's HTML designates. The state, the page context and whether the
 * instance holds unsaved changes reach the host as they change; the host keeps the address and asks before it replaces a
 * definition.
 */
export async function mountPanel(component: PanelComponent, element: Element): Promise<PanelMount> {
  const message = hostMessage();
  const appContext = createAppContext();
  const transport = contextTransport(appContext);
  const instance = createPanelInstance(message.panel.manifest, {
    pageKey: message.pageKey,
    url: () => message.url,
    label: () => message.label,
    initial: message.state,
    readProjection: async (id) => {
      const response = await transport.request(`/product-projections/${encodeURIComponent(id)}`, {}, "");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? `Projection ${id} is unavailable`);
      return body.projection as ProductProjection;
    },
  });
  const draft = ref<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const unsaved = new Set<Ref<boolean>>();
  const projectionListeners = new Set<(id: string) => void>();
  const context: PanelContext = {
    panel: message.panel,
    manifest: message.panel.manifest,
    instance,
    projection: (id) => instance.projection(id),
    invoke: (handlerRef, input) => instance.runHandler(handlerRef, input),
    projectionsChanged(listener) {
      projectionListeners.add(listener);
      return () => projectionListeners.delete(listener);
    },
    draft,
    holdUnsaved(flag) {
      unsaved.add(flag);
      return () => unsaved.delete(flag);
    },
  };
  const app = createApp({
    setup: () => (provide(panelContextKey, context), () => h(component)),
  });
  // The one global a panel's HTML and module need: `<Projection slot="…"/>`. Its name is the SDK's public API, so it is
  // a single word on purpose.
  // eslint-disable-next-line vue/multi-word-component-names
  app.component("Projection", PanelProjection);
  app.use(appContext);
  app.mount(element);

  // The draft the address names belongs to this panel, so the SDK reads it and hands it to the form projection that
  // performs its operation. An unsaved form is the reader's: a draft never replaces it unasked.
  const link = pageDraftLinkOf(message.url);
  if (link) {
    const received = await receivePanelDraft<Record<string, unknown>>(
      message.pageKey,
      instance.forms,
      createAssistantClient(appContext),
      link,
    );
    if (received) draft.value = received;
  }

  report({ instance, draft, unsaved, changed: (id) => projectionListeners.forEach((listener) => listener(id)) });
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
  changed: (projectionId: string) => void;
}

/**
 * What one instance tells its host, and what it takes back. The host owns the address and the record; a changed
 * definition is read again here by its ID — the panel's whole record, or one projection's — but never over an unsaved
 * form.
 */
function report({ instance, draft, unsaved, changed }: ReportOptions) {
  const send = (value: unknown) => window.parent.postMessage({ channel: PANEL_HOST_CHANNEL, ...(value as object) }, "*");
  const isDirty = () => draft.value !== null || instance.forms.dirty() || [...unsaved].some((flag) => flag.value);

  send({ kind: "context", context: instance.pageContext.value });
  send({ kind: "state", state: instance.deepLink() });
  watch(
    () => instance.state.values.value,
    () => {
      send({ kind: "context", context: instance.pageContext.value });
      send({ kind: "state", state: instance.deepLink() });
    },
    { deep: true },
  );
  watch([...unsaved], () => send({ kind: "dirty", dirty: isDirty() }), { immediate: true });
  watch(() => instance.dirty(), () => send({ kind: "dirty", dirty: isDirty() }));
  // The operations the header draws and an agent lists; they change as projections register and unregister.
  watch(() => instance.operations.value, () => send({ kind: "operations", operations: instance.operations.value }), {
    immediate: true,
  });

  window.addEventListener("message", (event) => {
    const parsed = panelMessageOf(panelHostFrameMessageSchema, event);
    if (!parsed) return;
    if (parsed.kind === "projection-changed") {
      changed(parsed.projectionId);
      return;
    }
    if (parsed.kind === "definition-changed") {
      // A changed panel is handed over only when nothing is unsaved; the host opens the frame again with it.
      send({ kind: "reloaded", reloaded: !isDirty() });
      return;
    }
    // A person's click in the platform's header: the same handler an agent's call reaches, run in this frame.
    const { requestId, id, input } = parsed;
    instance.invoke(id, input).then(
      (result) => send({ kind: "invoked", requestId, result }),
      (reason: unknown) =>
        send({ kind: "invoked", requestId, error: reason instanceof Error ? reason.message : String(reason) }),
    );
  });
}

export { applyPanelRequest, type PageDraft, type PanelStateValue, type ProductPanel, type ProjectionSlot };
