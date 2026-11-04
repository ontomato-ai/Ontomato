import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// config/app.ts reads the runtime config on import: the deployment root is /nested/.
window.__APP_CONFIG__ = { API_BASE: "/nested/api" };

const { legacyAdminRoutes, managerLocation } = await import("../router/admin-routes");

/** Opens an old workbench address and returns where the tab was replaced to (null when it stayed in the workbench). */
async function open(path: string) {
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { render: () => null } },
      ...Object.values(legacyAdminRoutes),
    ],
  });
  await router.push(path).catch(() => {});
  const target = replace.mock.calls[0]?.[0];
  return { replaced: target === undefined ? null : String(target), path: router.currentRoute.value.path };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("old admin addresses in the workbench", () => {
  it("old Manager addresses leave for the Manager page under the same deployment root", async () => {
    for (const [path, target] of [
      ["/admin/ontology-manager", "/nested/ontology-manager/"],
      ["/admin/ontology", "/nested/ontology-manager/"],
      ["/admin/intelligence-assets", "/nested/ontology-manager/#/assets/metrics"],
      ["/admin/metric-views", "/nested/ontology-manager/#/assets/metrics"],
      ["/admin/action-management", "/nested/ontology-manager/#/assets/metrics"],
      ["/admin/write-tasks", "/nested/ontology-manager/#/assets/metrics"],
      ["/admin/knowledge", "/nested/ontology-manager/#/knowledge"],
      ["/admin/ontology-manager?view=data-browser", "/nested/ontology-manager/#/data"],
    ]) {
      expect((await open(path)).replaced, path).toBe(target);
    }
  });

  it("visual modeling takes focus/id and only the Manager graph as back target; credentials and other parameters stay behind", async () => {
    expect(
      (await open("/admin/ontology/visual-modeling?focus=object&id=Order%20A&back=playground&tk=leak&keep=1")).replaced,
    ).toBe("/nested/ontology-manager/#/visual-modeling?focus=object&id=Order+A&back=playground");
    expect((await open("/admin/ontology/visual-modeling?focus=object&id=Order&back=https://evil.test/")).replaced).toBe(
      "/nested/ontology-manager/#/visual-modeling?focus=object&id=Order",
    );
    expect((await open("/admin/ontology/visual-modeling")).replaced).toBe("/nested/ontology-manager/#/visual-modeling");
  });

  it("an unknown view opens the Manager's own initial page, and focus/id/back only belong to visual modeling", () => {
    expect(managerLocation({ view: "other", focus: "object" })).toBe("/nested/ontology-manager/");
    expect(managerLocation({ view: "assets", focus: "object", id: "x" })).toBe(
      "/nested/ontology-manager/#/assets/metrics",
    );
  });

  it("the console's pages redirect into the function area instead of rendering a page", async () => {
    const cases: Array<[string, string]> = [
      ["/admin", "/chat"],
      ["/admin/analysis", "/chat"],
      ["/admin/system-agents", "/chat"],
      ["/admin/skills", "/chat"],
      ["/admin/skills/analysis", "/chat"],
      ["/admin/skills/visualization", "/chat"],
      ["/admin/mcp-service", "/chat"],
      ["/admin/system-config", "/chat"],
      ["/admin/feedback-records", "/chat"],
    ];
    for (const [path, expected] of cases) {
      const result = await open(path);
      // Left the workbench for nothing: the address redirects inside the workbench and no page is replaced.
      expect(result.replaced, path).toBeNull();
      expect(result.path, path).toBe(expected);
    }
  });

  it("keeps the feature and tab in the redirect so the destination opens the right place", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: { render: () => null } },
        ...Object.values(legacyAdminRoutes),
      ],
    });
    await router.push("/admin/skills");
    expect(router.currentRoute.value.query).toEqual({ feature: "agents", tab: "capabilities" });
    await router.push("/admin/analysis");
    expect(router.currentRoute.value.query).toEqual({ feature: "agents" });
  });
});
