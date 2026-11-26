import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, inject, nextTick, ref, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { pagePaneElementKey } from "@ontomato/agent-shell-ui";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";

/*
 * The page of a panel application (design 10.3, fourth check): a selection the panel reports is written into the page's
 * address without rebuilding the panel, a reload restores that view, and the same page beside the conversation writes
 * reports the address to the display controller.
 *
 * The mistakes these catch: keying the instance by the whole address, so writing the state replaces the key, rebuilds
 * the frame and drops the selection; and reading the address back into the instance, which turns its own report into a
 * loop.
 */

const uses: ApplicationPanelUse[] = [
  { id: "use-tasks", panelId: "panel-tasks", path: "/applications/app-a/tasks", pageKey: "panels-trial-a-tasks", },
  { id: "use-summary", panelId: "panel-summary", path: "/applications/app-a/summary", pageKey: "panels-trial-a-summary", },
];

/** Every panel instance the route mounted, and the address each last reported. */
const mountedInstances: {
  useId: string;
  address: ReturnType<typeof ref<string>>;
  initial: Record<string, unknown>;
  overlayContainer: Readonly<Ref<HTMLElement | null>> | null;
}[] = [];
let framePanelId: string | undefined;
const readFrameManifest = vi.fn();

import { useApplicationCatalog } from "../catalog";

vi.mock("../panel-host", () => ({
  // Java's resolve-entry, answered from the test's use relations: the one at the asked address, with the menu.
  resolveApplicationEntry: async ({ path }: { path: string }) => {
    const use = uses.find((candidate) => candidate.path.replace(/^#/, "") === path || candidate.path === path);
    if (!use) throw new Error(`No entry at ${path}`);
    return { applicationId: path.split("/")[2], use, framePanelId, menu: { singleEntry: uses.length <= 1, groups: [], panelUses: uses } };
  },
  readApplicationFrameManifest: readFrameManifest,
  // The host the route builds is the one for the use relation its address names.
  platformPanelHost: (_applicationId: string, use: ApplicationPanelUse) => ({ use }),
  onPanelReadDenied: () => () => {},
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/platform-shell")>();
  return {
    ...actual,
    // Stands in for the frame: it reports an address the way a panel's own state report does.
    PanelHost: defineComponent({
      props: { port: { type: Object, required: true }, address: { type: String, required: true }, initial: { type: Object, default: () => ({}) }, label: { type: String, default: "" }, labels: Object, frameState: Object },
      emits: ["display-address", "display-loaded", "display-dirty"],
      setup(props, { emit }) {
        const address = ref(props.address);
        const useId = (props.port as { use: ApplicationPanelUse }).use.id;
        const overlayContainer = inject(actual.panelOverlayContainerKey, null);
        mountedInstances.push({ useId, address, initial: props.initial, overlayContainer });
        return () =>
          h("div", { "data-use": useId, "data-term": props.frameState?.term }, [
            h("button", { "data-select": "task-2", onClick: () => {
              const address = `${props.address}?selectedTask=task-2`;
              emit("display-address", { kind: "state", address });
              emit("display-loaded", { status: "ready" });
              emit("display-dirty", true);
            } }),
          ]);
      },
    }),
  };
});

const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: publicEn }, elementLocale: () => elementEn,
  });
});

beforeEach(() => {
  mountedInstances.length = 0;
  framePanelId = undefined;
  readFrameManifest.mockReset();
});

async function mountAt(path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        // The page's address names the application and the use relation, as the platform's own route table does.
        props: (route) => ({ ...props, applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router, workbenchI18n()] } });
  await flushPromises();
  return { router, wrapper };
}

