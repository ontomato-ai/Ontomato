import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import ElementPlus from "element-plus";
import { PANEL_HOST_CHANNEL, panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import type { ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { PanelHost, provideUnsavedChanges } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { panelAuthorDefinitions, panelHostPaths, platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges,
  currentSdk, hostMessageOf, inside, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt, panelRecord,
  panelSnapshot, panelUse, projections, SCHEDULED_TASK, task, taskForm, writeFrameDocument, type Sent,
} from "./panel-frame";

/*
 * A panel application's recent pages kept across page switches (design 7.2.1), through the platform's own route, panel
 * host, app host and bridge, with the SDK running the first page's frame. Only the network is a stand-in.
 *
 * What this rules out: going A→B→A rebuilding A's frame and loading its SDK again; a page shown again before its objects
 * are read, or held back until its definition check answers; a changed definition kept on screen, or adopted over an
 * unsaved form; an unsaved page dropped to make room; a kept page that still holds a stream, asks the platform for
 * anything new or moves the address; and kept pages surviving the reader leaving their application.
 */

const appA = "app-keep-a";
const appB = "app-keep-b";
const trial = join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/apps-sdk/examples/panels/schedules-trial");
let p = panelRecord("panel-keep-p", "Tasks", manifestP);
const q = panelRecord("panel-keep-q", "Summary", manifestQ);
p.content.html = readFileSync(join(trial, "p/panel.html"), "utf8");
q.content.html = readFileSync(join(trial, "q/panel.html"), "utf8");
const at = (path: string) => `/applications/${appA}/${path}`;
const allUses = [
  panelUse("use-tasks", "keep-tasks", p.id, at("tasks")),
  panelUse("use-summary", "keep-summary", q.id, at("summary")),
  panelUse("use-more", "keep-more", p.id, at("more")),
  panelUse("use-other", "keep-other", q.id, at("other")),
];
/** The relations Java answers now, and the task the owner answers now: tests change them while a page is kept. */
let uses = allUses;
let shownTask = task;
const taskPath = "/api/data-query/platform/scheduled-tasks";
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const secondTask = { ...task, id: "ac186b00-a3dd-46d2-b404-72065d877a34", title: "Second scheduled task" };

/** Holds P's definition check until the test lets it answer. */
let snapshotGate: Promise<void> | null = null;
/** The reader's answer to the platform's unsaved-changes question. */
let leaveAnswer = true;
const asked = vi.fn(async () => leaveAnswer);

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${appA}/panel-uses`)
    return Response.json({ data: { applicationId: appA, entry: { path: `/applications/${appA}`, renderer: "panels" }, panelUses: uses } });
  if (request.path === `/api/data-query/platform/applications/${appB}/panel-uses`)
    return Response.json({ data: { applicationId: appB, entry: { path: `/applications/${appB}`, renderer: "panels" },
      panelUses: [panelUse("use-b", "keep-b", q.id, `/applications/${appB}/summary`)] } });
  if (request.path === `/api/product-panels/${p.id}`) return Response.json({ panel: p });
  if (request.path === `/api/product-panels/${q.id}`) return Response.json({ panel: q });
  if (request.path === `/api/product-panels/${p.id}/snapshot`) {
    const shown = p;
    return (snapshotGate ?? Promise.resolve()).then(() => panelSnapshot(shown));
  }
  if (request.path === `/api/product-panels/${q.id}/snapshot`) return panelSnapshot(q);
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === taskPath) return Response.json({ tasks: [task, secondTask], timeZone: task.timeZone });
  if (request.path === `${taskPath}/${task.id}`) return Response.json(shownTask);
  if (request.path === `${taskPath}/${secondTask.id}`) return Response.json(secondTask);
  if (request.path === `${taskPath}/applications/${task.appId}/form`)
    return Response.json({ ...taskForm, values: (request.body as { values: typeof taskForm.values }).values });
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

/** Every load of a frame's document: a node kept in place may still have its document loaded again. */
function documentLoads(frame: HTMLIFrameElement) {
  const loads: string[] = [];
  frame.addEventListener("load", () => loads.push(frame.srcdoc));
  new MutationObserver(() => loads.push(frame.srcdoc)).observe(frame, { attributes: true, attributeFilter: ["srcdoc"] });
  return loads;
}

const reopened = () => performance.getEntriesByName("ontomato:panel-page-reopened").length;

const frames = (element: HTMLElement) => [...element.querySelectorAll<HTMLIFrameElement>("iframe.panel-host-frame")];
const shown = (frame: HTMLIFrameElement) => frame.closest<HTMLElement>(".panel-host")!.style.display !== "none";
const shownFrame = (element: HTMLElement) => vi.waitFor(() => {
  const found = frames(element).find(frame => shown(frame) && frame.getAttribute("srcdoc"));
  if (!found) throw new Error("No page is shown");
  return found;
});

/** Runs the SDK in a frame the host drew, as its browser would. */
async function startFrame(frame: HTMLIFrameElement) {
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const { contextTransport } = await import("../../../../../packages/apps-sdk/src/context");
  const vue = await import("vue");
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  const mounted = await mountPanel({ setup: () => ({}) });
  return { ...mounted, ref: vue.ref, transport: contextTransport(mounted.appContext) };
}

/** What a frame says to its host, as a frame the SDK does not run in this test would say it. */
function fromFrame(frame: HTMLIFrameElement, message: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: PANEL_HOST_CHANNEL, ...message } }));
}

/** Resolves once the given frame has told its host it holds unsaved changes. */
const unsavedSaid = (frame: HTMLIFrameElement) => new Promise<void>(resolve => window.addEventListener("message", event => {
  if (event.source === frame.contentWindow && event.data?.kind === "dirty" && event.data.dirty) resolve();
}));

afterEach(() => {
  snapshotGate = null;
  leaveAnswer = true;
  asked.mockClear();
  uses = allUses;
  shownTask = task;
  p = { ...p, revision: 1, content: { ...p.content, html: readFileSync(join(trial, "p/panel.html"), "utf8") } };
  performance.clearMarks();
  leaveFrame();
  vi.resetModules();
});

it("shows a page kept within its application as it was left: no document loaded again, no SDK loaded again", async () => {
  const { app, element, router, sent } = await openApplication(panelAddress(at("tasks"), deepState));
  try {
    const tasks = await shownFrame(element);
    const loads = documentLoads(tasks);
    // A kept frame is never taken out of the document: a browser loads a moved frame again.
    const moved: Node[] = [];
    new MutationObserver(records => records.forEach(record => moved.push(...record.removedNodes))).observe(element, { childList: true, subtree: true });
    const { transport } = await startFrame(tasks);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    const srcdoc = tasks.srcdoc;

    await router.push(at("summary"));
    const summary = await shownFrame(element);
    expect(summary).not.toBe(tasks);
    expect(shown(tasks)).toBe(false);

    // The kept page asks the platform for nothing new, and what it reports does not move the reader's address.
    const before = sent.length;
    await expect(transport.request(`${taskPath.slice("/api/data-query".length)}/${task.id}`, {}, "/data-query")).rejects.toThrow("This page is not shown");
    fromFrame(tasks, { kind: "state", fromAddress: hostMessageOf(srcdoc).url, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } } });
    fromFrame(tasks, { kind: "dirty", dirty: true });
    fromFrame(tasks, { kind: "dirty", dirty: false });
    await nextTick();
    expect(sent.length).toBe(before);
    expect(router.currentRoute.value.fullPath).toBe(at("summary"));
    expect(asked).not.toHaveBeenCalled();

    // Back by its bare address: the same frame is shown at once, at the state it was left at — but it asks for nothing
    // until its relation and its definitions have been checked.
    let release!: () => void;
    snapshotGate = new Promise(resolve => (release = resolve));
    const taskReads = () => sent.filter(request => request.path === `${taskPath}/${task.id}`).length;
    const readsBefore = taskReads();
    await router.push(at("tasks"));
    await nextTick();
    expect(shown(tasks)).toBe(true);
    expect(shown(summary)).toBe(false);
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(at("tasks"));
      expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual(deepState);
    });
    await vi.waitFor(() => expect(sent.filter(request => request.path.endsWith("/panel-uses"))).toHaveLength(2));
    await expect(transport.request(`${taskPath.slice("/api/data-query".length)}/${task.id}`, {}, "/data-query")).rejects.toThrow("This page is not shown");
    expect(taskReads()).toBe(readsBefore);
    expect(reopened()).toBe(0);

    // Checked: the frame may ask again, and its objects are read again whether or not anything changed.
    release();
    await vi.waitFor(() => expect(reopened()).toBe(1));
    await vi.waitFor(() => expect(taskReads()).toBeGreaterThan(readsBefore));
    // The relation and the definitions were checked side by side; the record and the SDK were not read again.
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}/snapshot`)).toHaveLength(2);
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}`)).toHaveLength(1);
    expect(sent.filter(request => request.path === "/api/apps-sdk/current")).toHaveLength(2);
    expect(frames(element)).toEqual([tasks, summary]);
    expect(tasks.srcdoc).toBe(srcdoc);
    expect(loads).toEqual([]);
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
    const tasks = await shownFrame(element);
    await startFrame(tasks);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    await router.push(at("summary"));
    await shownFrame(element);
    // An agent renames the task while the page is kept: nothing is sent to the kept frame for it.
    shownTask = { ...task, revision: task.revision + 1, title: "Renamed while away" };
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe("Renamed while away"));
  } finally {
    app.unmount();
  }
});

it("loads a kept page's current definition when it changed while the reader was away", async () => {
  const { app, element, router, sent } = await openApplication(at("tasks"));
  try {
    const tasks = await shownFrame(element);
    await startFrame(tasks);
    await router.push(at("summary"));
    await shownFrame(element);
    p = { ...p, revision: 2, content: { ...p.content, html: `${p.content.html}<p id="rearranged"></p>` } };
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(hostMessageOf(tasks.srcdoc).panel.content.html).toContain('id="rearranged"'));
    expect(sent.filter(request => request.path === `/api/product-panels/${p.id}`)).toHaveLength(2);
  } finally {
    app.unmount();
  }
});

it("ends a kept page whose use relation was withdrawn or bound to another panel", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownFrame(element);
    await router.push(at("summary"));
    await shownFrame(element);
    // The tasks page is now bound to the summary panel: the kept instance is not that page any more.
    uses = allUses.map(use => use.id === "use-tasks" ? { ...use, panelId: q.id } : use);
    await router.push(at("tasks"));
    await vi.waitFor(() => expect(tasks.isConnected).toBe(false));
    const rebound = await shownFrame(element);
    await vi.waitFor(() => expect(hostMessageOf(rebound.srcdoc).pageKey).toBe("keep-tasks"));
    expect(hostMessageOf(rebound.srcdoc).panel.manifest).toEqual(q.manifest);
    expect(reopened()).toBe(0);
  } finally {
    app.unmount();
  }
});

it("keeps the shown page and the clean page left last, and makes room by the page left longest ago", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownFrame(element);
    await router.push(at("summary"));
    const summary = await shownFrame(element);
    await router.push(at("more"));
    const more = await shownFrame(element);
    expect(tasks.isConnected).toBe(false);
    expect(frames(element)).toEqual([summary, more]);
    // Back and forth between the two kept pages keeps both.
    await router.push(at("summary"));
    await vi.waitFor(() => expect(shown(summary)).toBe(true));
    expect(frames(element)).toEqual([summary, more]);
    // A new page: the one left longest ago (more) makes room, not the page being left.
    await router.push(at("other"));
    await shownFrame(element);
    expect(more.isConnected).toBe(false);
    expect(summary.isConnected).toBe(true);
    expect(frames(element)).toHaveLength(2);
  } finally {
    app.unmount();
  }
});

it("leaves a page with unsaved changes only through the platform's question, and its instance goes with them", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownFrame(element);
    const { context, ref: frameRef } = await startFrame(tasks);
    const said = unsavedSaid(tasks);
    context.holdUnsaved(frameRef(true));
    await said;

    // Cancelled: the reader stays on the page, with its changes.
    leaveAnswer = false;
    await router.push(at("summary"));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe(at("tasks"));
    expect(frames(element)).toEqual([tasks]);

    // Left without saving: the page's instance is gone, and coming back opens it afresh.
    leaveAnswer = true;
    await router.push(at("summary"));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(at("summary")));
    await vi.waitFor(() => expect(tasks.isConnected).toBe(false));
    await router.push(at("tasks"));
    const reopenedTasks = await shownFrame(element);
    expect(reopenedTasks).not.toBe(tasks);
  } finally {
    app.unmount();
  }
});

it("drops every kept page when the reader leaves the application", async () => {
  const { app, element, router } = await openApplication(at("tasks"));
  try {
    const tasks = await shownFrame(element);
    await router.push(at("summary"));
    const summary = await shownFrame(element);
    await router.push(`/applications/${appB}/summary`);
    const other = await shownFrame(element);
    expect(tasks.isConnected).toBe(false);
    expect(summary.isConnected).toBe(false);
    expect(frames(element)).toEqual([other]);
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
  const labels = { notStarted: "Not started", failures: { fileUnavailable: "File unavailable", scriptThrew: "Script threw", scriptRejected: "Script rejected" } };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => null } }] });
  await router.push("/");
  const page = mountPlatformPage(() => h("main", [
    h(PanelHost, { key: "p", port: platformPanelHost(appA, allUses[0]!, ignoreChanges, mode), address: allUses[0]!.path, labels, shown: showing.value === "p" }),
    h(PanelHost, { key: "q", port: platformPanelHost(appA, allUses[1]!, ignoreChanges, mode), address: allUses[1]!.path, labels, shown: showing.value === "q" }),
  ]), router);
  page.app.use(ElementPlus);
  const targetsOf = (panel: typeof p) => [{ kind: "panel", id: panel.id },
    ...new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId))].map(target =>
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
