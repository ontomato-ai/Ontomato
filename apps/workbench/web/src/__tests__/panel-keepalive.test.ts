import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import ElementPlus from "element-plus";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import type { ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { PanelHost, provideUnsavedChanges } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { panelAuthorDefinitions, panelHostPaths, platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  ignoreChanges, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt, panelAnswer, panelRecord,
  panelSnapshot, panelUse, projections, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * A panel application's recent pages kept across page switches (design 7.2.1), through the platform's own route and
 * panel host, with each page's panel — written with code — running in the platform's document. Only the network is a
 * stand-in.
 *
 * What this rules out: going A→B→A running A's module again or reading its record again; a page shown again before its
 * objects are read, or held back until its definition check answers; a changed definition kept on screen; an unsaved
 * page dropped to make room; a kept page that reads anything while it is out of view or moves the address; and kept pages
 * surviving the reader leaving their application.
 */

const appA = "app-keep-a";
const appB = "app-keep-b";
let p = panelRecord("panel-keep-p", "Tasks", manifestP);
const q = panelRecord("panel-keep-q", "Summary", manifestQ);
const at = (path: string) => `/applications/${appA}/${path}`;
const allUses = [
  panelUse("use-tasks", "keep-tasks", p.id, at("tasks")),
  panelUse("use-summary", "keep-summary", q.id, at("summary")),
  panelUse("use-more", "keep-more", p.id, at("more")),
  panelUse("use-other", "keep-other", q.id, at("other")),
];
/** The relations Java answers now, and the task's label the owner answers now: tests change them while a page is kept. */
let uses = allUses;
let shownLabel = task.title;
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const secondTask = { ...task, id: "ac186b00-a3dd-46d2-b404-72065d877a34", title: "Second scheduled task" };

/** Holds P's definition check until the test lets it answer. */
let snapshotGate: Promise<void> | null = null;
/** The reader's answer to the platform's unsaved-changes question. */
let leaveAnswer = true;
const asked = vi.fn(async () => leaveAnswer);

const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
type Read = { dataName: string; inputs: { task?: { primaryKey: string } } };
function read(request: Sent) {
  const { dataName, inputs } = request.body as Read;
  if (dataName === "rows")
    return [task, secondTask].map(one => ({ primaryKey: one.id, label: one.title, fields: {} }));
  if (dataName === "record")
    return { primaryKey: inputs.task!.primaryKey, label: inputs.task!.primaryKey === task.id ? shownLabel : secondTask.title, fields: {} };
  if (dataName === "operation")
    return { handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
  return {
    fields: [field("/name", "Name")], values: { name: "Nightly" }, errors: [], revision: 3,
    save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
  };
}

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${appA}/panel-uses`)
    return Response.json({ data: { applicationId: appA, entry: { path: `/applications/${appA}`, renderer: "panels" }, panelUses: uses } });
  if (request.path === `/api/data-query/platform/applications/${appB}/panel-uses`)
    return Response.json({ data: { applicationId: appB, entry: { path: `/applications/${appB}`, renderer: "panels" },
      panelUses: [panelUse("use-b", "keep-b", q.id, `/applications/${appB}/summary`)] } });
  if (request.path === `/api/product-panels/${p.id}`) return panelAnswer(p, request);
  if (request.path === `/api/product-panels/${q.id}`) return panelAnswer(q, request);
  if (request.path === `/api/product-panels/${p.id}/snapshot`) {
    const shown = p;
    return (snapshotGate ?? Promise.resolve()).then(() => panelSnapshot(shown, projections, request));
  }
  if (request.path === `/api/product-panels/${q.id}/snapshot`) return panelSnapshot(q, projections, request);
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/product-panels/read") return Response.json({ status: "ready", value: read(request) });
  return nothingAt(request);
}

/** The platform as its layout mounts a page: with its unsaved-changes question on every navigation. */
async function openApplication(address: string) {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(address);
  const page = mountPlatformPage(() => h(defineComponent({
    setup() {
      const unsaved = provideUnsavedChanges(asked);
      router.beforeEach(to => unsaved.allows(to.path));
      return () => h(RouterView);
    },
  })), router);
  return { ...page, router, sent };
}

const reopened = () => performance.getEntriesByName("ontomato:panel-page-reopened").length;

/** Each page's panel, as the element its component is mounted in, in the order the pages are kept. */
const panels = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>(".panel-host-coded > *")];
/** Whether the page a panel belongs to is the one shown: a kept page's host is hidden, never taken out. */
const shown = (panel: HTMLElement) => panel.closest<HTMLElement>(".panel-host")!.style.display !== "none";
/** The page shown now, once its panel has drawn a member; after a switch, not the page being left. */
const shownPanel = (element: HTMLElement, left?: HTMLElement) => vi.waitFor(() => {
  const found = panels(element).find(panel => panel !== left && shown(panel) && panel.querySelector("[data-member]"));
  if (!found) throw new Error("No page is shown");
  return found;
});
const summaryTitle = (panel: HTMLElement) => panel.querySelector("[data-member='summary'] .sdk-object-summary-title")?.textContent;
const reads = (sent: Sent[], dataName?: string) => sent.filter(request => request.path === "/api/product-panels/read"
  && (dataName === undefined || (request.body as Read).dataName === dataName));

afterEach(() => {
  snapshotGate = null;
  leaveAnswer = true;
  asked.mockClear();
  uses = allUses;
  shownLabel = task.title;
  p = panelRecord("panel-keep-p", "Tasks", manifestP);
  performance.clearMarks();
  leaveFrame();
});

it("shows a page kept within its application as it was left: its module not run again, its record not read again", async () => {
  const { app, element, router, sent } = await openApplication(panelAddress(at("tasks"), deepState));
  try {
    const tasks = await shownPanel(element);
    await vi.waitFor(() => expect(summaryTitle(tasks)).toBe(task.title));
    const moved: Node[] = [];
    new MutationObserver(records => records.forEach(record => moved.push(...record.removedNodes))).observe(element, { childList: true, subtree: true });

    await router.push(at("summary"));
    const summary = await shownPanel(element, tasks);
    await vi.waitFor(() => expect(shown(tasks)).toBe(false));

    // Back by its bare address: the same panel is shown at once, at the state it was left at — but it reads nothing
    // until its relation and its definitions have been checked.
    let release!: () => void;
    snapshotGate = new Promise(resolve => (release = resolve));
    const recordReads = () => reads(sent, "record").filter(request => (request.body as Read).inputs.task?.primaryKey === task.id).length;
    const readsBefore = recordReads();
    await router.push(at("tasks"));
    await nextTick();
    expect(shown(tasks)).toBe(true);
    expect(shown(summary)).toBe(false);
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(at("tasks"));
      expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual(deepState);
    });
    await vi.waitFor(() => expect(sent.filter(request => request.path.endsWith("/panel-uses"))).toHaveLength(2));
    expect(recordReads()).toBe(readsBefore);
    expect(reopened()).toBe(0);

    // Checked: its objects are read again whether or not anything changed; its record and module were not.
    release();
    await vi.waitFor(() => expect(reopened()).toBe(1));
    await vi.waitFor(() => expect(recordReads()).toBeGreaterThan(readsBefore));
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}/snapshot`)).toHaveLength(2);
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}`)).toHaveLength(1);
    expect(panels(element)).toEqual([tasks, summary]);
    expect(moved.some(node => node.contains(tasks))).toBe(false);
    // A viewer's pages hold no stream, shown or kept.
    expect(sent.some(request => request.path === panelHostPaths.definitionStream)).toBe(false);
  } finally {
    app.unmount();
  }
});

it("shows the new value of an object changed while its page was kept", async () => {
  const { app, element, router } = await openApplication(panelAddress(at("tasks"), deepState));
  try {
    const tasks = await shownPanel(element);
    await vi.waitFor(() => expect(summaryTitle(tasks)).toBe(task.title));
    await router.push(at("summary"));
    await shownPanel(element);
    // An agent renames the task while the page is kept: nothing reaches the kept page for it.
    shownLabel = "Renamed while away";
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(summaryTitle(tasks)).toBe("Renamed while away"));
  } finally {
    app.unmount();
  }
});

it("starts a kept page anew from its current definition when it changed while the reader was away", async () => {
  const { app, element, router, sent } = await openApplication(at("tasks"));
  try {
    const tasks = await shownPanel(element);
    await router.push(at("summary"));
    await shownPanel(element);
    p = { ...p, revision: 2, content: { ...p.content, html: '<div id="app" class="rearranged"></div>' } };
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded > .rearranged")).not.toBeNull());
    expect(tasks.isConnected).toBe(false);
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}`)).toHaveLength(2);
  } finally {
    app.unmount();
  }
});

