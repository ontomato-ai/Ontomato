import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { RouterView, type RouteRecordRaw } from "vue-router";
import { installPageGuard } from "../router";
import { createMemoryHistory, createRouter } from "vue-router";
import { managerDestination } from "../legacy-manager";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { availableGroups, availablePages, openAccess, type PlatformAccess, type PlatformNavigation } from "../navigation";
import { formerParentRoutes, ossPlatformPages, pageRoutes, sharedPageRoutes } from "../pages";

/** The enterprise edition's licence page, as it declares it: the landing of a failed licence check. */
const licence = {
  path: platformRoutes.license.path,
  titleKey: "l",
  permissions: ["authorization-management"],
  group: "platform",
  enterableWithoutPermission: true,
};

const navigation: PlatformNavigation = {
  groups: [
    { key: "ontology", titleKey: "nav.ontology" },
    { key: "platform", titleKey: "nav.platform" },
  ],
  pages: [
    { path: "/playground", titleKey: "g", permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
    { path: "/objects", titleKey: "o", permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
    { path: "/data", titleKey: "d", permissions: ["data-browser"], group: "ontology", ownHeader: true },
    { path: "/permissions", titleKey: "p", permissions: ["user-management", "role-management"], group: "platform" },
    ...ossPlatformPages,
    licence,
  ],
};

const page = defineComponent({ render: () => null });
const adminPages = navigation.pages.filter(({ path }) => path.startsWith("/settings/") || path === "/permissions");
const components = Object.fromEntries(adminPages.map(({ path }) => [path, async () => page]));
// The host's routes: a frame route without a path of its own holding Manager-style pages, plus the platform pages.
const routes: RouteRecordRaw[] = [
  {
    path: "",
    component: defineComponent({ render: () => h(RouterView) }),
    children: [
      { path: "/playground", component: page, meta: { page: "/playground" } },
      { path: "/objects", component: page, meta: { page: "/objects" } },
      { path: "/objects/:className", component: page, meta: { page: "/objects" } },
      { path: "/data/:className?", component: page, meta: { page: "/data" } },
    ],
  },
  ...pageRoutes(adminPages, components),
  ...formerParentRoutes,
  { ...platformRoutes.ontology, component: page },
];
const layout = defineComponent({ render: () => h(RouterView) });

function access(granted: string[], error: string | null = null): PlatformAccess & { loads: number } {
  const state = {
    ready: false,
    error,
    loads: 0,
    can: (permission: string) => granted.includes(permission),
    async load() {
      state.loads += 1;
      state.ready = true;
    },
  };
  return state;
}

async function land(path: string, account: PlatformAccess, home = "/playground") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/_service", component: layout, children: routes }] });
  installPageGuard(router, navigation, account, home);
  if (path === "/" || path === "/no-such-page") path = platformRoutes.ontology.path;
  else if (path === "/admin" || path.startsWith("/admin/")) path = managerDestination(path);
  await router.push(path);
  return router.currentRoute.value.fullPath;
}

describe("one navigation filtered by permission codes", () => {
  it("lists a page when the account holds any one of its codes, and a group only with a listed page", () => {
    const account = access(["role-management", "system-monitoring"]);
    expect(availablePages(navigation, account).map(({ path }) => path)).toEqual([
      "/permissions",
      "/settings/records/system-monitor",
    ]);
    expect(availableGroups(navigation, access(["audit-logs"])).map(({ key }) => key)).toEqual(["platform"]);
    expect(availableGroups(navigation, access(["data-browser", "audit-logs"])).map(({ key }) => key)).toEqual([
      "ontology",
      "platform",
    ]);
  });

  it("lists a page only when the account holds one of its codes", () => {
    expect(availablePages(navigation, access([])).map(({ path }) => path)).toEqual([]);
    // The license landing still opens with no permission at all: it is entered before the codes are read.
    expect(navigation.pages.find(({ path }) => path === licence.path)?.enterableWithoutPermission).toBe(true);
  });
});

describe("the service router", () => {
  it("waits for the permissions before deciding and enters a granted page, its detail pages included", async () => {
    const account = access(["audit-logs", "ontology-modeling"]);
    expect(await land("/settings/records/audit-log", account)).toBe("/settings/records/audit-log");
    expect(account.loads).toBe(1);
    expect(await land("/objects/Order%20A", account)).toBe("/objects/Order%20A");
  });

  it("sends a page the account cannot open to the first available page of its group, then of any group", async () => {
    expect(await land("/settings/records", access(["data-browser", "system-monitoring"]))).toBe(
      "/settings/records/system-monitor"
    );
    expect(await land("/objects/Order", access(["data-browser", "audit-logs"]))).toBe("/data");
    expect(await land("/objects/Order", access(["audit-logs"]))).toBe("/settings/records/audit-log");
  });

  it("forwards a former parent's address to its first page, or to a page the account may open", async () => {
    expect(await land("/settings/records", access(["audit-logs", "system-monitoring"]))).toBe("/settings/records/audit-log");
    expect(await land("/settings/records", access(["system-monitoring"]))).toBe("/settings/records/system-monitor");
    expect(await land("/settings/model-config", access(["system-config"]))).toBe("/settings/model-config/usage");
    expect(await land("/settings/system-config", access(["authorization-management"]))).toBe(
      "/settings/system-config/authorization"
    );
    expect(await land("/settings/system-config", access(["system-config"]))).toBe("/settings/system-config/general");
  });

  it("sends an old page address to the page that replaced it", async () => {
    expect(await land("/admin/audit-log", access(["audit-logs"]))).toBe("/settings/records/audit-log");
    expect(await land("/admin/system-monitor", access(["system-monitoring"]))).toBe("/settings/records/system-monitor");
    expect(await land("/admin/license", access(["authorization-management"]))).toBe("/settings/system-config/authorization");
  });

  it("the root lands on the deployment's start page when the account may open it, otherwise on its first page", async () => {
    expect(await land("/", access(["ontology-modeling"]))).toBe("/playground");
    expect(await land("/", access(["data-browser"]), "/data/Order")).toBe("/data/Order");
    expect(await land("/", access(["audit-logs"]))).toBe("/settings/records/audit-log");
  });

  it("the old platform root opens the first available platform administration page", async () => {
    expect(await land("/admin", access(["ontology-modeling", "system-monitoring"]))).toBe("/settings/records/system-monitor");
    expect(await land("/admin", access(["ontology-modeling"]))).toBe("/playground");
  });

  it("an unknown address goes to the root and lands like it", async () => {
    expect(await land("/no-such-page", access(["ontology-modeling"]))).toBe("/playground");
  });

  it("lands an account with no page on the root instead of looping", async () => {
    expect(await land("/settings/records", access([]))).toBe("/ontology");
    expect(await land("/admin", access([], "HTTP 402"))).toBe("/ontology");
    expect(await land("/", access([]))).toBe("/ontology");
  });

  it("enters the license page even when the permissions cannot be read (they fail while the license is invalid)", async () => {
    // The page is named, so it opens although the account holds no code at all.
    expect(await land("/admin/license", access([], "HTTP 402"))).toBe("/settings/system-config/authorization");
    expect(await land("/admin/license", access(["system-config"]))).toBe("/settings/system-config/authorization");
  });
});

describe("the shared page routes", () => {
  it("route every settings page this package ships and the former parents' addresses; the licence is an edition's own", () => {
    const paths = (routes: RouteRecordRaw[]) => routes.map((route) => route.path);
    expect(paths(sharedPageRoutes())).toEqual([
      ...ossPlatformPages.map(({ path }) => path),
      platformRoutes.models.path,
      platformRoutes.settings.path,
      platformRoutes.records.path,
    ]);
    expect(paths(sharedPageRoutes())).not.toContain(platformRoutes.license.path);
  });
});
