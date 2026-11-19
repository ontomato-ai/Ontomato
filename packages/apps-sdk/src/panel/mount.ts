import { createApp, h, nextTick, provide, ref, shallowReactive, watch, type Component, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { contextTranslate, contextTransport, type AppContext } from "../context";
import { connectPanelContext } from "./app-context";
import { defaultLocale } from "apps-sdk:panel-appearance";
import { createPanelText } from "./text";
import {
  PANEL_HOST_CHANNEL,
  panelAddressState,
  panelFrameMessageSchema,
  panelHostFrameMessageSchema,
  panelHostMessageSchema,
  panelMessageOf,
  type PanelFrameMessage,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { DefinitionRevision } from "@ontomato/contracts/product-subscriptions";
import { pageDraftReadSchema, type PageDraft } from "@ontomato/contracts/page-draft";
import { panelOperationSchema, type PanelObjectIdentity, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { PanelDefinitionContent, ProductProjection } from "@ontomato/contracts/product-panels";
import { panelContextKey, type PanelContext, type ProjectionSlot } from "./context";
import { applyPanelRequest, createPanelInstance, pageDraftLinkOf, type PanelInstance } from "./instance";
import { receivePanelDraft } from "./draft";
import PanelProjection from "./Projection.vue";
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
  const instance = createPanelInstance(message.panel.manifest, {
    pageKey: message.pageKey,
    url: () => address.value,
    label: () => message.label,
    initial: message.state,
    translate: contextTranslate(appContext),
    reportDraftError: failed,
    recordDraftCreated: async (link, id) => {
      const response = await transport.request(
        `/assistant/sessions/${encodeURIComponent(link.sessionId)}/runs/${encodeURIComponent(link.runId)}/page-draft/created`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: link.path, id }) },
        "",
      );
      if (!response.ok) throw new Error(`The draft at ${link.path} could not record the object it created`);
    },
    readProjection: async (id) => {
      const response = await transport.request(`/product-projections/${encodeURIComponent(id)}`, {}, "");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? `Projection ${id} is unavailable`);
      return body.projection as ProductProjection;
    },
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
    t: createPanelText(message.panel.content.messages ?? {}, appContext.locale, defaultLocale),
    // The resource clients a projection binds, fetched with it and sending through this frame's request path.
    resources: platformResourceLoader({ request: (path, init, service) => transport.request(path, init, service) }, platformResources),
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

  let currentDraft = "";
  async function followDraft() {
    const link = pageDraftLinkOf(address.value);
    const key = link ? JSON.stringify(link) : "";
    if (key === currentDraft) return;
    currentDraft = key;
    if (link)
      await receivePanelDraft(message.pageKey, instance.forms,
        { readPageDraft: (sessionId, runId, path) => readDraft(transport, sessionId, runId, path) },
        link, instance.receiveDraft, () => currentDraft === key);
  }
  async function followAddress(next: string) {
    const desired = panelAddressState(next);
    const patch: Record<string, PanelStateValue> = {};
    for (const [name, field] of Object.entries(message.panel.manifest.state)) {
      if (!field.deepLink) continue;
      const value = desired[name] ?? null;
      if (JSON.stringify(instance.state.values.value[name]) !== JSON.stringify(value)) patch[name] = value;
    }
    instance.state.setState(patch);
    address.value = next;
    await followDraft();
  }

  report({ instance, address, unsaved, followAddress, changed: (id, revision) => projectionListeners.forEach(listener => listener(id, revision)) });
  await followDraft();
  return { context, appContext };
}

/** Tells the host this panel cannot run, and why; the host shows it where the panel would have been. */
function failed(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
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
  return pageDraftReadSchema.parse(body);
}

/** The run's facts as the host wrote them into this document, before the module ran. */
function hostMessage(): PanelHostMessage {
  const element = document.querySelector("script[data-panel-host-message]");
  if (!element) throw new Error("This document is not a panel run: it carries no host message");
  return panelHostMessageSchema.parse(JSON.parse(element.textContent ?? ""));
}

interface ReportOptions {
  instance: PanelInstance;
  address: Ref<string>;
  followAddress(address: string): Promise<void>;
  unsaved: ReadonlySet<Ref<boolean>>;
  changed: (projectionId: string, revision?: number) => void;
}