it("ends a kept page whose use relation was withdrawn or bound to another panel", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownPanel(element);
    await router.push(at("summary"));
    await shownPanel(element);
    // The tasks page is now bound to the summary panel: the kept instance is not that page any more.
    uses = allUses.map(use => use.id === "use-tasks" ? { ...use, panelId: q.id } : use);
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(tasks.isConnected).toBe(false));
    const rebound = await shownPanel(element);
    expect([...rebound.querySelectorAll("[data-member]")].map(member => member.getAttribute("data-member"))).toEqual(["summary"]);
    expect(reopened()).toBe(0);
  } finally {
    app.unmount();
  }
});

it("keeps the shown page and the clean page left last, and makes room by the page left longest ago", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownPanel(element);
    await router.push(at("summary"));
    const summary = await shownPanel(element, tasks);
    await router.push(at("more"));
    const more = await shownPanel(element, summary);
    expect(tasks.isConnected).toBe(false);
    expect(panels(element)).toEqual([summary, more]);
    // Back and forth between the two kept pages keeps both.
    await router.push(at("summary"));
    await vi.waitFor(() => expect(shown(summary)).toBe(true));
    expect(panels(element)).toEqual([summary, more]);
    // A new page: the one left longest ago (more) makes room, not the page being left.
    await router.push(at("other"));
    await shownPanel(element, summary);
    expect(more.isConnected).toBe(false);
    expect(summary.isConnected).toBe(true);
    expect(panels(element)).toHaveLength(2);
  } finally {
    app.unmount();
  }
});

