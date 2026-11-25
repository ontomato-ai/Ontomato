import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";
import { useApplicationCatalog } from "../catalog";
import { platformLayoutRoute } from "../layout-route";
import { servePanelEntries } from "../panel-entries";
import { HOME_PREFERENCES_CHANGED } from "../features/home/api";

const homeUse: ApplicationPanelUse = {
  id: "home",
  pageKey: "home",
  panelId: "builtin-product-personal-workspace",
  path: "/home",
  access: { kind: "domain-member" },
  pageComposer: "none",
};

const mountedPanels: { useId: string; panelId: string; pageComposer?: string }[] = [];
const readHomePanelMock = vi.fn<[], Promise<{ panel: ProductPanel | null }>>();
const saveHomePanelMock = vi.fn<[string | null], Promise<{ homePanelId: string | null }>>();

vi.mock("../features/home/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/home/api")>()),
  readHomePanel: () => readHomePanelMock(),
  saveHomePanel: (homePanelId: string | null) => saveHomePanelMock(homePanelId),
}));

vi.mock("../panel-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../panel-host")>();
  return {
    ...actual,
    resolveApplicationEntry: async () => ({
      applicationId: "home",
      use: homeUse,
      menu: { singleEntry: true, groups: [], panelUses: [homeUse] },
    }),
    readApplicationFrameManifest: vi.fn(),
    platformPanelHost: (_applicationId: string, use: ApplicationPanelUse) => ({ use }),
    onPanelReadDenied: () => () => {},
  };
});

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  PanelHost: defineComponent({
    props: { port: { type: Object, required: true }, address: { type: String, required: true } },
    setup(props) {
      const use = (props.port as { use: ApplicationPanelUse }).use;
      mountedPanels.push({ useId: use.id, panelId: use.panelId, pageComposer: use.pageComposer });
      return () => h("div", { "data-testid": "mock-panel-host", "data-panel-id": use.panelId, "data-page-composer": use.pageComposer ?? "bottom" });
    },
  }),
}));

const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

function fakePanel(id: string, inlineComposer: boolean): ProductPanel {
  return {
    id,
    name: id,
    revision: 1,
    manifest: {
      state: {},
      members: inlineComposer
        ? {
            askInline: {
              component: "ConversationEntry",
              config: { presentation: "inline" },
            } as never,
          }
        : {},
    },
    content: {
      html: inlineComposer ? '<div id="app"><projection slot="askInline" presentation="inline"></projection></div>' : '<div id="app"></div>',
      module: "export default {};",
    },
  } as unknown as ProductPanel;
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
  mountedPanels.length = 0;
  readHomePanelMock.mockReset();
  saveHomePanelMock.mockReset();
});

async function mountHomeRoute() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        ...platformRoutes.home,
        component: PanelApplicationRoute,
        props: { applicationId: "home" },
        meta: { workbench: true, ownHeader: true },
      },
      { path: "/workspace", redirect: { name: platformRoutes.home.name } },
    ],
  });
  await router.push("/home");
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [router, workbenchI18n()] },
  });
  await flushPromises();
  return { router, wrapper };
}

describe("personal workspace /home cutover and custom home panel lifecycle", () => {
  it("routes /home to PanelApplicationRoute with applicationId 'home' and keeps /workspace redirecting to /home", async () => {
    const layout = platformLayoutRoute([]);
    const homeChild = layout.children?.find((child) => child.name === platformRoutes.home.name);
    expect(homeChild).toBeDefined();
    expect(homeChild?.path).toBe("/home");
    expect(homeChild?.props).toEqual({ applicationId: "home" });
    expect(homeChild?.meta).toMatchObject({ workbench: true, ownHeader: true });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          ...platformRoutes.layout,
          component: { render: () => null },
          children: [
            { ...platformRoutes.home, component: { render: () => null } },
            { path: "/workspace", redirect: { name: platformRoutes.home.name } },
          ],
        },
      ],
    });
    useApplicationCatalog().applications.value = [{
      id: "home",
      kind: "native",
      entry: { path: "/home", renderer: "home", home: "/home" },
      panelUses: [homeUse],
    } as never];
    servePanelEntries(router);
    const homeMatches = router.getRoutes().filter((record) => record.path === "/home");
    expect(homeMatches).toHaveLength(1);
    expect(homeMatches[0]?.name).toBe(platformRoutes.home.name);

    await router.push("/workspace");
    expect(router.currentRoute.value.path).toBe("/home");
  });

  it("mounts default builtin-product-personal-workspace and switches reactively on HOME_PREFERENCES_CHANGED", async () => {
    readHomePanelMock.mockResolvedValueOnce({ panel: null });
    const { wrapper } = await mountHomeRoute();
    expect(mountedPanels).toEqual([
      { useId: "home", panelId: "builtin-product-personal-workspace", pageComposer: "none" },
    ]);

    // Switch to a custom home panel WITHOUT an inline composer -> should enable bottom pageComposer.
    readHomePanelMock.mockResolvedValueOnce({ panel: fakePanel("user-custom-plain", false) });
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
    await flushPromises();
    expect(mountedPanels).toHaveLength(2);
    expect(mountedPanels[1]).toEqual({
      useId: "home",
      panelId: "user-custom-plain",
      pageComposer: "bottom",
    });
    expect(wrapper.get("[data-testid='mock-panel-host']").attributes("data-panel-id")).toBe("user-custom-plain");

    // Switch to a custom home panel WITH an inline ConversationEntry -> should keep pageComposer: "none".
    readHomePanelMock.mockResolvedValueOnce({ panel: fakePanel("user-custom-inline", true) });
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
    await flushPromises();
    expect(mountedPanels).toHaveLength(3);
    expect(mountedPanels[2]).toEqual({
      useId: "home",
      panelId: "user-custom-inline",
      pageComposer: "none",
    });
  });

  it("shows recovery banner when custom home panel is unavailable and restores default workspace on click", async () => {
    readHomePanelMock.mockRejectedValueOnce(new Error("403 Forbidden"));
    saveHomePanelMock.mockImplementationOnce(async (homePanelId) => {
      expect(homePanelId).toBeNull();
      return { homePanelId: null };
    });
    readHomePanelMock.mockResolvedValueOnce({ panel: null });

    const { wrapper } = await mountHomeRoute();
    expect(wrapper.find("[data-testid='custom-home-unavailable']").exists()).toBe(true);
    expect(mountedPanels).toHaveLength(0);

    await wrapper.get("[data-testid='restore-default-home-btn']").trigger("click");
    await flushPromises();

    expect(saveHomePanelMock).toHaveBeenCalledWith(null);
    expect(wrapper.find("[data-testid='custom-home-unavailable']").exists()).toBe(false);
    expect(mountedPanels).toEqual([
      { useId: "home", panelId: "builtin-product-personal-workspace", pageComposer: "none" },
    ]);
  });
});
