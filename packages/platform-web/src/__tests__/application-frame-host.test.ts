import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, provide, onBeforeUnmount, onMounted, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationEntryResolution, ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { pageCounterKey, type ConversationDisplay, type SessionRunHandlers } from "@ontomato/agent-shell-ui";
import { AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import { provideApplicationFrame, providePageHeading, type DirectPanelRun } from "@ontomato/platform-shell";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";
import type { PlatformAppDeclaration } from "../apps";
import type { PanelObjectChange } from "../panel-host";

const ontologyFrameId = "builtin-product-om-frame";
const appBFrameId = "frame-app-b";

const playgroundUse: ApplicationPanelUse = {
  id: "use-ontology-playground",
  panelId: "panel-ontology-playground",
  path: "/ontology/playground",
  pageKey: "ontology-playground",
  names: { en: "Ontology graph" },
  access: { kind: "domain-member" },
};
const objectsUse: ApplicationPanelUse = {
  id: "use-ontology-objects",
  panelId: "panel-ontology-objects",
  path: "/ontology/objects",
  pageKey: "ontology-objects",
  names: { en: "Object types" },
  access: { kind: "domain-member" },
};
const relationsUse: ApplicationPanelUse = {
  id: "use-ontology-relations",
  panelId: "panel-ontology-relations",
  path: "/ontology/relations",
  pageKey: "ontology-relations",
  names: { en: "Relationships" },
  access: { kind: "domain-member" },
};
const appBHomeUse: ApplicationPanelUse = {
  id: "use-app-b-home",
  panelId: "panel-app-b-home",
  path: "/applications/app-b/home",
  pageKey: "app-b-home",
  names: { en: "App B home" },
  access: { kind: "domain-member" },
};

const conversationUse: ApplicationEntryResolution["use"] = {
  kind: "frame-conversation", id: "chat", pageKey: "chat", path: "/applications/app-b/chat",
  access: { kind: "domain-member" },
};
const runFeed = vi.hoisted(() => ({ subscribe: vi.fn(), detach: vi.fn() }));
vi.mock("@ontomato/workbench-ui/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ sessionRuns: { subscribe: runFeed.subscribe } }),
}));

const catalogApplications = ref<unknown[]>([]);
const resolveApplicationEntryMock = vi.fn<[{ path?: string; useId?: string }], Promise<ApplicationEntryResolution>>();
const readApplicationFrameManifestMock = vi.fn<
  [string, ApplicationPanelUse, string],
  Promise<Pick<PanelManifest, "state"> | null>
>();
const framePanelHostCalls: Array<{ applicationId: string; framePanelId: string; useId: string }> = [];
const builtinFramePanelHostCalls: Array<{ applicationId: string; framePanelId: string }> = [];
let frameDisplay: (() => ConversationDisplay) | undefined;
let frameOwnsComposer = false;
let frameChangedCallbacks: Array<(change: PanelObjectChange) => void> = [];
let contentChangedCallbacks: Array<(change: PanelObjectChange) => void> = [];

