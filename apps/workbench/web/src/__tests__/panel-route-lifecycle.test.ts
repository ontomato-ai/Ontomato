import { afterEach, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { PANEL_LOAD_ERROR_CODES } from "@ontomato/contracts/agent-presentation";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { ProductDefinitionStreamFrame, ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { PanelHost } from "@ontomato/platform-shell";
import { panelAuthorDefinitions, platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { platformLayoutRoute } from "../../../../../packages/platform-web/src/layout-route";
import {
  ignoreChanges, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt, panelAnswer, panelRecord,
  panelSnapshot, panelUse, projections, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * What a panel application's page does for its panel over its life, whatever runs the panel (now the platform's document,
 * user's ruling, 2026-11-20): entering an application opens its first visible page at its own address; a definition
 * check refused on coming back to the foreground is shown with the owner's words; coming back reads the objects again and
 * a changed projection anew, never the panel's record when it did not change; and author pages share one definition
 * stream that follows the pages shown.
 *
 * Real routes, panel host, module loader, SDK instance and components; the network is a stand-in.
 */

const appA = "app-panels-trial-a";
const appB = "app-panels-trial-b";
const p = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const q = panelRecord("panel-schedules-summary", "Trial panel Q", manifestQ);
const useP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", p.id, `/applications/${appA}/tasks`);
const useQ = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, `/applications/${appB}/summary`);
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const fieldLabels = { application: "Application", settings: "Settings" };

/** The owner's record of the task, as Node's read entry answers it now: tests change it while a page is hidden. */
let record = { primaryKey: task.id, label: task.title, fieldLabels, fields: { application: "ops", settings: "daily 02:00" } };
let summary = projections["projection-schedules-summary"]!;

type Read = { dataName: string; inputs: { task?: { primaryKey: string } } };
function answer(request: Sent) {
  if (request.path === "/api/data-query/platform/applications") return Response.json({ success: true, data: [appA, appB].map(id => ({
    id, kind: "product", names: { en: id }, descriptions: {}, icon: "schedules",
    rail: "apps", category: "business", sort: 0, entry: { path: `/${id.slice(4)}`, renderer: "panels" },
    entryAccess: ["domain-member"], scheduleAdapter: null, releaseId: null,
    // The navigation catalogue lists the reader's entries, as Java answers it: where the application's own address starts.
    panelUses: [id === appA ? useP : useQ],
  })) });
  const applicationId = [appA, appB].find(id => request.path === `/api/data-query/platform/applications/${id}/panel-uses`);
  if (applicationId) return Response.json({ data: {
    applicationId, entry: { path: "/", renderer: "panels" }, panelUses: [applicationId === appA ? useP : useQ],
  } });
  const panel = [p, q].find(one => request.path === `/api/product-panels/${one.id}`);
  if (panel) return panelAnswer(panel, request);
  const snapshot = [p, q].find(one => request.path === `/api/product-panels/${one.id}/snapshot`);
  if (snapshot) return panelSnapshot(snapshot, { ...projections, [summary.id]: summary }, request);
  if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/product-panels/read") {
    const { dataName } = request.body as Read;
    if (dataName === "record") return Response.json({ status: "ready", value: record });
    return Response.json({ status: "empty" });
  }
  return nothingAt(request);
}

async function open(address: string, { platformRoutes = false, reply = answer, listeners = {} } = {}) {
  const sent = installPlatform(reply);
  if (platformRoutes) await useApplicationCatalog().refresh();
  const router = createRouter({ history: createMemoryHistory(), routes: platformRoutes ? [platformLayoutRoute([])] : [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId, ...listeners }),
  }] });
  await router.push(address);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  return { app, element, router, sent };
}

