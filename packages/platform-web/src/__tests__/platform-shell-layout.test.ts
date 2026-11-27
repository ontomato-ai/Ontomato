import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import { providePlatformHost } from "@ontomato/platform-admin";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import PlatformShellLayout from "../PlatformShellLayout.vue";
import { HOME_PREFERENCES_CHANGED } from "../features/home/api";

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

const catalogApps = ([
  { id: "application-gallery", kind: "native", path: "/applications", label: "Gallery" },
  { id: "app-a", kind: "connected", path: "/applications/app-a", label: "Sales" },
  { id: "app-b", kind: "connected", path: "/applications/app-b", label: "Inventory" },
] as const).map(({ id, kind, path, label }, sort): CatalogApplication => ({
  id, kind, names: { en: label }, descriptions: {},
  ownerService: "workbench", icon: "pages", rail: "top", category: "business", sort,
  entry: { path, renderer: kind === "native" ? "application-gallery" : undefined },
  scheduleAdapter: null, releaseId: null, entryPaths: [], panelUses: [],
}));

const shortcutsSection = '.rail-section[data-section="top"]';
const retry = `${shortcutsSection} button[aria-label*="${publicEn.common.retry}"]`;
const sales = 'button[title="Sales"]';

async function mountShell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["/home", "/agents/chat", "/ontology/objects", "/settings/general", "/applications"].map((path) => ({
      path, component: { render: () => h("div", { "data-page": path }) },
    })),
  });
  await router.push("/home");
  const host = {
    access: { ready: true, error: null, canEnter: () => true, verifyEntry: async () => "allowed", load: async () => {} },
    navigation: computed(() => ({ groups: [], pages: [] })),
    account: null,
    preferences: {
      locales: ["en"], locale: ref("en"), setLocale: () => {}, theme: ref<"light" | "dark">("light"), setTheme: () => {},
    },
    blocked: computed(() => null),
  };
  const wrapper = mount(PlatformShellLayout, {
    attachTo: document.body,
    props: { renderers: { "application-gallery": { sections: [] } } },
    global: {
      plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })],
      provide: providePlatformHost(host as never),
    },
  });
  await flushPromises();
  return { wrapper, router, shortcuts: () => wrapper.get(shortcutsSection) };
}

describe("PlatformShellLayout home shortcuts refresh", () => {
  const failureReason = "Home preferences store is unavailable";
  let homeRequests: string[] = [];
  let favoriteIds: string[] = [];
  let homeFails = false;

  beforeEach(() => {
    homeRequests = [];
    favoriteIds = ["app-a"];
    homeFails = false;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/platform/home") {
        homeRequests.push(url.pathname + url.search);
        if (homeFails) return Response.json({ error: { message: failureReason } }, { status: 500 });
        return Response.json({
          favorites: favoriteIds.map((id) => ({ kind: "application", id })),
          dashboardIds: [],
          recentApplications: [],
          recentConversations: [],
        });
      }
      if (url.pathname === "/api/data-query/platform/applications") {
        return Response.json({ success: true, data: catalogApps });
      }
      if (url.pathname === "/api/platform/home/applications/application-gallery/open") {
        return Response.json({ applicationId: "application-gallery", lastOpenedAt: "2026-11-27T00:00:00Z" });
      }
      return Response.json({});
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an initial read failure where shortcuts belong and retries without blocking navigation", async () => {
    homeFails = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { wrapper, router, shortcuts } = await mountShell();
    try {
      expect(wrapper.find('[data-page="/home"]').exists()).toBe(true);
      const retryButton = wrapper.get(retry);
      expect(retryButton.find("svg").exists()).toBe(true);
      await retryButton.trigger("mouseenter");
      await vi.waitFor(() => {
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(failureReason);
      });

      await shortcuts().get('button[title="Gallery"]').trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.path).toBe("/applications");

      homeFails = false;
      await wrapper.get(retry).trigger("click");
      await flushPromises();
      expect(homeRequests).toHaveLength(2);
      expect(wrapper.find(retry).exists()).toBe(false);
      expect(shortcuts().find(sales).exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it("reads /api/platform/home on mount and HOME_PREFERENCES_CHANGED without re-fetching on route changes", async () => {
    const { wrapper, router, shortcuts } = await mountShell();
    try {
      expect(homeRequests).toEqual(["/api/platform/home"]);
      expect(shortcuts().find(sales).exists()).toBe(true);

      // Routine route changes must not re-fetch /api/platform/home.
      await router.push("/agents/chat");
      await flushPromises();
      await router.push("/ontology/objects");
      await flushPromises();
      await router.push("/settings/general");
      await flushPromises();
      await router.push("/home");
      await flushPromises();
      expect(homeRequests).toEqual(["/api/platform/home"]);

      // Explicit shortcut preference changes still refresh pinned applications.
      favoriteIds = ["app-a", "app-b"];
      window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
      await flushPromises();
      expect(homeRequests).toHaveLength(2);
      expect(shortcuts().find('button[title="Inventory"]').exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }

    // Listener is removed on unmount.
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
    await flushPromises();
    expect(homeRequests).toHaveLength(2);
  });

  it.each([
    { state: "pinned", favorites: ["app-a"] },
    { state: "empty", favorites: [] },
  ])("keeps the last successful shortcuts when a refresh fails ($state)", async ({ favorites }) => {
    favoriteIds = favorites;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { wrapper, shortcuts } = await mountShell();
    try {
      homeFails = true;
      window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
      await flushPromises();
      expect(homeRequests).toHaveLength(2);
      expect(wrapper.find(retry).exists()).toBe(false);
      expect(shortcuts().find(sales).exists()).toBe(favorites.length > 0);
    } finally {
      wrapper.unmount();
    }
  });
});