vi.mock("../catalog", () => ({
  useApplicationCatalog: () => ({
    applications: catalogApplications,
    loading: ref(false),
    refresh: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../panel-host", () => ({
  resolveApplicationEntry: (query: { path?: string; useId?: string }) => resolveApplicationEntryMock(query),
  readApplicationFrameManifest: (appId: string, use: ApplicationPanelUse, framePanelId: string) =>
    readApplicationFrameManifestMock(appId, use, framePanelId),
  cachedApplicationFrameManifest: vi.fn(() => null),
  framePanelHost: (
    applicationId: string,
    use: ApplicationPanelUse,
    framePanelId: string,
    changed: (change: PanelObjectChange) => void,
    _router: unknown,
    chat: { display: () => ConversationDisplay; onPanelLoaded: (ownsComposer: boolean) => void },
  ) => {
    frameDisplay = chat.display;
    chat.onPanelLoaded(frameOwnsComposer);
    framePanelHostCalls.push({ applicationId, framePanelId, useId: use.id });
    frameChangedCallbacks.push(changed);
    return { kind: "frame" as const, applicationId, framePanelId };
  },
  builtinFramePanelHost: (applicationId: string, framePanelId: string) => {
    builtinFramePanelHostCalls.push({ applicationId, framePanelId });
    return { kind: "frame" as const, applicationId, framePanelId };
  },
  platformPanelHost: (
    applicationId: string,
    use: ApplicationPanelUse,
    changed: (change: PanelObjectChange) => void,
    _mode: unknown,
    pageSkill: (skill: PageSkillContext) => void,
  ) => {
    void nextTick(() => pageSkill({ mode: "public", locator: { access: "domain-member", pageKey: use.pageKey } }));
    contentChangedCallbacks.push(changed);
    return { kind: "content" as const, applicationId, use };
  },
  onPanelReadDenied: () => () => {},
}));

interface MountedPanelHostRecord {
  kind: "frame" | "content";
  applicationId: string;
  id: string;
  unmounted: boolean;
  refreshes: PanelObjectChange[];
  applyState: ReturnType<typeof vi.fn>;
  emitSurfaceReady: (ready: boolean) => void;
  emitFrameState: (state: Record<string, unknown>) => void;
  emitFrameAddress: (address: string) => void;
  currentEntry?: DirectPanelRun["currentEntry"];
}

const mountedHosts: MountedPanelHostRecord[] = [];
let manualFrameSurfaceReady = false;

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  PanelHost: defineComponent({
    name: "PanelHostDouble",
    props: {
      port: { type: Object, required: true },
      address: { type: String, required: true },
      shown: { type: Boolean, default: true },
      frameState: { type: Object, default: () => ({}) },
      currentEntry: { type: Object, default: undefined },
    },
    emits: ["surface-ready", "display-address", "display-state", "display-loaded", "display-dirty", "context", "reopened", "withdrawn"],
    setup(props, { emit, expose }) {
      const port = props.port as
        | { kind: "frame"; applicationId: string; framePanelId: string }
        | { kind: "content"; applicationId: string; use: ApplicationPanelUse };
      const slotMountEl = ref<HTMLElement | null>(null);
      let disposePlacement: (() => void) | null = null;
      const record: MountedPanelHostRecord = {
        kind: port.kind,
        applicationId: port.applicationId,
        id: port.kind === "frame" ? port.framePanelId : port.use.id,
        unmounted: false,
        refreshes: [],
        applyState: vi.fn(),
        emitSurfaceReady: (ready: boolean) => emit("surface-ready", ready),
        emitFrameState: (state: Record<string, unknown>) => emit("display-state", state),
        emitFrameAddress: (address: string) => emit("display-address", { kind: "state", address }),
        currentEntry: props.currentEntry as DirectPanelRun["currentEntry"] | undefined,
      };
      mountedHosts.push(record);

      expose({
        applyState: record.applyState,
        validateState() {},
        blocksNavigation: () => false,
        probePresentation: async () => undefined,
        presentationAddress: (address: string) => address,
        refresh(target: PanelObjectChange["target"], affected?: PanelObjectChange["affected"], operation?: PanelObjectChange["operation"]) {
          record.refreshes.push({ target, affected, operation });
        },
      });

      if (port.kind === "frame" && manualFrameSurfaceReady) {
        emit("surface-ready", false);
      }

      onMounted(() => {
        if (port.kind === "content") {
          emit("context", { url: props.address, label: port.use.id, state: { tab: port.use.id }, selection: [] });
          emit("display-loaded", { status: "ready" });
        }
        if (port.kind === "frame" && slotMountEl.value) {
          const handle = (props.currentEntry as DirectPanelRun["currentEntry"] | undefined)?.place(slotMountEl.value);
          disposePlacement = handle?.dispose ?? null;
        }
      });

      onBeforeUnmount(() => {
        record.unmounted = true;
        disposePlacement?.();
        disposePlacement = null;
      });

      return () => {
        if (port.kind === "frame") {
          const current = (props.currentEntry as DirectPanelRun["currentEntry"] | undefined)?.entry.value;
          const hostGroups = (props.currentEntry as DirectPanelRun["currentEntry"] | undefined)?.hostMenu?.value ?? [];
          return h("div", {
            "data-frame-panel": port.framePanelId,
            "data-frame-app": port.applicationId,
            "data-active-path": current?.path ?? "",
            "data-active-use": current?.useId ?? "",
            "data-host-group-count": String(hostGroups.length),
          }, [
            h("div", { ref: slotMountEl, class: "mock-current-entry-slot" }),
          ]);
        }
        return h("div", {
          "data-content-use": port.use.id,
          "data-content-app": port.applicationId,
          "data-frame-state": JSON.stringify(props.frameState ?? {}),
        }, port.use.id);
      };
    },
  }),
}));