/**
 * What one instance tells its host, and what it takes back. The host owns the address and the record; a changed
 * definition is read again here by its ID — the panel's whole record, or one projection's — but never over an unsaved
 * form.
 */
function report({ instance, address, followAddress, unsaved, changed }: ReportOptions) {
  const host = window.parent;
  const send = (value: PanelFrameMessage) =>
    host.postMessage({ channel: PANEL_HOST_CHANNEL, ...panelFrameMessageSchema.parse(value) }, "*");
  const isDirty = () => instance.dirty() || [...unsaved].some((flag) => flag.value);

  // The page context follows the state, the address and the names of the objects read since: a name that arrives after
  // its selection reaches the host as a context of its own.
  watch(() => instance.pageContext.value, (context) => send({ kind: "context", context }), { deep: true, immediate: true });
  watch([() => instance.state.values.value, address], () => {
    send({ kind: "state", fromAddress: address.value, state: instance.deepLink() });
  }, { deep: true, immediate: true });
  const waiting = new Map<string, DefinitionRevision>();
  const refreshProjections = () => {
    for (const { id, revision } of waiting.values()) changed(id, revision);
    waiting.clear();
  };
  /*
   * Whether the reader sees this instance (A's activity contract): the host says so as the tab, the shown page and the
   * instance's place change. While inactive the instance reads nothing on its own: a new address, a changed projection
   * and a changed object are held, and when it is active again each is acted on once — the latest address, each
   * projection at its latest revision, each object once however often it changed (any untargeted refresh covers them
   * all).
   */
  let active = true;
  let heldAddress: string | null = null;
  let heldAll = false;
  const heldObjects = new Map<string, PanelObjectIdentity>();
  const followAddressNow = (next: string) => void followAddress(next).catch(failed);
  const refreshObject = (target: PanelObjectIdentity | null) => {
    if (target) instance.objectChanged(target);
    else void nextTick(() => instance.refreshObjects());
  };
  const resume = () => {
    if (heldAddress !== null) followAddressNow(heldAddress);
    if (!isDirty()) refreshProjections();
    if (heldAll) refreshObject(null);
    else for (const target of heldObjects.values()) refreshObject(target);
    heldAddress = null;
    heldAll = false;
    heldObjects.clear();
  };

  // A draft the reader saved or discarded: the host takes its link out of the address, if the address still names it.
  instance.onDraftSettled((draft) => send({ kind: "draft-settled", draft }));
  watch(isDirty, dirty => {
    send({ kind: "dirty", dirty });
    if (!dirty && active) refreshProjections();
  }, { immediate: true });
  // The operations the header draws and an agent lists; they change as projections register and unregister.
  watch(() => instance.operations.value, (operations) => {
    // The wire description carries data only. Invocation stays in this frame.
    send({
      kind: "operations",
      operations: operations.map(({ invoke: _invoke, ...operation }) => panelOperationSchema.parse(operation)),
    });
  }, { immediate: true });

  window.addEventListener("message", (event) => {
    if (event.source !== host) return;
    const parsed = panelMessageOf(panelHostFrameMessageSchema, event);
    if (!parsed) return;
    if (parsed.kind === "activity") {
      active = parsed.active;
      if (active) resume();
      return;
    }
    if (parsed.kind === "address") {
      if (active) followAddressNow(parsed.address);
      else heldAddress = parsed.address;
      return;
    }
    if (parsed.kind === "projections-changed") {
      for (const revision of parsed.projections)
        if ((waiting.get(revision.id)?.revision ?? 0) < revision.revision) waiting.set(revision.id, revision);
      if (active && !isDirty()) refreshProjections();
      return;
    }
    if (parsed.kind === "object-changed") {
      if (active) refreshObject(parsed.target);
      else if (parsed.target) heldObjects.set(`${parsed.target.objectType}\u0000${parsed.target.primaryKey}`, parsed.target);
      else heldAll = true;
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

export { applyPanelRequest, type PageDraft, type PanelDefinitionContent, type PanelStateValue, type ProjectionSlot };
