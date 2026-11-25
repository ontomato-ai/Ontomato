import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationEntryResolution, ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DirectPanelRun } from "@ontomato/platform-shell";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";

const appA = "app-a";
const appB = "app-b";

const tasksUse: ApplicationPanelUse = {
  id: "use-tasks",
  panelId: "panel-tasks",
  path: "/applications/app-a/tasks",
  pageKey: "app-a-tasks",
  names: { en: "Tasks" },
  access: { kind: "domain-member" },
};
const summaryUse: ApplicationPanelUse = {
  id: "use-summary",
  panelId: "panel-summary",
  path: "/applications/app-a/summary",
  pageKey: "app-a-summary",
  names: { en: "Summary" },
  access: { kind: "domain-member" },
};
const reportsUse: ApplicationPanelUse = {
  id: "use-reports",
  panelId: "panel-reports",
  path: "/applications/app-a/reports",
  pageKey: "app-a-reports",
  names: { en: "Reports" },
  access: { kind: "domain-member" },
};
const hiddenUse: ApplicationPanelUse = {
  id: "use-hidden",
  panelId: "panel-hidden",
  path: "/applications/app-a/hidden",
  pageKey: "app-a-hidden",
  access: { kind: "domain-member" },
};
const appBUse: ApplicationPanelUse = {
  id: "use-b-home",
  panelId: "panel-b-home",
  path: "/applications/app-b/home",
  pageKey: "app-b-home",
  names: { en: "App B Home" },
  access: { kind: "domain-member" },
};

const resolveApplicationEntryMock = vi.fn<[{ path?: string; useId?: string }], Promise<ApplicationEntryResolution>>();
const catalogRefreshMock = vi.fn<[], Promise<unknown[]>>().mockResolvedValue([]);
const refreshApplicationMock = vi.fn<[string], Promise<unknown>>().mockResolvedValue(null);
const catalogApplications = ref<unknown[]>([]);
const readDeniedListeners = new Set<() => void>();
const visibilityListeners = new Set<(visible: boolean) => void>();
let isDocVisible = true;

vi.mock("../catalog", () => ({
  useApplicationCatalog: () => ({
    applications: catalogApplications,
    loading: ref(false),
    applicationById: (id: string) => (catalogApplications.value as Array<{ id: string }>).find((app) => app.id === id) ?? null,
    ensureApplication: vi.fn().mockResolvedValue(null),
    refreshApplication: refreshApplicationMock,
    refresh: catalogRefreshMock,
  }),
}));

interface MountedMockHost {
  kind: "frame" | "content";
  key: string;
  emitSurfaceReady: (ready: boolean) => void;
  currentEntry?: DirectPanelRun["currentEntry"];
  framePortRef?: unknown;
}
const mountedHosts: MountedMockHost[] = [];
let manualSurfaceReady = false;

vi.mock("@ontomato/foundation-ui/visibility", () => ({
  documentVisible: () => isDocVisible,
  onDocumentVisibility: (listener: (visible: boolean) => void) => {
    visibilityListeners.add(listener);
    return () => { visibilityListeners.delete(listener); };
  },
}));

