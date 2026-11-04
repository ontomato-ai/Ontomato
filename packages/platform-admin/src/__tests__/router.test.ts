import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { RouterView, type RouteRecordRaw } from "vue-router";
import { createPlatformRouter } from "../router";
import { availableGroups, availablePages, type PlatformAccess, type PlatformNavigation } from "../navigation";
import { pageRoutes } from "../pages";

const navigation: PlatformNavigation = {
  groups: [
    { key: "ontology", titleKey: "nav.ontology" },
    { key: "platform", titleKey: "nav.platform" },
  ],
  pages: [
    { path: "/playground", titleKey: "g", permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
    { path: "/objects", titleKey: "o", permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
    { path: "/data", titleKey: "d", permissions: ["data-browser"], group: "ontology", ownHeader: true },
    { path: "/admin/permissions", titleKey: "p", permissions: ["user-management", "role-management"], group: "platform" },
    {
      path: "/admin/license",
      titleKey: "l",
      permissions: ["authorization-management"],
      group: "platform",
      enterableWithoutPermission: true,
    },
    { path: "/admin/audit-log", titleKey: "a", permissions: ["audit-logs"], group: "platform" },
    { path: "/admin/system-monitor", titleKey: "m", permissions: ["system-monitoring"], group: "platform" },
  ],
};

const page = defineComponent({ render: () => null });
const platformPages = navigation.pages.filter(({ path }) => path.startsWith("/admin/"));
const components = Object.fromEntries(platformPages.map(({ path }) => [path, async () => page]));
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
  ...pageRoutes(platformPages, components),
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
  const router = createPlatformRouter({ navigation, routes, standalone: [], access: account, layout, home });
  await router.push(path);
  return router.currentRoute.value.fullPath;
}

describe("one navigation filtered by permission codes", () => {
  it("lists a page when the account holds any one of its codes, and a group only with a listed page", () => {
    const account = access(["role-management", "system-monitoring"]);
    expect(availablePages(navigation, account).map(({ path }) => path)).toEqual([
      "/admin/permissions",
      "/admin/system-monitor",
    ]);
    expect(availableGroups(navigation, access(["audit-logs"])).map(({ key }) => key)).toEqual(["platform"]);
    expect(availableGroups(navigation, access(["data-browser", "audit-logs"])).map(({ key }) => key)).toEqual([
      "ontology",
      "platform",
    ]);
  });

  it("does not list a page that is only enterable without permission", () => {
    expect(availablePages(navigation, access([])).map(({ path }) => path)).toEqual([]);
  });
});

describe("the service router", () => {
  it("waits for the permissions before deciding and enters a granted page, its detail pages included", async () => {
    const account = access(["audit-logs", "ontology-modeling"]);
    expect(await land("/admin/audit-log", account)).toBe("/admin/audit-log");
    expect(account.loads).toBe(1);
    expect(await land("/objects/Order%20A", account)).toBe("/objects/Order%20A");
  });

  it("sends a page the account cannot open to the first available page of its group, then of any group", async () => {
    expect(await land("/admin/audit-log", access(["data-browser", "system-monitoring"]))).toBe("/admin/system-monitor");
    expect(await land("/objects/Order", access(["data-browser", "audit-logs"]))).toBe("/data");
    expect(await land("/objects/Order", access(["audit-logs"]))).toBe("/admin/audit-log");
  });

  it("the root lands on the deployment's start page when the account may open it, otherwise on its first page", async () => {
    expect(await land("/", access(["ontology-modeling"]))).toBe("/playground");
    expect(await land("/", access(["data-browser"]), "/data/Order")).toBe("/data/Order");
    expect(await land("/", access(["audit-logs"]))).toBe("/admin/audit-log");
  });

  it("the old platform root opens the first available platform administration page", async () => {
    expect(await land("/admin", access(["ontology-modeling", "system-monitoring"]))).toBe("/admin/system-monitor");
    expect(await land("/admin", access(["ontology-modeling"]))).toBe("/playground");
  });

  it("an unknown address goes to the root and lands like it", async () => {
    expect(await land("/no-such-page", access(["ontology-modeling"]))).toBe("/playground");
  });

  it("lands an account with no page on the root instead of looping", async () => {
    expect(await land("/admin/audit-log", access([]))).toBe("/");
    expect(await land("/admin", access([], "HTTP 402"))).toBe("/");
    expect(await land("/", access([]))).toBe("/");
  });

  it("enters the license page without reading permissions (they fail while the license is invalid)", async () => {
    const account = access([]);
    expect(await land("/admin/license", account)).toBe("/admin/license");
    expect(account.loads).toBe(0);
  });
});
