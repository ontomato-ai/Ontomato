import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { providePlatformHost } from "@ontomato/platform-admin";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { HOME_PREFERENCES_CHANGED } from "../features/home/api";

const mockRailVisible = ref(true);

vi.mock("../PlatformLayout.vue", () => ({
  default: defineComponent({
    name: "PlatformLayoutDouble",
    props: {
      pinnedAppIds: { type: Array as () => string[], default: () => [] },
    },
    emits: ["railVisible"],
    setup(props, { emit }) {
      emit("railVisible", mockRailVisible.value);
      return () => h("div", { class: "platform-layout-double", "data-pinned": props.pinnedAppIds.join(",") });
    },
  }),
}));

const PlatformShellLayout = (await import("../PlatformShellLayout.vue")).default;

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

describe("PlatformShellLayout home shortcuts refresh", () => {
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
        if (homeFails) return Response.json({ error: { message: "home unavailable" } }, { status: 500 });
        return Response.json({
          favorites: favoriteIds.map((id) => ({ kind: "application", id })),
          dashboardIds: [],
          recentApplications: [],
          recentConversations: [],
        });
      }
      if (url.pathname === "/api/data-query/platform/applications") {
        return Response.json({ success: true, data: [] });
      }
      return Response.json({});
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });



  it("reports a shortcut read failure without blocking platform startup", async () => {
    homeFails = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/home", component: { render: () => h("div", "home") } }],
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
      global: {
        plugins: [router, createI18n({ legacy: false, locale: "en", missingWarn: false })],
        provide: providePlatformHost(host as never),
      },
    });
    try {
      await flushPromises();
      expect(wrapper.get(".platform-layout-double").attributes("data-pinned")).toBe("");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it("reads /api/platform/home on mount and HOME_PREFERENCES_CHANGED without re-fetching on route changes", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/home", component: { render: () => h("div", "home") } },
        { path: "/agents/chat", component: { render: () => h("div", "chat") } },
        { path: "/ontology/objects", component: { render: () => h("div", "objects") } },
        { path: "/settings/general", component: { render: () => h("div", "settings") } },
      ],
    });
    await router.push("/home");

    const host = {
      access: { ready: true, error: null, canEnter: () => true, verifyEntry: async () => "allowed", load: async () => {} },
      navigation: computed(() => ({ groups: [], pages: [] })),
      account: { userName: "Ada", signOut: () => {} },
      preferences: {
        locales: ["en"],
        locale: ref("en"),
        setLocale: () => {},
        theme: ref<"light" | "dark">("light"),
        setTheme: () => {},
      },
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
      expect(homeRequests).toEqual(["/api/platform/home"]);
      expect(wrapper.get(".platform-layout-double").attributes("data-pinned")).toBe("app-a");

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
      expect(wrapper.get(".platform-layout-double").attributes("data-pinned")).toBe("app-a,app-b");
    } finally {
      wrapper.unmount();
    }

    // Listener is removed on unmount.
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
    await flushPromises();
    expect(homeRequests).toHaveLength(2);
  });
});