vi.mock("../panel-host", () => ({
  resolveApplicationEntry: (query: { path?: string; useId?: string }) => resolveApplicationEntryMock(query),
  readApplicationFrameManifest: vi.fn(),
  cachedApplicationFrameManifest: vi.fn(() => null),
  builtinFramePanelHost: (applicationId: string, framePanelId: string) => ({
    kind: "frame",
    applicationId,
    framePanelId,
  }),
  framePanelHost: (applicationId: string, _use: ApplicationPanelUse, framePanelId: string) => ({
    kind: "frame",
    applicationId,
    framePanelId,
  }),
  platformPanelHost: (applicationId: string, use: ApplicationPanelUse) => ({
    kind: "content",
    applicationId,
    use,
  }),
  onPanelReadDenied: (listener: () => void) => {
    readDeniedListeners.add(listener);
    return () => { readDeniedListeners.delete(listener); };
  },
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  PanelHost: defineComponent({
    props: {
      port: { type: Object, required: true },
      address: { type: String, required: true },
      shown: { type: Boolean, default: true },
      currentEntry: { type: Object, default: undefined },
    },
    emits: ["surface-ready", "display-address", "display-loaded", "display-dirty", "context", "reopened", "withdrawn"],
    setup(props, { emit }) {
      const port = props.port as { kind: "frame"; applicationId: string; framePanelId: string }
        | { kind: "content"; applicationId: string; use: ApplicationPanelUse };
      const key = port.kind === "frame" ? `frame:${port.framePanelId}` : port.use.id;
      const record: MountedMockHost = {
        kind: port.kind,
        key,
        emitSurfaceReady: (ready: boolean) => emit("surface-ready", ready),
        currentEntry: props.currentEntry as DirectPanelRun["currentEntry"] | undefined,
        framePortRef: port,
      };
      mountedHosts.push(record);
      if (manualSurfaceReady) {
        emit("surface-ready", false);
      }
      return () => {
        if (port.kind === "frame") {
          const entry = (props.currentEntry as DirectPanelRun["currentEntry"] | undefined)?.entry.value;
          return h("div", {
            "data-frame-panel": port.framePanelId,
            "data-frame-app": port.applicationId,
            "data-current-entry-id": entry?.useId ?? "",
            "data-current-entry-path": entry?.path ?? "",
          });
        }
        return h("div", {
          "data-content-use": port.use.id,
          "data-content-app": port.applicationId,
        }, port.use.id);
      };
    },
  }),
}));

const ApplicationFrameHost = (await import("../ApplicationFrameHost.vue")).default;
const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

