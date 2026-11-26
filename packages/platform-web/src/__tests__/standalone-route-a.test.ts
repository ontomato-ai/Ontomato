import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, inject, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter, RouterView, useRoute } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { providePlatformHost, type PlatformNavigation } from "@ontomato/platform-admin";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import PlatformShellLayout from "../PlatformShellLayout.vue";
import ApplicationEntryRoute from "../pages/ApplicationEntryRoute.vue";
import { applicationFrameHostKey } from "../application-frame-context";
import { resetApplicationCatalog, useApplicationCatalog } from "../catalog";
import { panelEntryGuard, unknownAddressRoute } from "../panel-entries";
import { resolveApplicationEntry } from "../panel-host";
import { catalogFixture } from "./fixtures";

vi.mock("../pages/PanelApplicationRoute.vue", () => ({
  default: defineComponent({
    name: "PanelApplicationRouteStub",
    props: { applicationId: { type: String, required: true } },
    setup(props) {
      const route = useRoute();
      const outerFrame = inject(applicationFrameHostKey, null);
      void resolveApplicationEntry({ path: route.path }).then((opened) => {
        outerFrame?.reportOpenedEntry(route.path, opened);
      });
      return () => h("div", { class: "panel-route-stub", "data-app": props.applicationId });
    },
  }),
}));

vi.mock("../ApplicationFrameHost.vue", () => ({
  default: defineComponent({
    name: "ApplicationFrameHostStub",
    props: {
      frame: { type: Object, default: null },
      openedEntry: { type: Object, default: null },
      blocked: { type: Boolean, default: false },
    },
    emits: ["opened-entry"],
    setup(props, { slots, emit }) {
      provide(applicationFrameHostKey, {
        reportOpenedEntry: (path: string, entry: unknown) => emit("opened-entry", path, entry),
        beginOpen: () => () => {},
      } as never);
      return () => {
        const framePanelId = props.frame?.framePanelId ?? props.openedEntry?.framePanelId ?? "";
        return h("div", { class: "frame-host-stub", "data-frame": framePanelId }, slots.default?.());
      };
    },
  }),
}));

installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});
installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});

function panelAppRecord(id: string, allowStandalone: boolean) {
  return {
    id,
    kind: "product" as const,
    rail: "apps" as const,
    category: "business" as const,
    sort: 10,
    names: { en: id },
    descriptions: {},
    icon: "pages",
    ownerService: "workbench",
    entryPaths: [`/applications/${id}/main`],
    entry: { path: `/applications/${id}`, renderer: "panels" },
    scheduleAdapter: null,
    releaseId: null,
    groups: [],
    allowStandalone,
    framePanelId: "builtin-product-platform-frame",
    panelUses: [{
      id: `${id}-main`,
      pageKey: `${id}-main`,
      panelId: `panel-${id}-main`,
      path: `/applications/${id}/main`,
      names: { en: "Main" },
    }],
  };
}