const PlatformLayout = (await import("../PlatformLayout.vue")).default;
const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

const layoutLabels = {
  expandRail: "Expand",
  collapseRail: "Collapse",
  back: "Back",
  applications: "Applications",
  brand: "Ontomato",
  account: "Account",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  signOut: "Sign out",
  opensInNewTab: "Opens in a new tab",
  pages: "Pages",
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
  more: "More",
  copyExternalLink: "Copy external link",
  externalLinkCopied: "Copied",
};

const apps: PlatformAppDeclaration[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    category: "business",
    prefix: "/home",
  },
  {
    id: "ontology",
    label: "Ontology manager",
    icon: "network",
    category: "build",
    prefix: "/ontology",
    framePanelId: ontologyFrameId,
    groups: [
      {
        key: "ontology:facts",
        label: "Facts",
        pages: [
          { id: "/ontology/playground", label: "Ontology graph", icon: "network" },
          { id: "/ontology/objects", label: "Object types", icon: "boxes" },
          { id: "/ontology/relations", label: "Relationships", icon: "link" },
        ],
      },
      {
        key: "ontology:governance",
        label: "Governance",
        pages: [
          { id: "/ontology/members", label: "Members", icon: "users" },
        ],
      },
    ],
  },
  {
    id: "app-b",
    label: "App B",
    icon: "app-window",
    category: "business",
    prefix: "/applications/app-b",
    framePanelId: appBFrameId,
    groups: [],
  },
];

function resolutionOf(
  applicationId: string,
  use: ApplicationEntryResolution["use"],
  panelUses: ApplicationEntryResolution["use"][],
  framePanelId?: string,
): ApplicationEntryResolution {
  return {
    applicationId,
    use,
    ...(framePanelId ? { framePanelId } : {}),
    menu: { groups: [], panelUses },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountPlatformShell(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", component: defineComponent({ render: () => h("div", { class: "home-page" }, "Home") }) },
      {
        path: "/ontology/members",
        meta: { page: "/ontology/members" },
        component: defineComponent({ render: () => h("div", { class: "native-members-page" }, "Members") }),
      },
      {
        path: "/ontology/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: () => ({ applicationId: "ontology" }),
      },
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: (route) => ({ applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  await router.push(initialPath);
  await router.isReady();

  const wrapper = mount(defineComponent({
    setup() {
      const heading = providePageHeading();
      const framed = provideApplicationFrame();
      provide(pageCounterKey, {
        agents: async () => [],
        pageAgents: async () => ({ agents: [{ id: "agent", name: "Agent", description: "", enabled: true, icon: null }] }),
        preferredAgentId: ref(null), ask: vi.fn(),
      });
      return () => h(PlatformLayout, {
        apps,
        shownPage: router.currentRoute.value.path === "/home"
          ? null
          : { title: heading.value?.title ?? "Members", named: Boolean(heading.value) },
        account: null,
        preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
        labels: layoutLabels,
        pageActions: null,
        appFramed: framed.value,
      });
    },
  }), {
    global: { plugins: [router, workbenchI18n()] },
  });
  await nextTick();
  return { router, wrapper };
}

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled: false,
    save: null,
    messages: { en: publicEn },
    elementLocale: () => elementEn,
  });
});