describe("a panel application's page", () => {
  it("writes a selection into the address without rebuilding the instance", async () => {
    const { router, wrapper } = await mountAt("/applications/app-a/tasks");
    expect(mountedInstances.map((one) => one.useId)).toEqual(["use-tasks"]);

    await wrapper.get("[data-select]").trigger("click");
    await flushPromises();
    // The address carries the selection …
    expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({
      selectedTask: "task-2",
    });
    // … and the instance is the same one: the reader's selection in the panel survived the write.
    expect(mountedInstances).toHaveLength(1);
  });

  it("opens the application's first use at the application's own address", async () => {
    // The shell's navigation catalogue lists the reader's entries: the application's own address opens the first.
    useApplicationCatalog().applications.value = [{ id: "app-a", panelUses: uses } as never];
    await mountAt("/applications/app-a");
    useApplicationCatalog().applications.value = [];
    expect(mountedInstances.map((one) => one.useId)).toEqual(["use-tasks"]);
  });

  it("restores the view from the address on reload", async () => {
    const { router } = await mountAt("/applications/app-a/tasks?selectedTask=task-2");
    expect(router.currentRoute.value.path).toBe("/applications/app-a/tasks");
    // The instance starts from what the address named.
    expect(mountedInstances[0]!.initial).toEqual({ selectedTask: "task-2" });
  });

  it("keeps one instance per application and use relation, across addresses of the same page", async () => {
    const { router, wrapper } = await mountAt("/applications/app-a/tasks");
    await router.replace("/applications/app-a/tasks?selectedTask=task-2");
    await flushPromises();
    expect(mountedInstances).toHaveLength(1);
    // The state read once is the one the page opened at, not the one just written.
    expect(mountedInstances[0]!.initial).toEqual({});

    // The other relation is another page, and another panel.
    await router.replace("/applications/app-a/summary");
    await flushPromises();
    expect(mountedInstances.map((one) => one.useId)).toEqual(["use-tasks", "use-summary"]);
    wrapper.unmount();
  });

  it("says, in the platform's language, that an address names no panel of the application", async () => {
    const { wrapper } = await mountAt("/applications/app-a/reports");
    expect(wrapper.get("[role=alert]").text()).toBe("/applications/app-a/reports is not a panel of this application");
    expect(mountedInstances).toEqual([]);
    wrapper.unmount();
  });

  it("beside the conversation, consumes the three listeners and reports state without navigating", async () => {
    const navigate = vi.fn();
    const onDisplayAddress = vi.fn();
    const onDisplayLoaded = vi.fn();
    const onDisplayDirty = vi.fn();
    const page = "/applications/app-a/tasks";
    const { router, wrapper } = await mountAt(page, { navigate, onDisplayAddress, onDisplayLoaded, onDisplayDirty });
    const route = wrapper.getComponent(PanelApplicationRoute);
    for (const listener of ["onDisplayAddress", "onDisplayLoaded", "onDisplayDirty"]) {
      expect(route.vm.$attrs).not.toHaveProperty(listener);
    }
    await wrapper.get("[data-select]").trigger("click");
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(onDisplayAddress.mock.calls).toEqual([[{
      kind: "state",
      address: `${page}?selectedTask=task-2`,
    }]]);
    expect(panelAddressState(onDisplayAddress.mock.calls[0]![0].address)).toEqual({
      selectedTask: "task-2",
    });
    expect(onDisplayLoaded).toHaveBeenLastCalledWith({ status: "ready" });
    expect(onDisplayDirty.mock.calls).toEqual([[true]]);
    expect(route.emitted("display-address")).toEqual(onDisplayAddress.mock.calls);
    expect(route.emitted("display-loaded")).toEqual(onDisplayLoaded.mock.calls);
    expect(route.emitted("display-dirty")).toEqual(onDisplayDirty.mock.calls);
    expect(router.currentRoute.value.fullPath).toBe(page);
    expect(mountedInstances).toHaveLength(1);
    wrapper.unmount();
  });

  it("clears the previous frame default if the next entry cannot read the frame beside a conversation", async () => {
    framePanelId = "term-frame";
    readFrameManifest
      .mockResolvedValueOnce({ state: { term: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "fall" } } })
      .mockRejectedValueOnce(new Error("Frame snapshot unavailable"));

    const { router, wrapper } = await mountAt("/applications/app-a/tasks", { navigate: vi.fn() });
    expect(wrapper.get('[data-use="use-tasks"]').attributes("data-term")).toBe("fall");

    await router.push("/applications/app-a/summary");
    await flushPromises();
    expect(wrapper.get('[data-use="use-summary"]').attributes("data-term")).toBeUndefined();
    wrapper.unmount();
  });

  it("anchors side-pane overlays to the persistent page pane across keyed route remounts, falling back to area without one", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/agents/chat", component: { template: "<div />" } }],
    });
    await router.push("/agents/chat");
    await router.isReady();

    const paneEl = document.createElement("section");
    document.body.append(paneEl);
    const paneRef = ref<HTMLElement | null>(paneEl);
    const currentPath = ref("/applications/app-a/tasks");

    const wrapper = mount(defineComponent({
      setup() {
        return () => h(PanelApplicationRoute, {
          key: currentPath.value,
          applicationId: "app-a",
          address: currentPath.value,
          navigate: vi.fn(),
        });
      },
    }), {
      global: {
        plugins: [router, workbenchI18n()],
        provide: { [pagePaneElementKey as symbol]: paneRef },
      },
    });
    await flushPromises();
    expect(mountedInstances[0]!.overlayContainer?.value).toBe(paneEl);

    // A toast appended to the overlay container survives when cross-panel navigation remounts PanelApplicationRoute.
    const toast = document.createElement("div");
    toast.className = "el-message";
    toast.textContent = "Deleted";
    mountedInstances[0]!.overlayContainer!.value!.append(toast);

    currentPath.value = "/applications/app-a/summary";
    await nextTick();
    await flushPromises();
    expect(mountedInstances).toHaveLength(2);
    expect(mountedInstances[1]!.overlayContainer?.value).toBe(paneEl);
    expect(toast.isConnected).toBe(true);
    expect(toast.parentElement).toBe(paneEl);
    wrapper.unmount();
    paneEl.remove();

    // Without a surrounding ShellPagePane (e.g. an editor drawer), overlays fall back to the route's own area element.
    mountedInstances.length = 0;
    const standaloneSide = mount(PanelApplicationRoute, {
      props: { applicationId: "app-a", address: "/applications/app-a/tasks", navigate: vi.fn() },
      global: { plugins: [router, workbenchI18n()] },
    });
    await flushPromises();
    expect(mountedInstances[0]!.overlayContainer?.value).toBe(standaloneSide.element);
    standaloneSide.unmount();
  });
});
