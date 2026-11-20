import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { productProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import recorded from "./fixtures/direct-panel-host-http.json";
import { installPlatform, mountPlatformPage, nothingAt, panelUse, type Sent } from "./panel-frame";

/*
 * Coming back to a direct panel's page (first gate, hot return): the page is rebuilt as a native page is — native views
 * are not kept either — but its reads are not queued behind Java's answer for the application's use relations. The
 * shell's catalog already names the reader's relations, so the page reads its record, its members' projections and
 * their data at once, while Java's answer is read beside them; the page is shown only once that answer names it, and a
 * page it does not name is never shown. Node's answers for the panel and its projections are the ones Node gave over
 * HTTP (`fixtures/direct-panel-host-http.json`); Java and the owner are stand-ins.
 *
 * What this rules out: a return whose reads wait for the use relations (the 2026-11-20 gate: +232 ms, the reads ran
 * after Java's 107 ms answer), and a page shown, or left shown, that Java's answer does not name.
 */

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
    if (request.path === "/api/product-panels/panel-schedules-trial") return Response.json(recorded.panel);
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

it("reads the page's record, projections and data while Java's answer is coming, and shows the page once it names it", async () => {
  const relations = heldRelations();
  const { app, element, sent } = await open(relations.answer);
  try {
    await vi.waitFor(() => expect(reached(sent, "/api/product-panels/read")).toBe(true));
    expect(reached(sent, "/api/product-panels/panel-schedules-trial")).toBe(true);
    expect(reached(sent, "/api/product-projections/projection-schedules-tasks")).toBe(true);
    // Drawn so its members read, but nothing is shown before Java's answer names the page.
    expect(element.querySelector<HTMLElement>(".panel-host-direct")?.style.display).toBe("none");

    relations.release([use]);
    await vi.waitFor(() => expect(element.querySelector<HTMLElement>(".panel-host-direct")?.style.display).toBe(""));
    expect(element.querySelectorAll("[data-member='tasks'] [role='option']")).toHaveLength(1);
    // The page did not start again for Java's answer: its record and projections were read once.
    expect(sent.filter(request => request.path === "/api/product-panels/panel-schedules-trial")).toHaveLength(1);
    expect(sent.filter(request => request.path === "/api/product-projections/projection-schedules-tasks")).toHaveLength(1);
  } finally {
    app.unmount();
  }
});

it("never shows a page Java's answer does not name", async () => {
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