beforeEach(() => {
  runFeed.subscribe.mockReset().mockReturnValue(runFeed.detach);
  runFeed.detach.mockClear();
  frameDisplay = undefined;
  frameOwnsComposer = false;
  mountedHosts.length = 0;
  framePanelHostCalls.length = 0;
  builtinFramePanelHostCalls.length = 0;
  frameChangedCallbacks = [];
  contentChangedCallbacks = [];
  manualFrameSurfaceReady = false;
  catalogApplications.value = [
    { id: "ontology", framePanelId: ontologyFrameId, panelUses: [playgroundUse, objectsUse, relationsUse] },
    { id: "app-b", framePanelId: appBFrameId, panelUses: [appBHomeUse] },
  ];
  resolveApplicationEntryMock.mockReset();
  readApplicationFrameManifestMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApplicationFrameHost single persistent outer frame", () => {
  it("switches a frame-only conversation to live content within the same frame using one session feed", async () => {
    const entries = [conversationUse, appBHomeUse];
    catalogApplications.value = [{ id: "app-b", framePanelId: appBFrameId, panelUses: entries }];
    resolveApplicationEntryMock.mockImplementation(async ({ path }) =>
      resolutionOf("app-b", path === conversationUse.path ? conversationUse : appBHomeUse, entries, appBFrameId),
    );
    frameOwnsComposer = true;
    const { router, wrapper } = await mountPlatformShell(conversationUse.path);
    await flushPromises();
    const frame = mountedHosts.find(host => host.kind === "frame")!;
    expect(frame.currentEntry?.entry.value).toMatchObject({ kind: "frame-conversation" });
    expect(frame.currentEntry?.entry.value.panelId).toBeUndefined();
    expect(mountedHosts.some(host => host.kind === "content")).toBe(false);
    const display = frameDisplay!();
    expect(display.snapshot()).toMatchObject({ known: true, target: null });
    expect(display.pageSkill.value).toBeNull();

    const frameInput = { type: "presentation" as const, sessionId: "session", runId: "run", toolCallId: "show" };
    await display.present({ ...frameInput, target: { kind: "page", address: appBHomeUse.path } });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(appBHomeUse.path);
    const content = mountedHosts.find(host => host.kind === "content")!;
    expect(frame.unmounted).toBe(false);
    expect(display.snapshot()).toMatchObject({ target: { url: appBHomeUse.path, state: { tab: appBHomeUse.id } } });
    await display.present({ ...frameInput, target: { kind: "page", address: appBHomeUse.path, state: { tab: "detail" } } });
    expect(content.applyState).toHaveBeenCalledWith({ tab: "detail" });
    expect(wrapper.find(".page-ask").exists()).toBe(false);

    expect(runFeed.subscribe).toHaveBeenCalledTimes(1);
    const handlers: SessionRunHandlers = runFeed.subscribe.mock.calls[0]![0];
    await handlers.frame({ type: "run_started", sessionId: "session", runId: "run" });
    for (const host of [content, frame]) {
      expect(host.refreshes.at(-1)).toMatchObject({
        target: { objectType: AGENT_SESSION, primaryKey: "session" },
        affected: { objectTypes: [AGENT_SESSION] },
      });
    }
    wrapper.unmount();
    expect(runFeed.detach).toHaveBeenCalledTimes(1);
  });

  it("keeps the outer frame mounted across native <-> panel <-> panel <-> native switches in a hybrid app with zero teardown and live menu highlight", async () => {
    resolveApplicationEntryMock.mockImplementation(async ({ path }) => {
      if (path === objectsUse.path) return resolutionOf("ontology", objectsUse, [playgroundUse, objectsUse, relationsUse], ontologyFrameId);
      return resolutionOf("ontology", relationsUse, [playgroundUse, objectsUse, relationsUse], ontologyFrameId);
    });

    // 1. Enter Ontology manager on a native Vue page.
    const { router, wrapper } = await mountPlatformShell("/ontology/members");
    await flushPromises();

    const initialFrameEl = wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element;
    const frameRecords = () => mountedHosts.filter((host) => host.kind === "frame");
    expect(frameRecords()).toHaveLength(1);
    expect(framePanelHostCalls).toHaveLength(1);
    expect(frameRecords()[0]!.unmounted).toBe(false);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).attributes("data-active-path")).toBe("/ontology/members");
    expect(wrapper.find(".native-members-page").exists()).toBe(true);
    expect(wrapper.find(".platform-page-header").exists()).toBe(true);
    expect(wrapper.find(".platform-page-body.own-frame").exists()).toBe(false);

    // 2. Switch from native page to panel entry (/ontology/objects): same frame instance & DOM node, zero rebuild.
    await router.push("/ontology/objects");
    await flushPromises();

    expect(frameRecords()).toHaveLength(1);
    expect(framePanelHostCalls).toHaveLength(1);
    expect(frameRecords()[0]!.unmounted).toBe(false);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element).toBe(initialFrameEl);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).attributes("data-active-path")).toBe("/ontology/objects");
    expect(wrapper.find('[data-content-use="use-ontology-objects"]').exists()).toBe(true);
    expect(wrapper.find(".platform-page-header").exists()).toBe(false);
    expect(wrapper.find(".platform-page-body.own-frame").exists()).toBe(true);

    // Verify bidirectional object-change refresh between outer frame and panel content.
    const change: PanelObjectChange = {
      target: { objectType: "sys:object-type", primaryKey: "ot-1" },
      affected: { objects: [], objectTypes: ["sys:object-type"] },
    };
    const contentRecord = mountedHosts.find((host) => host.kind === "content" && host.id === objectsUse.id)!;
    contentChangedCallbacks[0]!(change);
    expect(contentRecord.refreshes).toHaveLength(1);
    expect(frameRecords()[0]!.refreshes).toHaveLength(1);
    frameChangedCallbacks[0]!(change);
    expect(frameRecords()[0]!.refreshes).toHaveLength(2);
    expect(contentRecord.refreshes).toHaveLength(2);

    // 3. Switch to another panel entry (/ontology/relations): still the same frame instance.
    await router.push("/ontology/relations");
    await flushPromises();

    expect(frameRecords()).toHaveLength(1);
    expect(framePanelHostCalls).toHaveLength(1);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element).toBe(initialFrameEl);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).attributes("data-active-path")).toBe("/ontology/relations");
    expect(wrapper.find('[data-content-use="use-ontology-relations"]').exists()).toBe(true);

    // 4. Switch back to native page (/ontology/members): still the same frame instance, header restored.
    await router.push("/ontology/members");
    await flushPromises();

    expect(frameRecords()).toHaveLength(1);
    expect(framePanelHostCalls).toHaveLength(1);
    expect(frameRecords()[0]!.unmounted).toBe(false);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element).toBe(initialFrameEl);
    expect(wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).attributes("data-active-path")).toBe("/ontology/members");
    expect(wrapper.find(".native-members-page").exists()).toBe(true);
    expect(wrapper.find(".platform-page-header").exists()).toBe(true);
    expect(wrapper.find(".platform-page-body.own-frame").exists()).toBe(false);

    wrapper.unmount();
  });

  it("starts loading the outer frame at t=0ms without waiting for resolve-entry and displays a loading placeholder until surface-ready", async () => {
    manualFrameSurfaceReady = true;
    const pendingResolve = deferred<ApplicationEntryResolution>();
    resolveApplicationEntryMock.mockReturnValueOnce(pendingResolve.promise);

    const { wrapper } = await mountPlatformShell("/ontology/playground");
    await nextTick();

    // Frame host port is created and mounted immediately before resolve-entry settles.
    expect(framePanelHostCalls).toHaveLength(1);
    expect(framePanelHostCalls[0]).toEqual({
      applicationId: "ontology",
      framePanelId: ontologyFrameId,
      useId: playgroundUse.id,
    });
    const frameHost = mountedHosts.find((host) => host.kind === "frame");
    expect(frameHost).toBeDefined();

    // Before surface-ready fires, a non-blank loading placeholder is rendered instead of empty space.
    const placeholder = wrapper.find("[data-panel-loading-placeholder]");
    expect(placeholder.exists()).toBe(true);
    expect(placeholder.attributes("role")).toBe("status");
    expect(placeholder.attributes("aria-busy")).toBe("true");
    expect((wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element as HTMLElement).style.display).toBe("none");

    // Once the outer frame reports surface-ready, the placeholder disappears even before resolve-entry settles.
    frameHost!.emitSurfaceReady(true);
    await nextTick();
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);
    expect((wrapper.get(`[data-frame-panel="${ontologyFrameId}"]`).element as HTMLElement).style.display).toBe("");

    pendingResolve.resolve(resolutionOf("ontology", playgroundUse, [playgroundUse, objectsUse], ontologyFrameId));
    await flushPromises();
    wrapper.unmount();
  });

  it("resets frame state on cross-application switch and cleanly restores the page slot when entering an unframed route", async () => {
    resolveApplicationEntryMock.mockImplementation(async ({ path }) => {
      if (path === objectsUse.path) return resolutionOf("ontology", objectsUse, [playgroundUse, objectsUse], ontologyFrameId);
      return resolutionOf("app-b", appBHomeUse, [appBHomeUse], appBFrameId);
    });

    const { router, wrapper } = await mountPlatformShell("/ontology/objects");
    await flushPromises();

    // Set shared frame state on Ontology manager's frame.
    const ontologyFrameHost = mountedHosts.find((host) => host.kind === "frame" && host.id === ontologyFrameId)!;
    ontologyFrameHost.emitFrameState({ term: "B" });
    ontologyFrameHost.emitFrameAddress("/ontology/objects?term=B");
    await flushPromises();
    expect(wrapper.get('[data-content-use="use-ontology-objects"]').attributes("data-frame-state")).toBe(JSON.stringify({ term: "B" }));

    // Switch to another framed application (app-b): old frame unmounts, old frameState is cleared, new frame mounts.
    await router.push("/applications/app-b/home");
    await flushPromises();

    expect(ontologyFrameHost.unmounted).toBe(true);
    expect(wrapper.find(`[data-frame-panel="${ontologyFrameId}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-frame-panel="${appBFrameId}"]`).exists()).toBe(true);
    expect(wrapper.get('[data-content-use="use-app-b-home"]').attributes("data-frame-state")).toBe(JSON.stringify({}));

    // Switch to an unframed route (/home): app-b frame unmounts and slotted page restores cleanly into holder.
    const appBFrameHost = mountedHosts.find((host) => host.kind === "frame" && host.id === appBFrameId)!;
    await router.push("/home");
    await flushPromises();

    expect(appBFrameHost.unmounted).toBe(true);
    expect(wrapper.find("[data-frame-panel]").exists()).toBe(false);
    expect(wrapper.find(".home-page").exists()).toBe(true);
    const holder = wrapper.get(".application-frame-holder").element as HTMLElement;
    expect(holder.hidden).toBe(false);
    expect(holder.querySelector(".home-page")).not.toBeNull();

    wrapper.unmount();
  });

  it("renders unframed beside a conversation without ApplicationFrameHost and decodes frame.* manifest defaults and URL overrides", async () => {
    resolveApplicationEntryMock.mockResolvedValue(
      resolutionOf("app-b", appBHomeUse, [appBHomeUse], appBFrameId),
    );
    readApplicationFrameManifestMock.mockResolvedValue({
      state: {
        term: {
          type: { kind: "scalar", type: "string" },
          personal: false,
          deepLink: true,
          external: true,
          default: "A",
        },
      },
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/chat", component: { render: () => null } }],
    });
    await router.push("/chat");
    await router.isReady();

    // 1. Clean URL without frame.* receives manifest default `"A"` without mounting any frame panel.
    const defaultWrapper = mount(PanelApplicationRoute, {
      props: { applicationId: "app-b", address: appBHomeUse.path, navigate: vi.fn() },
      global: { plugins: [router, workbenchI18n()] },
    });
    await flushPromises();
    expect(framePanelHostCalls).toHaveLength(0);
    expect(defaultWrapper.find("[data-frame-panel]").exists()).toBe(false);
    expect(defaultWrapper.get('[data-content-use="use-app-b-home"]').attributes("data-frame-state")).toBe(JSON.stringify({ term: "A" }));
    defaultWrapper.unmount();

    // 2. Explicit frame.term=B overrides the default beside a conversation.
    const overrideWrapper = mount(PanelApplicationRoute, {
      props: { applicationId: "app-b", address: `${appBHomeUse.path}?frame.term=B`, navigate: vi.fn() },
      global: { plugins: [router, workbenchI18n()] },
    });
    await flushPromises();
    expect(framePanelHostCalls).toHaveLength(0);
    expect(overrideWrapper.get('[data-content-use="use-app-b-home"]').attributes("data-frame-state")).toBe(JSON.stringify({ term: "B" }));
    overrideWrapper.unmount();
  });

  it("mounts builtinFramePanelHost for a built-in framed app whose admitted entries are native-only without hostGroups", async () => {
    const { default: ApplicationFrameHost } = await import("../ApplicationFrameHost.vue");
    const nativeMonitor = {
      id: "system-monitor",
      pageKey: "system-monitor",
      kind: "native" as const,
      path: "/settings/records/system-monitor",
      icon: "activity",
      groupKey: "records",
      access: { permissionCode: "system-monitoring" },
      names: { en: "System monitoring" },
    };
    catalogApplications.value = [
      {
        id: "settings",
        framePanelId: "builtin-product-platform-frame",
        names: { en: "System settings" },
        groups: [{ key: "records", names: { en: "Logs and monitoring" }, sort: 3 }],
        panelUses: [nativeMonitor],
      },
    ];

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/settings/records/system-monitor",
          component: defineComponent({
            name: "NativeMonitorStub",
            render: () => h("div", { "data-native-monitor": "true" }, "monitor"),
          }),
        },
      ],
    });
    await router.push("/settings/records/system-monitor");
    await router.isReady();

    const HostHarness = defineComponent({
      render() {
        return h(
          ApplicationFrameHost,
          {
            frame: {
              applicationId: "settings",
              framePanelId: "builtin-product-platform-frame",
              title: "System settings",
              groups: null,
              activePageId: "/settings/records/system-monitor",
            },
          },
          { default: () => h(RouterView) },
        );
      },
    });

    const wrapper = mount(HostHarness, { global: { plugins: [router, workbenchI18n()] } });
    await flushPromises();

    expect(framePanelHostCalls).toHaveLength(0);
    expect(builtinFramePanelHostCalls).toEqual([
      { applicationId: "settings", framePanelId: "builtin-product-platform-frame" },
    ]);
    expect(wrapper.find('[data-frame-panel="builtin-product-platform-frame"]').exists()).toBe(true);
    expect(wrapper.find('[data-native-monitor="true"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