describe("Route A standalone opening and rail-driven fetching", () => {
  beforeEach(() => {
    resetApplicationCatalog();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    resetApplicationCatalog();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("opens an allowed standalone panel application using only application-entry without rail fetches or rail flash", async () => {
    const requests: string[] = [];
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const appOpen = panelAppRecord("app-open", true);

    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        await openGate;
        return Response.json({
          applicationId: "app-open",
          use: appOpen.panelUses[0],
          framePanelId: appOpen.framePanelId,
          allowStandalone: true,
          frame: null,
          content: null,
          menu: { singleEntry: true, names: appOpen.names, groups: [], panelUses: appOpen.panelUses },
        });
      }
      if (url.pathname === "/api/platform/home/applications/app-open/open") {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    });

    const loadAccess = vi.fn(async () => {});
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        ...platformRoutes.layout,
        component: RouterView,
        children: [{
          path: "/applications/:applicationId/:panelPath(.*)?",
          component: ApplicationEntryRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId), panelPath: String(route.params.panelPath ?? "") }),
        }],
      }],
    });
    await router.push("/applications/app-open/main?standalone=1");

    const host = {
      access: { ready: true, error: null, canEnter: () => true, verifyEntry: async () => "allowed", load: loadAccess },
      navigation: computed<PlatformNavigation>(() => ({ groups: [], pages: [] })),
      account: { userName: "Ada", signOut: () => {} },
      preferences: { locales: ["en"], locale: ref("en"), setLocale: () => {}, theme: ref<"light" | "dark">("light"), setTheme: () => {} },
      blocked: computed(() => null),
    };

    const wrapper = mount(PlatformShellLayout, {
      global: {
        plugins: [router, createI18n({ legacy: false, locale: "en", missingWarn: false })],
        provide: providePlatformHost(host as never),
      },
    });
    try {
      await flushPromises();
      // During loading: no rail skeleton, no sessionStorage write, no rail data fetches.
      expect(wrapper.find(".platform-rail").exists()).toBe(false);
      expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();
      expect(loadAccess).not.toHaveBeenCalled();
      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fapplications%2Fapp-open%2Fmain"]);

      releaseOpen();
      await flushPromises();

      // After opening resolves: still no rail, frame starts from opening response, sessionStorage persisted.
      expect(wrapper.find(".platform-rail").exists()).toBe(false);
      expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBe("1");
      expect(wrapper.get(".frame-host-stub").attributes("data-frame")).toBe("builtin-product-platform-frame");
      expect(loadAccess).not.toHaveBeenCalled();
      expect(requests.some((url) => url.includes("purpose=navigation"))).toBe(false);
      expect(requests.some((url) => url === "/api/platform/home")).toBe(false);
      expect(requests.some((url) => url.startsWith("/api/data-query/platform/applications/app-open"))).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("keeps the rail hidden while loading a standalone-disabled app, then reveals the rail and triggers rail fetches once allowStandalone: false arrives", async () => {
    const requests: string[] = [];
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const appLocked = panelAppRecord("app-locked", false);
    const { panelUses: _omitted, ...lockedSummary } = appLocked;

    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        await openGate;
        return Response.json({
          applicationId: "app-locked",
          use: appLocked.panelUses[0],
          framePanelId: appLocked.framePanelId,
          allowStandalone: false,
          frame: null,
          content: null,
          menu: { singleEntry: true, names: appLocked.names, groups: [], panelUses: appLocked.panelUses },
        });
      }
      if (url.pathname === "/api/data-query/platform/applications") {
        return Response.json({ success: true, data: [lockedSummary] });
      }
      if (url.pathname === "/api/platform/home") {
        return Response.json({ favorites: [], dashboardIds: [], recentApplications: [], recentConversations: [] });
      }
      return Response.json({});
    });

    const loadAccess = vi.fn(async () => {});
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        ...platformRoutes.layout,
        component: RouterView,
        children: [{
          path: "/applications/:applicationId/:panelPath(.*)?",
          component: ApplicationEntryRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId), panelPath: String(route.params.panelPath ?? "") }),
        }],
      }],
    });
    await router.push("/applications/app-locked/main?standalone=1");

    const host = {
      access: { ready: true, error: null, canEnter: () => true, verifyEntry: async () => "allowed", load: loadAccess },
      navigation: computed<PlatformNavigation>(() => ({ groups: [], pages: [] })),
      account: { userName: "Ada", signOut: () => {} },
      preferences: { locales: ["en"], locale: ref("en"), setLocale: () => {}, theme: ref<"light" | "dark">("light"), setTheme: () => {} },
      blocked: computed(() => null),
    };

    const wrapper = mount(PlatformShellLayout, {
      global: {
        plugins: [router, createI18n({ legacy: false, locale: "en", missingWarn: false })],
        provide: providePlatformHost(host as never),
      },
    });
    try {
      await flushPromises();
      expect(wrapper.find(".platform-rail").exists()).toBe(false);
      expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();
      expect(loadAccess).not.toHaveBeenCalled();
      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fapplications%2Fapp-locked%2Fmain"]);

      releaseOpen();
      await flushPromises();

      // Now allowStandalone: false is known: rail appears, standalone stripped, sessionStorage clean, and rail data loads once.
      expect(wrapper.find(".platform-rail").exists()).toBe(true);
      expect(router.currentRoute.value.query.standalone).toBeUndefined();
      expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();
      expect(loadAccess).toHaveBeenCalledTimes(1);
      expect(requests).toContain("/api/data-query/platform/applications?purpose=navigation");
      expect(requests).toContain("/api/platform/home");
      expect(requests.some((url) => url.startsWith("/api/data-query/platform/applications/app-locked"))).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("does not re-fetch the navigation catalog when host.navigation changes and computes agentBuilderShortcut from access", async () => {
    const requests: string[] = [];
    const summaries = catalogFixture().map(({ panelUses: _omitted, ...summary }) => summary);
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/data-query/platform/applications") {
        return Response.json({ success: true, data: summaries });
      }
      if (url.pathname === "/api/platform/home") {
        return Response.json({ favorites: [], dashboardIds: [], recentApplications: [], recentConversations: [] });
      }
      return Response.json({});
    });

    const nav = ref<PlatformNavigation>({ groups: [], pages: [] });
    const granted = ref<string[]>(["/agents/settings"]);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        ...platformRoutes.layout,
        component: RouterView,
        children: [{ path: "/agents/chat", component: { render: () => h("div", "chat") } }],
      }],
    });
    await router.push("/agents/chat");

    const host = {
      access: { ready: true, error: null, canEnter: (path: string) => granted.value.includes(path), verifyEntry: async () => "allowed", load: async () => {} },
      navigation: computed(() => nav.value),
      account: { userName: "Ada", signOut: () => {} },
      preferences: { locales: ["en"], locale: ref("en"), setLocale: () => {}, theme: ref<"light" | "dark">("light"), setTheme: () => {} },
      blocked: computed(() => null),
    };

    const wrapper = mount(PlatformShellLayout, {
      global: {
        plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en: publicEn }, missingWarn: false })],
        provide: providePlatformHost(host as never),
      },
    });
    const hasAgentBuilderRow = () =>
      wrapper.findAll(".rail-row").some((row) =>
        row.attributes("title") === publicEn.platform.agentBuilder || row.text().includes(publicEn.platform.agentBuilder),
      );
    try {
      await flushPromises();
      expect(requests.filter((url) => url.startsWith("/api/data-query/platform/applications"))).toHaveLength(1);
      expect(hasAgentBuilderRow()).toBe(true);

      // Mutating host.navigation must NOT re-trigger catalog.refresh().
      nav.value = { groups: [{ key: "g1", titleKey: "g1" }], pages: [] };
      await flushPromises();
      expect(requests.filter((url) => url.startsWith("/api/data-query/platform/applications"))).toHaveLength(1);

      // Revoking the settings entry hides the Agent Builder shortcut even without panelUses.
      granted.value = [];
      await flushPromises();
      expect(hasAgentBuilderRow()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("resolves a standalone built-in panel deep link via a single application-entry call without fetching the catalog or application detail", async () => {
    const requests: string[] = [];
    const ontology = catalogFixture().find((app) => app.id === "ontology")!;
    const objectsUse = ontology.panelUses!.find((use) => use.path === "/ontology/objects")!;

    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        return Response.json({
          applicationId: "ontology",
          use: objectsUse,
          framePanelId: ontology.framePanelId,
          allowStandalone: false,
          frame: null,
          content: null,
          menu: { singleEntry: false, names: ontology.names, groups: ontology.groups, panelUses: ontology.panelUses },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { ...platformRoutes.layout, component: RouterView, children: [] },
        unknownAddressRoute,
      ],
    });
    router.beforeEach(panelEntryGuard(router));

    await router.push("/ontology/objects?standalone=1");
    expect(router.currentRoute.value.path).toBe("/ontology/objects");
    expect(router.currentRoute.value.query.standalone).toBe("1");
    expect(requests).toEqual([
      "/api/product-panels/application-entry?path=%2Fontology%2Fobjects",
    ]);
  });

  it("lands a rootless built-in summary route (/settings) on its first visible entry via a single application-entry call", async () => {
    const requests: string[] = [];
    const full = catalogFixture();
    const settingsFull = full.find((app) => app.id === "settings")!;
    const usageUse = settingsFull.panelUses!.find((use) => use.path === "/settings/model-config/usage")!;
    const summaries = full.map(({ panelUses: _omitted, ...summary }) => summary);
    useApplicationCatalog().applications.value = summaries;
    useApplicationCatalog().loading.value = false;

    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        return Response.json({
          applicationId: "settings",
          use: usageUse,
          framePanelId: settingsFull.framePanelId,
          allowStandalone: false,
          frame: null,
          content: null,
          menu: { singleEntry: false, names: settingsFull.names, groups: settingsFull.groups, panelUses: settingsFull.panelUses },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { ...platformRoutes.layout, component: RouterView, children: [] },
        unknownAddressRoute,
      ],
    });
    router.beforeEach(panelEntryGuard(router));

    await router.push("/settings");
    expect(router.currentRoute.value.path).toBe("/settings/model-config/usage");
    expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fsettings"]);
  });
});
