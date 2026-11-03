import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";

// config/app.ts reads the runtime config on import: the deployment root is /nested/.
window.__APP_CONFIG__ = { API_BASE: "/nested/api" };

const { adminRoutes, managerLocation } = await import("../router/admin-routes");
const { adminGroups } = await import("../features/admin/navigation");

/** Opens an old workbench address and returns where the tab was replaced to (null when it stayed in the workbench). */
async function open(path: string) {
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { render: () => null } },
      {
        path: "/admin",
        component: RouterView,
        children: Object.values(adminRoutes),
      },
    ],
  });
  await router.push(path).catch(() => {});
  const target = replace.mock.calls[0]?.[0];
  return target === undefined ? null : String(target);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("old Manager addresses in the workbench", () => {
  it("the Manager tab is a real link to the Manager page under the same deployment root", () => {
    expect(adminGroups.dataAssets.href).toBe("/nested/ontology-manager/");
  });

  it.each([
    ["/admin/ontology-manager", "/nested/ontology-manager/"],
    ["/admin/ontology", "/nested/ontology-manager/"],
    ["/admin/intelligence-assets", "/nested/ontology-manager/#/assets/metrics"],
    ["/admin/metric-views", "/nested/ontology-manager/#/assets/metrics"],
    ["/admin/action-management", "/nested/ontology-manager/#/assets/metrics"],
    ["/admin/write-tasks", "/nested/ontology-manager/#/assets/metrics"],
    ["/admin/knowledge", "/nested/ontology-manager/#/knowledge"],
    ["/admin/ontology-manager?view=data-browser", "/nested/ontology-manager/#/data"],
  ])("%s replaces the tab with %s", async (path, target) => {
    expect(await open(path)).toBe(target);
  });

  it("visual modeling takes focus/id and only the Manager graph as back target; credentials and other parameters stay behind", async () => {
    expect(
      await open("/admin/ontology/visual-modeling?focus=object&id=Order%20A&back=playground&tk=leak&keep=1")
    ).toBe("/nested/ontology-manager/#/visual-modeling?focus=object&id=Order+A&back=playground");
    expect(await open("/admin/ontology/visual-modeling?focus=object&id=Order&back=https://evil.test/")).toBe(
      "/nested/ontology-manager/#/visual-modeling?focus=object&id=Order"
    );
    expect(await open("/admin/ontology/visual-modeling")).toBe("/nested/ontology-manager/#/visual-modeling");
  });

  it("an unknown view opens the Manager's own initial page, and focus/id/back only belong to visual modeling", () => {
    expect(managerLocation({ view: "other", focus: "object" })).toBe("/nested/ontology-manager/");
    expect(managerLocation({ view: "assets", focus: "object", id: "x" })).toBe(
      "/nested/ontology-manager/#/assets/metrics"
    );
  });

  it("the console root opens its first own page instead of leaving for the Manager", async () => {
    expect(await open("/admin")).toBeNull();
  });
});
