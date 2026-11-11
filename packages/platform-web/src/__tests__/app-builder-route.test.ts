import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { mount } from "@vue/test-utils";
import en from "element-plus/es/locale/lang/en";
import type { BuiltinApplication } from "@ontomato/contracts/platform-identity";
import { providePlatformHost, type PlatformPage } from "@ontomato/platform-admin";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { AppBuilderPlatform } from "@ontomato/workbench-ui/features/app-builder";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { openApplicationKey } from "../apps";
import { useApplicationCatalog } from "../catalog";
import { catalogFixture } from "./fixtures";

/*
 * The builder's publication drawer leads a reader to permission management exactly when the rail does: when the catalog
 * the rail draws lists the application that holds the page. On the builder's page the platform has not read the reader's
 * permission codes (only a platform page's guard reads them), so they cannot be what decides; an administrator who can
 * open permission management from the rail must get the link.
 */
const handed = vi.hoisted(() => ({ platform: null as AppBuilderPlatform | null }));
vi.mock("@ontomato/workbench-ui/features/app-builder", async () => {
  const { defineComponent } = await import("vue");
  return {
    AppBuilder: defineComponent({
      props: { platform: { type: Object, required: true } },
      setup(props) {
        handed.platform = props.platform as AppBuilderPlatform;
        return () => null;
      },
    }),
  };
});
const AppBuilderRoute = (await import("../pages/AppBuilderRoute.vue")).default;

installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});
installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en: publicEn }, elementLocale: () => en,
});

/** An edition's permission management: its page in the platform's navigation and the application that holds it. */
const PERMISSIONS_PAGE: PlatformPage = {
  path: platformRoutes.permissions.path,
  titleKey: "nav.permissionCenter",
  permissions: ["user-management", "role-management", "position-management"],
  group: "platform",
};
const PERMISSIONS_APP: BuiltinApplication = {
  id: "permissions", kind: "native", rail: "bottom", category: "admin", sort: 10,
  entry: { path: platformRoutes.permissions.path, renderer: "permissions" },
  entryAccess: ["user-management", "role-management", "position-management"], scheduleAdapter: null,
  declaration: { names: { en: "Permissions" }, descriptions: {}, icon: "permissions", groups: [], permissions: [] },
};

let catalog: unknown = [];
beforeEach(() => {
  handed.platform = null;
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ success: true, data: catalog }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the builder is handed on a page whose navigation holds `pages`, with the rail listing `applications` as well. */
async function builderPlatform(pages: PlatformPage[], applications: BuiltinApplication[]) {
  catalog = catalogFixture(applications);
  await useApplicationCatalog().refresh();
  const host = {
    // The builder's page is not a platform page: no guard has read the reader's codes, so none counts yet.
    access: { ready: false, error: null, can: () => false, load: async () => {} },
    navigation: computed(() => ({ groups: [], pages })),
  };
  mount(AppBuilderRoute, {
    global: { provide: { ...providePlatformHost(host as never), [openApplicationKey as symbol]: () => {} } },
  });
  return handed.platform!;
}

describe("the app builder's way to permission management", () => {
  it("is a link when the rail lists permission management", async () => {
    const platform = await builderPlatform([PERMISSIONS_PAGE], [PERMISSIONS_APP]);
    expect(platform.permissions.value).toEqual({ path: platformRoutes.permissions.path, open: true });
  });

  it("is to ask an administrator when the rail does not list it", async () => {
    const platform = await builderPlatform([PERMISSIONS_PAGE], []);
    expect(platform.permissions.value).toEqual({ path: platformRoutes.permissions.path, open: false });
  });

  it("is not there in an edition without permission management", async () => {
    const platform = await builderPlatform([], [PERMISSIONS_APP]);
    expect(platform.permissions.value).toBeNull();
  });
});