it("leaves a page with unsaved changes only through the platform's question, and its instance goes with them", async () => {
  const { app, element, router } = await openApplication(panelAddress(at("tasks"), deepState));
  try {
    const tasks = await shownPanel(element);
    const name = await vi.waitFor(() => {
      const input = tasks.querySelector<HTMLInputElement>("[data-member='form'] [data-field='/name'] input");
      if (!input) throw new Error("The form is not drawn yet");
      return input;
    });
    name.value = "Renamed by the reader";
    name.dispatchEvent(new Event("input"));
    await nextTick();

    // Cancelled: the reader stays on the page, with its changes.
    leaveAnswer = false;
    await router.push(at("summary"));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe(at("tasks"));
    expect(panels(element)).toEqual([tasks]);

    // Left without saving: the page's instance is gone, and coming back opens it afresh.
    leaveAnswer = true;
    await router.push(at("summary"));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(at("summary")));
    await vi.waitFor(() => expect(tasks.isConnected).toBe(false));
    await router.push(at("tasks"));
    const reopenedTasks = await shownPanel(element, tasks);
    expect(reopenedTasks).not.toBe(tasks);
  } finally {
    app.unmount();
  }
});

it("drops every kept page when the reader leaves the application", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownPanel(element);
    await router.push(at("summary"));
    const summary = await shownPanel(element);
    await router.push(`/applications/${appB}/summary`);
    const other = await shownPanel(element, summary);
    expect(tasks.isConnected).toBe(false);
    expect(summary.isConnected).toBe(false);
    expect(panels(element)).toEqual([other]);
  } finally {
    app.unmount();
  }
});

it("takes a kept author page's targets out of the document's stream, and puts them back when it is shown", async () => {
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  const streams: ProductDefinitionTarget[][] = [];
  const sent = installPlatform(request => {
    if (request.path === panelHostPaths.definitionStream) {
      streams.push((request.body as { targets: ProductDefinitionTarget[] }).targets);
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    }
    return answer(request);
  });
  const mode = { kind: "author", definitions: panelAuthorDefinitions() } as const;
  const showing = ref<"p" | "q">("p");
  const labels = { notStarted: "Not started", failures: { fileUnavailable: "File unavailable", scriptThrew: "Script threw", scriptRejected: "Script rejected" }, content: { htmlRemoved: "HTML removed", styleOutside: "Style outside" } };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => null } }] });
  await router.push("/");
  const page = mountPlatformPage(() => h("main", [
    h(PanelHost, { key: "p", port: platformPanelHost(appA, allUses[0]!, ignoreChanges, mode), address: allUses[0]!.path, labels, shown: showing.value === "p" }),
    h(PanelHost, { key: "q", port: platformPanelHost(appA, allUses[1]!, ignoreChanges, mode), address: allUses[1]!.path, labels, shown: showing.value === "q" }),
  ]), router);
  page.app.use(ElementPlus);
  const targetsOf = (panel: typeof p) => [{ kind: "panel", id: panel.id },
    ...new Set(Object.values(panel.manifest.members).flatMap(({ target }) =>
      "projectionId" in target ? [target.projectionId] : []))].map(target =>
    typeof target === "string" ? { kind: "projection", id: target } : target);
  try {
    await vi.waitFor(() => expect(streams.at(-1)).toEqual(targetsOf(p)));
    showing.value = "q";
    await vi.waitFor(() => expect(streams.at(-1)).toEqual(targetsOf(q)));
    showing.value = "p";
    await vi.waitFor(() => expect(streams.at(-1)).toEqual(targetsOf(p)));
    expect(sent.filter(request => request.path === panelHostPaths.definitionStream).length).toBe(streams.length);
  } finally {
    page.app.unmount();
    visible.mockRestore();
  }
});