function resolutionOf(
  applicationId: string,
  use: ApplicationPanelUse,
  panelUses: ApplicationPanelUse[],
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

async function mountRoute(initialPath: string, routeProps: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: (route) => ({ ...routeProps, applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(defineComponent({
    render: () => h(ApplicationFrameHost, null, { default: () => h(RouterView) }),
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
  mountedHosts.length = 0;
  manualSurfaceReady = false;
  isDocVisible = true;
  readDeniedListeners.clear();
  visibilityListeners.clear();
  resolveApplicationEntryMock.mockReset();
  catalogRefreshMock.mockReset().mockResolvedValue([]);
  refreshApplicationMock.mockReset().mockResolvedValue(null);
  catalogApplications.value = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("entry-table admission, refresh, and transition experience", () => {
  it("admits same-application entry-table navigation immediately without re-querying resolve-entry and updates frameContext.currentEntry", async () => {
    const menuUses = [tasksUse, summaryUse];
    catalogApplications.value = [
      { id: appA, framePanelId: "frame-a", panelUses: menuUses },
    ];
    resolveApplicationEntryMock.mockResolvedValueOnce(resolutionOf(appA, tasksUse, menuUses, "frame-a"));

    const { router, wrapper } = await mountRoute(tasksUse.path);
    await flushPromises();

    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-frame-panel="frame-a"]').attributes("data-current-entry-id")).toBe(tasksUse.id);
    expect(wrapper.get('[data-frame-panel="frame-a"]').attributes("data-current-entry-path")).toBe(tasksUse.path);

    // Navigate to another entry in the same application's entry table.
    await router.push(summaryUse.path);
    await nextTick();

    // No extra resolve-entry call; content mounts and frame currentEntry updates immediately.
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-content-use="use-summary"]').exists()).toBe(true);
    expect(wrapper.get('[data-frame-panel="frame-a"]').attributes("data-current-entry-id")).toBe(summaryUse.id);
    expect(wrapper.get('[data-frame-panel="frame-a"]').attributes("data-current-entry-path")).toBe(summaryUse.path);
    wrapper.unmount();
  });

  it("blocks direct links outside the entry table until resolve-entry answers, showing only the loading placeholder without leaking content/context/skills", async () => {
    const pending = deferred<ApplicationEntryResolution>();
    resolveApplicationEntryMock.mockReturnValueOnce(pending.promise);
    const onContext = vi.fn();
    const onDisplaySkill = vi.fn();

    const { wrapper } = await mountRoute(hiddenUse.path, { onContext, onDisplaySkill });
    await nextTick();

    expect(resolveApplicationEntryMock).toHaveBeenCalledWith({ path: hiddenUse.path });
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(true);
    expect(wrapper.get("[data-panel-loading-placeholder]").attributes("role")).toBe("status");
    expect(wrapper.get("[data-panel-loading-placeholder]").attributes("aria-busy")).toBe("true");
    expect(wrapper.find('[data-content-use="use-hidden"]').exists()).toBe(false);
    expect(mountedHosts).toHaveLength(0);
    expect(onContext).not.toHaveBeenCalled();
    expect(onDisplaySkill).not.toHaveBeenCalled();

    pending.resolve(resolutionOf(appA, hiddenUse, [tasksUse]));
    await flushPromises();

    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);
    expect(wrapper.find('[data-content-use="use-hidden"]').exists()).toBe(true);
    expect(onContext).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("retains the previous screen for up to 150ms on same-app transitions, falls back to loading placeholder after 150ms, and cuts immediately when surface-ready fires", async () => {
    vi.useFakeTimers();
    manualSurfaceReady = true;
    const menuUses = [tasksUse, summaryUse, reportsUse];
    catalogApplications.value = [{ id: appA, panelUses: menuUses }];
    resolveApplicationEntryMock.mockResolvedValue(resolutionOf(appA, tasksUse, menuUses));

    // Cold open: no previous screen, so loading placeholder is shown immediately.
    const { router, wrapper } = await mountRoute(tasksUse.path);
    await nextTick();
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(true);
    expect((wrapper.get('[data-content-use="use-tasks"]').element as HTMLElement).style.display).toBe("none");

    // First page becomes surface-ready: displayed immediately, placeholder gone.
    mountedHosts.find((h) => h.key === "use-tasks")!.emitSurfaceReady(true);
    await nextTick();
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);
    expect((wrapper.get('[data-content-use="use-tasks"]').element as HTMLElement).style.display).toBe("");

    // Switch to summary: surface not ready yet -> tasks stays visible for < 150ms, no placeholder flash.
    await router.push(summaryUse.path);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-tasks"]').element as HTMLElement).style.display).toBe("");
    expect((wrapper.get('[data-content-use="use-summary"]').element as HTMLElement).style.display).toBe("none");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);

    vi.advanceTimersByTime(100);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-tasks"]').element as HTMLElement).style.display).toBe("");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);

    // Summary becomes ready before 150ms -> seamless cut with zero placeholder flash.
    mountedHosts.find((h) => h.key === "use-summary")!.emitSurfaceReady(true);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-tasks"]').element as HTMLElement).style.display).toBe("none");
    expect((wrapper.get('[data-content-use="use-summary"]').element as HTMLElement).style.display).toBe("");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);

    // Switch to reports: slow mount exceeds 150ms -> switches from retained summary to loading placeholder.
    await router.push(reportsUse.path);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-summary"]').element as HTMLElement).style.display).toBe("");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);

    vi.advanceTimersByTime(149);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-summary"]').element as HTMLElement).style.display).toBe("");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);

    vi.advanceTimersByTime(1);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-summary"]').element as HTMLElement).style.display).toBe("none");
    expect((wrapper.get('[data-content-use="use-reports"]').element as HTMLElement).style.display).toBe("none");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(true);

    // Reports becomes ready -> immediately replaces placeholder.
    mountedHosts.find((h) => h.key === "use-reports")!.emitSurfaceReady(true);
    await nextTick();
    expect((wrapper.get('[data-content-use="use-reports"]').element as HTMLElement).style.display).toBe("");
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("resets previous resolution, frame port, and retained page immediately on cross-application switch and shows loading placeholder", async () => {
    manualSurfaceReady = true;
    catalogApplications.value = [
      { id: appA, framePanelId: "frame-a", panelUses: [tasksUse] },
      { id: appB, framePanelId: "frame-b", panelUses: [appBUse] },
    ];
    const pendingB = deferred<ApplicationEntryResolution>();
    resolveApplicationEntryMock
      .mockResolvedValueOnce(resolutionOf(appA, tasksUse, [tasksUse], "frame-a"))
      .mockReturnValueOnce(pendingB.promise);

    const { router, wrapper } = await mountRoute(tasksUse.path);
    await flushPromises();
    mountedHosts.find((host) => host.key === "frame:frame-a")!.emitSurfaceReady(true);
    mountedHosts.find((host) => host.key === "use-tasks")!.emitSurfaceReady(true);
    await nextTick();
    expect(wrapper.find('[data-frame-panel="frame-a"]').exists()).toBe(true);

    // Switch to another framed application: old frame and content vanish immediately while the new frame loads in
    // parallel with resolve-entry behind the loading placeholder.
    await router.push(appBUse.path);
    await nextTick();

    expect(wrapper.find('[data-frame-panel="frame-a"]').exists()).toBe(false);
    expect(wrapper.find('[data-content-use="use-tasks"]').exists()).toBe(false);
    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(true);
    expect(mountedHosts.some((host) => host.key === "frame:frame-b")).toBe(true);

    pendingB.resolve(resolutionOf(appB, appBUse, [appBUse], "frame-b"));
    await flushPromises();
    mountedHosts.find((host) => host.key === "frame:frame-b")!.emitSurfaceReady(true);
    mountedHosts.find((host) => host.key === "use-b-home")!.emitSurfaceReady(true);
    await nextTick();

    expect(wrapper.find("[data-panel-loading-placeholder]").exists()).toBe(false);
    expect(wrapper.get('[data-frame-panel="frame-b"]').attributes("data-frame-app")).toBe(appB);
    expect(wrapper.get('[data-frame-panel="frame-b"]').attributes("data-current-entry-id")).toBe(appBUse.id);
    wrapper.unmount();
  });

  it("refreshes the entry table on visibility return, 5-minute interval, and 403 read denial, revoking the page when access is withdrawn", async () => {
    vi.useFakeTimers();
    catalogApplications.value = [{ id: appA, panelUses: [tasksUse, summaryUse] }];
    resolveApplicationEntryMock
      .mockResolvedValueOnce(resolutionOf(appA, tasksUse, [tasksUse, summaryUse]))
      .mockResolvedValueOnce(resolutionOf(appA, tasksUse, [tasksUse, summaryUse]))
      .mockResolvedValueOnce(resolutionOf(appA, tasksUse, [tasksUse, summaryUse]))
      .mockRejectedValueOnce(new Error("Forbidden"));

    const { wrapper } = await mountRoute(tasksUse.path);
    await flushPromises();
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-content-use="use-tasks"]').exists()).toBe(true);

    // 1. Visibility return refreshes the current application's entry table without fetching the full catalog.
    for (const listener of visibilityListeners) listener(true);
    await flushPromises();
    expect(refreshApplicationMock).toHaveBeenCalledTimes(1);
    expect(refreshApplicationMock).toHaveBeenLastCalledWith(appA);
    expect(catalogRefreshMock).not.toHaveBeenCalled();
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(2);

    // 2. Periodic 5-minute timer refreshes when visible, and skips when hidden.
    isDocVisible = false;
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flushPromises();
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(2);

    isDocVisible = true;
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flushPromises();
    expect(refreshApplicationMock).toHaveBeenCalledTimes(2);
    expect(refreshApplicationMock).toHaveBeenLastCalledWith(appA);
    expect(catalogRefreshMock).not.toHaveBeenCalled();
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(3);

    // 3. HTTP 403 read denial triggers immediate refresh and revokes the page when access was removed.
    for (const listener of readDeniedListeners) listener();
    await flushPromises();
    expect(refreshApplicationMock).toHaveBeenCalledTimes(3);
    expect(refreshApplicationMock).toHaveBeenLastCalledWith(appA);
    expect(catalogRefreshMock).not.toHaveBeenCalled();
    expect(resolveApplicationEntryMock).toHaveBeenCalledTimes(4);
    expect(wrapper.find('[data-content-use="use-tasks"]').exists()).toBe(false);
    expect(wrapper.get("[role=alert]").text()).toBe(`${tasksUse.path} is not a panel of this application`);
    wrapper.unmount();
  });
});
