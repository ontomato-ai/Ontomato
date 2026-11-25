import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { productPanelSchema, productProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import recorded from "./fixtures/direct-panel-host-http.json";
import { APPLICATION_ENTRY_PATH, isPanelDataRead, panelAnswer, installPlatform, mountPlatformPage, nothingAt, panelUse, type Sent } from "./panel-frame";

const application = "app-panels-trial-a";
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", "panel-schedules-trial", `/applications/${application}/tasks`);
const other = panelUse("use-trial-a-other", "panels-trial-a-other", "panel-schedules-summary", `/applications/${application}/other`);
const rows = [{ primaryKey: "t-1", label: "Nightly audit", fields: {} }];

/** Java's answer for the application's use relations, held until the test lets it go. */
function heldRelations() {
  let release!: (uses: readonly unknown[]) => void;
  const answer = new Promise<readonly unknown[]>(resolve => (release = resolve));
  return { answer, release };
}

async function open(relations: Promise<readonly unknown[]>) {
  const sent = installPlatform(async (request: Sent) => {
    if (request.path === "/api/data-query/platform/applications") return Response.json({ success: true, data: [{
      id: application, kind: "product", names: { en: application }, descriptions: {}, icon: "schedules",
      rail: "apps", category: "business", sort: 0, entry: { path: "/", renderer: "panels" },
      entryAccess: ["domain-member"], scheduleAdapter: null, releaseId: null, panelUses: [use],
    }] });
    if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
      return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: await relations } });
    if (request.path === "/api/product-panels/panel-schedules-trial") return panelAnswer(productPanelSchema.parse(recorded.panel.panel), request);
    if (request.path === "/api/product-panels/panel-schedules-trial/snapshot") return Response.json(recorded.snapshot);
    const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projection)
      return Response.json(productProjectionResponseSchema.parse(recorded.projections[decodeURIComponent(projection[1]!) as keyof typeof recorded.projections]));
    if (request.path === "/api/product-panels/read") return Response.json({ status: "ready", value: rows });
    return nothingAt(request);
  });
  // The reader came back from another page: the shell's catalog is already read.
  await useApplicationCatalog().refresh();
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId }),
  }] });
  await router.push(use.path);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  return { app, element, sent };
}

const reached = (sent: Sent[], path: string) => sent.some(request => request.path === path);

afterEach(() => {
  document.body.innerHTML = "";
});

it("awaits fresh admission for a known entry and reads its definition once after opening", async () => {
  const relations = heldRelations();
  const { app, element, sent } = await open(relations.answer);
  try {
    await vi.waitFor(() => expect(reached(sent, APPLICATION_ENTRY_PATH)).toBe(true));
    expect(sent.some(isPanelDataRead)).toBe(false);
    expect(reached(sent, "/api/product-panels/panel-schedules-trial")).toBe(false);
    relations.release([use]);
    await vi.waitFor(() => expect(element.querySelectorAll("[data-member='tasks'] [role='option']")).toHaveLength(1));
    expect(element.querySelector<HTMLElement>(".panel-host-direct")?.style.display).toBe("");
    expect(sent.filter(request => request.path === APPLICATION_ENTRY_PATH)).toHaveLength(1);
    expect(sent.filter(request => request.path === "/api/product-panels/panel-schedules-trial")).toHaveLength(1);
    expect(sent.filter(request => request.path === "/api/product-projections/projection-schedules-tasks")).toHaveLength(1);
  } finally {
    app.unmount();
  }
});

it("keeps a known entry closed when Java's opening decision no longer names it", async () => {
  const relations = heldRelations();
  const { app, element } = await open(relations.answer);
  try {
    relations.release([other]);
    await vi.waitFor(() => expect(element.textContent).toContain(use.path));
    await nextTick();
    expect(element.querySelector(".panel-host-direct:not([style*='display: none'])")).toBeNull();
  } finally {
    app.unmount();
  }
});
