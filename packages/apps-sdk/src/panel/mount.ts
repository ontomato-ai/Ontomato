import { createApp, h, nextTick, provide, ref, shallowReactive, watch, type Component, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { contextExpandPageComposer, contextTranslate, contextTransport, panelBridgeHost, type AppContext } from "../context";
import { connectPanelContext } from "./app-context";
import { defaultLocale } from "apps-sdk:panel-appearance";
import { createPanelText } from "./text";
import { panelHumanOperations } from "./human-operations";
import {
  PANEL_HOST_CHANNEL,
  panelFrameMessageSchema,
  panelHostFrameMessageSchema,
  panelHostMessageSchema,
  panelMessageOf,
  type PanelFrameMessage,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { PanelDefinitionContent, ProductProjection } from "@ontomato/contracts/product-panels";
import { panelContextKey, type PanelContext, type ProjectionSlot } from "./context";
import { applyPanelRequest, createPanelInstance } from "./instance";
import PanelProjection from "./Projection.vue";
import { runPanel } from "./lifecycle";
import { readPageDraft, readProjectionRecord, recordDraftCreated, readPanelData } from "./platform-requests";
import { baseComponents } from "../base-components";
import { prepareTemplateComponents } from "./template-components";
import { platformResourceLoader } from "./platform-objects";
import { platformResources } from "../resources";

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
  // Vue takes the mount element's markup for its root. This panel renders as a child of the context provider.
  const panelComponent = typeof component !== "function" && !component.render && !component.template
    ? { ...component, template: element.innerHTML }
    : component;
  const message = hostMessage();
  // A panel runs in a sandboxed frame of its own, which cannot read the platform's window: it connects the way a hosted
  // application does, over the message bridge. The platform sends each request with the reader's own credential and
  // decides which requests a frame may make.
  const [appContext, installTemplateComponents] = await Promise.all([
    connectPanelContext(),
    prepareTemplateComponents(typeof panelComponent === "function" ? undefined : panelComponent.template, baseComponents),
  ]);
  const transport = contextTransport(appContext);
  const address = ref(message.url);
  const text = createPanelText(message.panel.content.messages ?? {}, appContext.locale, defaultLocale);
  const instance = createPanelInstance(message.panel.manifest, {
    text,
    operations: panelHumanOperations(message.use, { request: (path, init, service) => transport.request(path, init, service) }),
    confirmOperation: (preparation) => panelBridgeHost().confirmPanelOperation(preparation),
    pageKey: message.pageKey,
    url: () => address.value,
    label: () => message.label,
    initial: message.state,
    translate: contextTranslate(appContext),
    reportDraftError: failed,
    recordDraftCreated: (link, id) => recordDraftCreated(transport, link, id),
    readProjection: async (id) => await readProjectionRecord(transport, id) as ProductProjection,
  });
  const unsaved = shallowReactive(new Set<Ref<boolean>>());
  const projectionListeners = new Set<(id: string, revision?: number) => void>();
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
    draft: instance.draft,
    holdUnsaved(flag) {
      unsaved.add(flag);
      return () => unsaved.delete(flag);
    },
    t: text,
    // The resource clients a projection binds, fetched with it and sending through this frame's request path.
    resources: platformResourceLoader({ request: (path, init, service) => transport.request(path, init, service) }, platformResources,
      contextTranslate(appContext)),
    expandPageComposer: contextExpandPageComposer(appContext),
    // A frame is not how a panel runs; it gets nothing new.
    navigate: () => Promise.reject(new Error("Navigating is a panel the platform runs in its own page; a frame has none")),
    notify: () => { throw new Error("Telling the reader through the platform's message is a panel the platform runs; a frame has none"); },
    readPanelData: (request) => readPanelData(transport, request),
  };
  const app = createApp({
    setup: () => {
      provide(panelContextKey, context);
      // A draft that none of this panel's forms performs is not this panel's: once every slot has registered and none
      // takes it, the frame fails with that, where the panel would have been, rather than waiting for a form that will
      // never come.
      const { t } = useI18n();
      watch(instance.unclaimedDraft, (unclaimed) => {
        if (unclaimed !== null) failed(t("platform.panelDraftUnclaimed", { ...unclaimed }));
      });
      return () => h(panelComponent);
    },
  });
  // The one global a panel's HTML and module need: `<Projection slot="…"/>`. Its name is the SDK's public API, so it is
  // a single word on purpose.
  // eslint-disable-next-line vue/multi-word-component-names
  app.component("Projection", PanelProjection);
  // The panel's own words, as its HTML reads them: `{{ t("settings.title") }}`. The platform's words stay `$t`.
  app.config.globalProperties.t = context.t;
  app.config.errorHandler = failed;
  // Element Plus's components and the SDK's base components a panel's HTML composes; neither carries business.
  installTemplateComponents(app);
  app.use(appContext).mount(element);

  const host = window.parent;
  const send = (value: PanelFrameMessage) =>
    host.postMessage({ channel: PANEL_HOST_CHANNEL, ...panelFrameMessageSchema.parse(value) }, "*");
  const run = runPanel({
    instance,
    pageKey: message.pageKey,
    address,
    isDirty: () => instance.dirty() || [...unsaved].some((flag) => flag.value),
    readPageDraft: (sessionId, runId, path) => readPageDraft(transport, sessionId, runId, path),
    projectionChanged: (id, revision) => projectionListeners.forEach((listener) => listener(id, revision)),
    refreshObject: (target) => {
      if (target) instance.objectChanged(target);
      else void nextTick(() => instance.refreshObjects());
    },
    reports: {
      state: (state, fromAddress) => send({ kind: "state", fromAddress, state }),
      context: (context) => send({ kind: "context", context }),
      dirty: (dirty) => send({ kind: "dirty", dirty }),
      operations: (operations) => send({ kind: "operations", operations }),
      // A draft the reader saved or discarded: the host takes its link out of the address, if the address still names it.
      draftSettled: (draft) => send({ kind: "draft-settled", draft }),
      failed,
    },
  });
  window.addEventListener("message", (event) => {
    if (event.source !== host) return;
    const parsed = panelMessageOf(panelHostFrameMessageSchema, event);
    if (!parsed) return;
    if (parsed.kind === "activity") return run.activity(parsed.active);
    if (parsed.kind === "address") return run.address(parsed.address);
    if (parsed.kind === "projections-changed") return run.projectionsChanged(parsed.projections);
    if (parsed.kind === "object-changed") return run.objectChanged(parsed.target);
    // A person's click in the platform's header: the same operation an agent's call reaches.
    const { requestId, id, input } = parsed;
    instance.invoke(id, input).then(
      (result) => send({ kind: "invoked", requestId, result }),
      (reason: unknown) =>
        send({ kind: "invoked", requestId, error: reason instanceof Error ? reason.message : String(reason) }),
    );
  });
  await run.start();
  return { context, appContext };
}

/** Tells the host this panel cannot run, and why; the host shows it where the panel would have been. */
function failed(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  window.parent.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "failed", message }, "*");
}

/** The run's facts as the host wrote them into this document, before the module ran. */
function hostMessage(): PanelHostMessage {
  const element = document.querySelector("script[data-panel-host-message]");
  if (!element) throw new Error("This document is not a panel run: it carries no host message");
  return panelHostMessageSchema.parse(JSON.parse(element.textContent ?? ""));
}

export { applyPanelRequest, type PageDraft, type PanelDefinitionContent, type PanelStateValue, type ProjectionSlot };
