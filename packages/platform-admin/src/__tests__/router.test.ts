import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { RouterView } from "vue-router";
import { createPlatformRouter, isPlatformHash, PLATFORM_ROOT } from "../router";
import { availableGroups, availablePages, type PlatformAccess, type PlatformNavigation } from "../navigation";

const navigation: PlatformNavigation = {
  groups: [
    { key: "identity", titleKey: "nav.identity" },
    { key: "system", titleKey: "nav.system" },
  ],
  pages: [
    { path: "/admin/permissions", titleKey: "p", permissions: ["user-management", "role-management"], group: "identity" },
    {
      path: "/admin/license",
      titleKey: "l",
      permissions: ["authorization-management"],
      group: "system",
      enterableWithoutPermission: true,
    },
    { path: "/admin/audit-log", titleKey: "a", permissions: ["audit-logs"], group: "system" },
    { path: "/admin/system-monitor", titleKey: "m", permissions: ["system-monitoring"], group: "system" },
  ],
};

const page = defineComponent({ render: () => null });
const components = Object.fromEntries(navigation.pages.map(({ path }) => [path, async () => page]));
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

async function land(path: string, account: PlatformAccess) {
  const router = createPlatformRouter({ navigation, standalone: [], access: account, components, layout });
  await router.push(path);
  return router.currentRoute.value.fullPath;
}

describe("platform navigation filtered by permission codes", () => {
  it("lists a page when the account holds any one of its codes, and a group only with a listed page", () => {
    const account = access(["role-management", "system-monitoring"]);
    expect(availablePages(navigation, account).map(({ path }) => path)).toEqual([
      "/admin/permissions",
      "/admin/system-monitor",
    ]);
    expect(availableGroups(navigation, access(["audit-logs"])).map(({ key }) => key)).toEqual(["system"]);
  });

  it("does not list a page that is only enterable without permission", () => {
    expect(availablePages(navigation, access([])).map(({ path }) => path)).toEqual([]);
  });

  it("waits for the permissions before deciding and enters a granted page", async () => {
    const account = access(["audit-logs"]);
    expect(await land("/admin/audit-log", account)).toBe("/admin/audit-log");
    expect(account.loads).toBe(1);
  });

  it("sends a page the account cannot open to the first available page of its group, then of any group", async () => {
    expect(await land("/admin/audit-log", access(["system-monitoring", "user-management"]))).toBe(
      "/admin/system-monitor"
    );
    expect(await land("/admin/audit-log", access(["user-management"]))).toBe("/admin/permissions");
    expect(await land(PLATFORM_ROOT, access(["system-monitoring"]))).toBe("/admin/system-monitor");
  });

  it("lands an account with no page on the platform root instead of looping", async () => {
    expect(await land("/admin/audit-log", access([]))).toBe(PLATFORM_ROOT);
    expect(await land(PLATFORM_ROOT, access([], "HTTP 402"))).toBe(PLATFORM_ROOT);
  });

  it("enters the license page without reading permissions (they fail while the license is invalid)", async () => {
    const account = access([]);
    expect(await land("/admin/license", account)).toBe("/admin/license");
    expect(account.loads).toBe(0);
  });
});

describe("which area owns the hash", () => {
  it("gives /admin and the standalone pages to the platform area and everything else to the workspace", () => {
    const standalone = [{ path: "/login", component: page }, { path: "/super-admin", component: page }];
    expect(isPlatformHash("#/admin", standalone)).toBe(true);
    expect(isPlatformHash("#/admin/audit-log?x=1", standalone)).toBe(true);
    expect(isPlatformHash("#/login?redirect=%2F", standalone)).toBe(true);
    expect(isPlatformHash("#/super-admin", standalone)).toBe(true);
    expect(isPlatformHash("#/administration", standalone)).toBe(false);
    expect(isPlatformHash("#/playground", standalone)).toBe(false);
    expect(isPlatformHash("", standalone)).toBe(false);
    expect(isPlatformHash("#/login")).toBe(false);
  });
});