function visibility() {
  const current = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  function set(value: "visible" | "hidden") {
    current.mockReturnValue(value);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  set("visible");
  return { set, reset: () => { set("visible"); current.mockRestore(); } };
}

const reads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read").map(request => request.body as Read & { source: unknown });
const summaryTitle = () => document.querySelector("[data-member='summary'] .sdk-object-summary-title")?.textContent;
const firstLabel = () => document.querySelector("[data-member='summary'] .sdk-object-summary dt")?.textContent;

afterEach(() => {
  record = { primaryKey: task.id, label: task.title, fieldLabels, fields: { application: "ops", settings: "daily 02:00" } };
  summary = projections["projection-schedules-summary"]!;
  leaveFrame();
});

it("opens the first visible use at its own URL when entering a panel application", async () => {
  const { app, router, sent } = await open(`/applications/${appB}`, { platformRoutes: true });
  try {
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/applications/${appB}/summary`));
    // The page's panel runs as the application use this address opened.
    await vi.waitFor(() => expect(document.querySelector(".panel-host-coded [data-member='summary']")).not.toBeNull());
    expect(sent.some(request => request.path.endsWith("/policy"))).toBe(false);
  } finally {
    app.unmount();
  }
});

it.each([403, 404, 500])("reports HTTP %i when the foreground snapshot is unavailable", async status => {
  const foreground = visibility();
  const onDisplayLoaded = vi.fn();
  let refused = false;
  const message = "The panel's owner refused this read";
  const { app } = await open(panelAddress(useQ.path, deepState), {
    reply: request => refused && request.path === `/api/product-panels/${q.id}/snapshot`
      ? Response.json({ error: { message } }, { status }) : answer(request),
    listeners: { onDisplayLoaded },
  });
  try {
    await vi.waitFor(() => expect(onDisplayLoaded).toHaveBeenLastCalledWith({ status: "ready" }));
    foreground.set("hidden");
    refused = true;
    foreground.set("visible");
    await vi.waitFor(() => expect(onDisplayLoaded).toHaveBeenLastCalledWith({
      status: "error", error: { code: PANEL_LOAD_ERROR_CODES.panelUnavailable, message: `HTTP ${status}: ${message}` },
    }));
  } finally {
    app.unmount();
    foreground.reset();
  }
});

it("reconciles definitions and objects on foreground without replacing an unchanged panel", async () => {
  const foreground = visibility();
  const { app, element, sent } = await open(panelAddress(useQ.path, deepState));
  const definitionReads = () => sent.filter(request => /\/api\/product-(panels|projections)\//.test(request.path)
    && !request.path.endsWith("/snapshot") && request.path !== "/api/product-panels/read");
  try {
    await vi.waitFor(() => expect(summaryTitle()).toBe(task.title));
    const panel = element.querySelector(".panel-host-coded > *");
    const initialDefinitions = definitionReads().length;
    const initialReads = reads(sent).length;

    // The task changed while the page was hidden: its record is read again, and nothing else.
    foreground.set("hidden");
    record = { ...record, label: "Changed while hidden" };
    foreground.set("visible");
    await vi.waitFor(() => expect(summaryTitle()).toBe("Changed while hidden"));
    expect(reads(sent).length).toBeGreaterThan(initialReads);
    expect(definitionReads().slice(initialDefinitions)).toEqual([]);

    // The projection changed while hidden: it alone is read again, and the panel stays the same instance.
    foreground.set("hidden");
    summary = { ...summary, revision: summary.revision + 1, config: { ...summary.config, fields: ["settings"] } };
    foreground.set("visible");
    await vi.waitFor(() => expect(firstLabel()).toBe("Settings"));
    expect(definitionReads().slice(initialDefinitions).map(request => request.path)).toEqual([`/api/product-projections/${summary.id}`]);
    expect(element.querySelector(".panel-host-coded > *")).toBe(panel);
  } finally {
    app.unmount();
    foreground.reset();
  }
});

it("shares one definition stream across author panels, restores a changed collection, and observes a projection-only candidate", async () => {
  const foreground = visibility();
  const author = panelAuthorDefinitions();
  const mode = { kind: "author", definitions: author } as const;
  const showP = ref(true);
  const streams: { targets: ProductDefinitionTarget[]; body: ReadableStreamDefaultController<Uint8Array> }[] = [];
  const openBodies = new Set<ReadableStreamDefaultController<Uint8Array>>();
  installPlatform(request => {
    if (request.path === "/api/product-panels/definition-stream") {
      let body!: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          openBodies.add(body);
          streams.push({ targets: (request.body as { targets: ProductDefinitionTarget[] }).targets, body });
        },
        cancel() { openBodies.delete(body); },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    return answer(request);
  });
  function send(stream: number, payload: ProductDefinitionStreamFrame) {
    streams[stream]!.body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
  }
  const signals = () => vi.mocked(fetch).mock.calls
    .filter(([url]) => String(url).endsWith("/definition-stream")).map(([, init]) => init!.signal!);
  const language = { locale: "en", fallback: "en" };
  const labels = {
    notStarted: "Panel has not started",
    failures: { fileUnavailable: "File unavailable", scriptThrew: "Script threw", scriptRejected: "Script rejected" },
    content: { styleOutside: "Style outside" },
    draft: { toAgent: "To agent", toAgentText: "Unused: {reason}" },
    refresh: "Refresh",
  };
  const portA = platformPanelHost(appA, useP, ignoreChanges, mode);
  const portB = platformPanelHost(appB, useQ, ignoreChanges, mode);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => null } }] });
  await router.push("/");
  const page = mountPlatformPage(() => h("main", [
    showP.value ? h(PanelHost, { key: "p", port: portA, address: useP.path, labels, language }) : null,
    h(PanelHost, { key: "q", port: portB, address: useQ.path, labels, language, initial: deepState }),
  ]), router);
  try {
    await vi.waitFor(() => expect(streams.at(-1)?.targets).toEqual(expect.arrayContaining([
      { kind: "panel", id: p.id }, { kind: "panel", id: q.id }, { kind: "projection", id: summary.id },
    ])));
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
    const fullCollection = streams.length - 1;
    expect(streams[fullCollection]!.targets.filter(({ id }) => id === summary.id)).toHaveLength(1);
    await vi.waitFor(() => expect(summaryTitle()).toBe(task.title));

    showP.value = false;
    await vi.waitFor(() => expect(streams.at(-1)?.targets).toEqual([
      { kind: "panel", id: q.id }, { kind: "projection", id: summary.id },
    ]));
    const reduced = streams.length - 1;
    expect(signals()[fullCollection]!.aborted).toBe(true);
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);

    // The shared projection changed while the old request closed and the reduced collection opened.
    const previous = summary;
    summary = { ...summary, revision: summary.revision + 1, config: { ...summary.config, fields: ["settings"] } };
    send(reduced, { kind: "snapshot", definitions: [{ kind: "projection", id: summary.id, revision: summary.revision }] });
    await vi.waitFor(() => expect(firstLabel()).toBe("Settings"));
    send(reduced, { kind: "definition-changed", definition: { kind: "projection", id: summary.id, revision: previous.revision } });

    foreground.set("hidden");
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(0);
    foreground.set("visible");
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
  } finally {
    page.app.unmount();
  }

  const revisions = vi.fn();
  const candidate = author.observe([{ kind: "projection", id: summary.id }], revisions, error => { throw error; });
  try {
    expect(streams.at(-1)?.targets).toEqual([{ kind: "projection", id: summary.id }]);
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
    const revision = { kind: "projection", id: summary.id, revision: summary.revision + 1 } as const;
    send(streams.length - 1, { kind: "definition-changed", definition: revision });
    send(streams.length - 1, { kind: "snapshot", definitions: [{ ...revision, revision: summary.revision }] });
    await vi.waitFor(() => expect(revisions.mock.calls).toEqual([[[revision]]]));
  } finally {
    candidate.close();
    foreground.reset();
    for (const body of openBodies) body.close();
  }
  expect(signals().filter(signal => !signal.aborted)).toHaveLength(0);
});
