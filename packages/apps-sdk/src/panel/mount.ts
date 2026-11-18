import { createApp, h, provide, ref, watch, type Component, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import { connectAppContext, contextTransport, type AppContext } from "../context";
import {
  PANEL_HOST_CHANNEL,
  panelHostFrameMessageSchema,
  panelHostMessageSchema,
  panelMessageOf,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import { pageDraftSchema, type PageDraft } from "@ontomato/contracts/page-draft";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { panelContextKey, type PanelContext, type ProjectionSlot } from "./context";
import { applyPanelRequest, createPanelInstance, pageDraftLinkOf, type PanelInstance } from "./instance";
import { receivePanelDraft, type ReceivedPanelDraft } from "./draft";
import PanelProjection from "./Projection.vue";
import ObjectList from "../base/ObjectList.vue";
import ObjectSummary from "../base/ObjectSummary.vue";
import ObjectForm from "../base/ObjectForm.vue";
import OperationButton from "../base/OperationButton.vue";
import { registerSchedulesPlatformObject } from "./schedules";

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
 * Mounts the panel's component into the element its HTML designates (`#app`). The state, the page context and whether the
 * instance holds unsaved changes reach the host as they change; the host keeps the address and asks before it replaces a
 * definition.
 */
export async function mountPanel(component: PanelComponent): Promise<PanelMount> {
  const element = document.getElementById("app");
  if (!element) throw new Error("A panel's HTML designates the element its component mounts into as #app");
  const message = hostMessage();
  // A panel runs in a sandboxed frame of its own, which cannot read the platform's window: it connects the way a hosted
  // application does, over the message bridge. The platform sends each request with the reader's own credential and
  // decides which requests a frame may make.
  const appContext = await connectAppContext();
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
    invoke: (handlerRef, call) => instance.runHandler(handlerRef, call),
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
    setup: () => {
      provide(panelContextKey, context);
      // A draft that none of this panel's forms performs is not this panel's: once every slot has registered and none
      // takes it, the frame fails with that, where the panel would have been, rather than waiting for a form that will
      // never come.
      const { t } = useI18n();
      watch(instance.unclaimedDraft, (unclaimed) => {
        if (unclaimed) failed(t("platform.panelDraftUnclaimed"));
      });
      return () => h(component);
    },
  });
  // The one global a panel's HTML and module need: `<Projection slot="…"/>`. Its name is the SDK's public API, so it is
  // a single word on purpose.
  // eslint-disable-next-line vue/multi-word-component-names
  app.component("Projection", PanelProjection);
  // The base components a panel's HTML composes. Each carries no business; what a projection's binding names decides it.
  app.component("ObjectList", ObjectList);
  app.component("ObjectSummary", ObjectSummary);
  app.component("ObjectForm", ObjectForm);
  app.component("OperationButton", OperationButton);
  // The platform objects this version's panels read, and the operations they run.
  registerSchedulesPlatformObject(appContext);
  app.use(ElementPlus).use(appContext);
  app.mount(element);

  // The draft the address names belongs to this panel, so the SDK reads it and holds it for the form projection that
  // performs its operation, which takes it once it has read its record and registered. That component puts its values
  // in the form and marks what it changed; nothing is written until the reader saves.
  const link = pageDraftLinkOf(message.url);
  if (link)
    await receivePanelDraft(
      message.pageKey,
      instance.forms,
      // The draft is read over this frame's own transport, at the agent host's route: the panel needs one read, not the
      // conversation client, whose module pulls the whole shell in and would defer the panel's first draw by seconds.
      { readPageDraft: (sessionId, runId, path) => readDraft(transport, sessionId, runId, path) },
      link,
      (taken) => (draft.value = taken),
    );

  report({ instance, draft, unsaved, changed: (id) => projectionListeners.forEach((listener) => listener(id)) });
  return { context, appContext };
}

/** Tells the host this panel cannot run, and why; the host shows it where the panel would have been. */
function failed(message: string) {
  window.parent.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "failed", message }, "*");
}

/** Reads the draft one run wrote, as the reader, through the frame's own request layer. */
async function readDraft(transport: ReturnType<typeof contextTransport>, sessionId: string, runId: string, path: string) {
  const query = new URLSearchParams({ path }).toString();
  const response = await transport.request(
    `/assistant/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/page-draft?${query}`,
    {},
    "",
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `The draft at ${path} could not be read`);
  return pageDraftSchema.parse(body);
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
