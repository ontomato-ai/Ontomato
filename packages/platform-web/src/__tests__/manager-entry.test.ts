import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// config/app.ts reads the runtime config on import: the deployment root is /nested/.
window.__APP_CONFIG__ = { API_BASE: "/nested/api" };

const { legacyAdminRoutes, managerLocation } = await import("../admin-routes");

/** Opens an old workbench address and returns where the tab was replaced to (null when it stayed in the workbench). */
async function open(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { render: () => null } },
      // The settings' screens, so a redirect to one lands on it rather than falling through to the catch-all.
      ...["/agents/settings", "/agents/settings/capabilities", "/agents/settings/:agentId"].map((path) => ({
        path, component: { render: () => null },
      })),
      ...Object.values(legacyAdminRoutes),
    ],
  });
  await router.push(path).catch(() => {});
  return router.currentRoute.value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("old admin addresses in the workbench", () => {
  it("old Manager addresses leave for the Manager page under the same deployment root", async () => {
    for (const [path, target] of [
      ["/admin/ontology-manager", "/ontology"],
      ["/admin/ontology", "/ontology"],
      ["/admin/intelligence-assets", "/ontology/assets/metrics"],
      ["/admin/metric-views", "/ontology/assets/metrics"],
      ["/admin/action-management", "/ontology/assets/metrics"],
      ["/admin/write-tasks", "/ontology/assets/metrics"],
      ["/admin/knowledge", "/ontology/knowledge"],
      ["/admin/ontology-manager?view=data-browser", "/browser/data"],
    ]) {
      expect((await open(path)).fullPath, path).toBe(target);
    }
  });

  it("visual modeling takes focus/id and only the Manager graph as back target; credentials and other parameters stay behind", async () => {
    expect(
      (await open("/admin/ontology/visual-modeling?focus=object&id=Order%20A&back=playground&tk=leak&keep=1")).fullPath,
    ).toBe("/ontology/visual-modeling?focus=object&id=Order+A&back=playground");
    expect((await open("/admin/ontology/visual-modeling?focus=object&id=Order&back=https://evil.test/")).fullPath).toBe(
      "/ontology/visual-modeling?focus=object&id=Order",
    );
    expect((await open("/admin/ontology/visual-modeling")).fullPath).toBe("/ontology/visual-modeling");
  });

  it("an unknown view opens the Manager's own initial page, and focus/id/back only belong to visual modeling", () => {
    expect(managerLocation({ view: "other", focus: "object" })).toBe("/ontology");
    expect(managerLocation({ view: "assets", focus: "object", id: "x" })).toBe(
      "/ontology/assets/metrics",
    );
  });

  it("operations addresses open operations diagnosis, keeping the page they name", async () => {
    expect((await open("/admin/observe")).path).toBe("/ops/diagnosis");
    const turn = await open("/admin/observe/turn?x=1");
    expect(turn.path).toBe("/ops/turn");
    // It stays in the workbench application; the operations page renders it, not a tab replacement.
  });

  it("the console's pages redirect into the function area instead of rendering a page", async () => {
    const cases: Array<[string, string]> = [
      ["/admin", "/agents/chat"],
      ["/admin/analysis", "/agents/settings"],
      ["/admin/system-agents", "/agents/settings"],
      ["/admin/skills", "/agents/settings/capabilities"],
      ["/admin/skills/analysis", "/agents/settings/capabilities"],
      ["/admin/skills/visualization", "/agents/settings/capabilities"],
      ["/admin/mcp-service", "/agents/settings/capabilities"],
      ["/admin/system-config", "/agents/chat"],
      ["/admin/feedback-records", "/agents/chat"],
    ];
    for (const [path, expected] of cases) {
      const result = await open(path);
      // Left the workbench for nothing: the address redirects inside the workbench and no page is replaced.
      expect(result.path, path).toBe(expected);
    }
  });

  it("sends the old console's capability links to the library's own address", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: { render: () => null } },
        ...["/agents/settings", "/agents/settings/capabilities", "/agents/settings/:agentId"].map((path) => ({
          path, component: { render: () => null },
        })),
        ...Object.values(legacyAdminRoutes),
      ],
    });
    for (const path of ["/admin/skills", "/admin/mcp-service"]) {
      await router.push(path);
      expect(router.currentRoute.value.path, path).toBe("/agents/settings/capabilities");
    }
    await router.push("/admin/analysis");
    expect(router.currentRoute.value.path).toBe("/agents/settings");
  });
});
