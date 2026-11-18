import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { PanelFrameMessage } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { platformLayoutRoute } from "../../../../../packages/platform-web/src/layout-route";
import {
  hostMessageOf, idlePanelSubscription, inspectionTaskForm, inside, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt,
  panelHostFrame, panelRecord, panelUse, projections, READER, run, SCHEDULED_TASK, task, taskForm, writeFrameDocument,
  type Sent,
} from "./panel-frame";

const appA = "app-panels-trial-a";
const appB = "app-panels-trial-b";
const panelPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/apps-sdk/examples/panels/schedules-trial");
const p = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const q = panelRecord("panel-schedules-summary", "Trial panel Q", manifestQ);
p.content.html = readFileSync(join(panelPath, "p/panel.html"), "utf8");
q.content.html = readFileSync(join(panelPath, "q/panel.html"), "utf8");
const useP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", p.id, "/tasks");
const useQ = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, "/summary");
const taskPath = "/api/data-query/platform/scheduled-tasks";
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const secondTask = { ...task, id: "ac186b00-a3dd-46d2-b404-72065d877a34", title: "Second scheduled task" };

function answer(request: Sent) {
  if (request.path === "/api/data-query/platform/applications") return Response.json({ success: true, data: [appA, appB].map(id => ({
    id, kind: "product", names: { en: id }, descriptions: {}, icon: "schedules",
    rail: "apps", category: "business", sort: 0, entry: { path: `/${id.slice(4)}`, renderer: "panels" },
    entryAccess: ["domain-member"], scheduleAdapter: null, releaseId: null,
  })) });
  const applicationId = [appA, appB].find(id => request.path === `/api/data-query/platform/applications/${id}/panel-uses`);
  if (applicationId) return Response.json({ data: {
    applicationId, entry: { path: "/", renderer: "panels" }, panelUses: [applicationId === appA ? useP : useQ],
  } });
  const panel = [p, q].find(panel => request.path === `/api/product-panels/${panel.id}`);
  if (panel) return Response.json({ panel });
  const projection = Object.values(projections).find(projection => request.path === `/api/product-projections/${projection.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/apps-sdk/current") return Response.json({
    version: "1.1.1", publicBasePath: "/apps-sdk", sdkBasePath: "/apps-sdk/1.1.1",
    manifestPath: "/apps-sdk/1.1.1/sdk.json", docsPath: "/apps-sdk/1.1.1/docs", referencePath: "/apps-sdk/1.1.1/reference",
  });
  if (request.path === "/api/product-assets/subscriptions") return idlePanelSubscription();
  if (request.path === "/api/product-assets/subscriptions/subscription-1") return new Response(null, { status: 204 });
  if (request.path === taskPath) return Response.json({ tasks: [task], timeZone: task.timeZone });
  if (request.path === `${taskPath}/${task.id}`) return Response.json(task);
  if (request.path === `${taskPath}/${secondTask.id}`) return Response.json(secondTask);
  if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") return Response.json({
    pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: task.id },
    form: { ...task.content, caseSetId: "set-smoke" },
  });
  if (request.path === `${taskPath}/applications/${task.appId}/form`) return Response.json(taskForm);
  return nothingAt(request);
}

async function open(address: string, usePlatformRoutes = false, reply = answer) {
  const sent = installPlatform(reply);
  if (usePlatformRoutes) await useApplicationCatalog().refresh();
  const router = createRouter({ history: createMemoryHistory(), routes: usePlatformRoutes ? [platformLayoutRoute([])] : [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: true,
  }] });
  await router.push(address);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  const frame = await panelHostFrame();
  return { app, element, frame, router, sent };
}

async function startFrame(frame: HTMLIFrameElement) {
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  return mountPanel({ setup: () => ({}) });
}

afterEach(() => {
  leaveFrame();
  // Each real frame starts with its own SDK modules and registries.
  vi.resetModules();
});

it("opens the first visible use at its own URL when entering a panel application", async () => {
  const { app, frame, router, sent } = await open(`/applications/${appB}`, true);
  try {
    expect(hostMessageOf(frame.srcdoc).pageKey).toBe(useQ.pageKey);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/applications/${appB}/summary`));
    expect(sent.some(request => request.path.endsWith("/policy"))).toBe(false);
  } finally {
    app.unmount();
  }
});

it("updates shared summary X from P's selection and opens the next application's panel in the same route", async () => {
  const { app, element, frame, router, sent } = await open(`/applications/${appA}/tasks`);
  try {
    const operations: PanelFrameMessage[] = [];
    const listener = (event: MessageEvent) => {
      if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "operations") operations.push(event.data);
    };
    window.addEventListener("message", listener);
    try {
      const { context } = await startFrame(frame);
      const option = await vi.waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>('#app [role="option"]');
        expect(button?.textContent).toContain(task.title);
        return button!;
      });
      option.click();
      await vi.waitFor(() => {
        expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
        expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
      });
      expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toHaveLength(2);
      expect(operations.some(message => message.kind === "operations" && message.operations.some(operation => operation.kind === "form.save"))).toBe(true);
      expect(router.currentRoute.value.query.state).toBe(JSON.stringify(deepState));

      const samePage = `/applications/${appA}/tasks`;
      await router.push(panelAddress(samePage, { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } }));
      await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(secondTask.title));
      expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
      expect(router.currentRoute.value.query.state).toContain(secondTask.id);

      const draftQuery = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
      await router.push(panelAddress(`${samePage}?${draftQuery}`, context.instance.deepLink()));
      await vi.waitFor(() => expect(context.draft.value?.form.caseSetId).toBe("set-smoke"));
      expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
      expect(sent.some(request => request.method === "PUT")).toBe(false);

      await router.push(`/applications/${appB}/summary`);
      await vi.waitFor(() => {
        const next = element.querySelector<HTMLIFrameElement>("iframe.panel-host-frame");
        expect(next?.srcdoc).toContain(useQ.pageKey);
      });
      expect(element.querySelector('[role="alert"]')).toBeNull();
    } finally {
      window.removeEventListener("message", listener);
    }
  } finally {
    app.unmount();
  }
});

it("mounts Q at its deep-linked task and reads X over the real bridge", async () => {
  const { app, element, frame, sent } = await open(panelAddress(`/applications/${appB}/summary`, deepState));
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toMatchObject([{ method: "GET", credential: READER }]);
    expect(context.instance.deepLink()).toEqual(deepState);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  } finally {
    app.unmount();
  }
});

it("shows the script's actual error when the browser reports a generic message", async () => {
  const { app, element, frame } = await open(`/applications/${appB}/summary`);
  try {
    const bootstrap = frame.srcdoc.match(/<script>\n([\s\S]*?)<\/script>/)![1]!;
    inside(frame.contentWindow!);
    const frameEvents = new EventTarget();
    Object.assign(frameEvents, { parent: window.parent });
    new Function("window", bootstrap)(frameEvents);
    frameEvents.dispatchEvent(new ErrorEvent("error", {
      message: "Uncaught",
      error: new Error("The panel's script failed during setup"),
    }));
    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe("The panel's script failed during setup"));
  } finally {
    app.unmount();
  }
});

it("refreshes X from the owner after the panel's form saves", async () => {
  let current = task;
  const before = panelAddress(`/applications/${appA}/tasks`, deepState);
  const { app, frame, sent } = await open(before, false, request => {
    if (request.path === `${taskPath}/${task.id}/runs`) {
      current = { ...current, summary: [{ key: "run", label: "Run", value: "Run started" }] };
      return Response.json(run, { status: 202 });
    }
    if (request.path === `${taskPath}/${task.id}`) {
      if (request.method === "PUT") {
        current = { ...current, revision: current.revision + 1,
          summary: [{ key: "instruction", label: "Instruction", value: "Saved instruction" }] };
      }
      return Response.json(current);
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const definitions = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    await context.instance.invoke("form.save");
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Saved instruction"));
    document.querySelector<HTMLButtonElement>(".sdk-operation-button button")!.click();
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Run started"));
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/"))).toHaveLength(definitions);
  } finally {
    app.unmount();
  }
});

function taskFormFor(values: typeof taskForm.values) {
  const fields = taskForm.fields.map(field => field.type === "select" && field.key === "caseSetId"
    ? { ...field, options: [...field.options, ...["set-smoke", "agent-cases", "agent-later"].map(value => ({
      value, label: value, description: null, disabled: false, disabledReason: null,
    }))] }
    : field);
  return Response.json({ ...taskForm, fields, values });
}

it("opens the saved draft's old link as an ordinary panel", async () => {
  let current = task;
  const path = `/applications/${appA}/tasks`;
  const draftQuery = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
  const draftAddress = panelAddress(`${path}?${draftQuery}`, deepState);
  const { app, element, frame, router, sent } = await open(draftAddress, false, request => {
    if (request.path === `${taskPath}/${task.id}`) {
      if (request.method === "PUT") {
        current = { ...current, revision: current.revision + 1, content: (request.body as { content: typeof task.content }).content };
      }
      return Response.json(current);
    }
    if (request.path === `${taskPath}/applications/${task.appId}/form`) {
      const body = request.body as { values: typeof taskForm.values };
      return taskFormFor(body.values);
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain("caseSetId"));
    await context.instance.invoke("form.save");
    expect(current.content.caseSetId).toBe("set-smoke");
    await vi.waitFor(() => expect(context.draft.value).toBeNull());

    await router.push(panelAddress(path, deepState));
    await vi.waitFor(() => expect(context.instance.pageContext.value.url).not.toContain("draftSessionId"));
    await router.push(draftAddress);
    await vi.waitFor(() => {
      expect(sent.filter(request => request.path.endsWith("/page-draft"))).toHaveLength(2);
      expect(sent.filter(request => request.path.endsWith("/form")).at(-1)?.body).toMatchObject({ values: current.content });
    });
    // Let the adapter consume the reread owner's form before checking that the draft stayed empty.
    await vi.waitFor(() => {
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
      expect([...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].map(button => button.disabled))
        .toEqual([true, true]);
    });
    expect(element.querySelector(".panel-host-error")?.textContent).toBeUndefined();
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
    expect(sent.filter(request => request.method === "PUT")).toHaveLength(1);
  } finally {
    app.unmount();
  }
});

it("refreshes an open panel from the server stream and preserves a dirty form until discard", async () => {
  let current = task;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const address = `/applications/${appA}/tasks`;
  const { app, element, frame, router, sent } = await open(panelAddress(address, deepState), false, request => {
    if (request.path === "/api/product-assets/subscriptions") return new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller; },
    }), { headers: { "content-type": "text/event-stream" } });
    if (request.path === `${taskPath}/${task.id}`) return Response.json(current);
    if (request.path === `${taskPath}/applications/${task.appId}/form`) {
      return taskFormFor((request.body as { values: typeof taskForm.values }).values);
    }
    return answer(request);
  });
  const formReads = () => sent.filter(request => request.path.endsWith("/form"));
  const dataReads = () => sent.filter(request => request.path === `${taskPath}/${task.id}`);
  const notify = (objectType = SCHEDULED_TASK, primaryKey = task.id) =>
    stream.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "object-changed", target: { objectType, primaryKey } })}\n\n`));
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const definitions = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    const before = dataReads().length;
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-cases" },
      summary: [{ key: "instruction", label: "Instruction", value: "Agent changed saved data" }] };
    notify("platform:Other");
    notify(SCHEDULED_TASK, secondTask.id);
    notify();
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Agent changed saved data");
      expect(formReads().at(-1)?.body).toMatchObject({ values: current.content });
    });
    expect(dataReads()).toHaveLength(before + 2);

    const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
    await router.push(panelAddress(`${address}?${query}`, deepState));
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent).toContain("caseSetId"));
    const editing = formReads().length;
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-later" },
      summary: [{ key: "instruction", label: "Instruction", value: "Agent changed it again" }] };
    notify();
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Agent changed it again"));
    expect(formReads()).toHaveLength(editing);
    expect(context.instance.dirty()).toBe(true);
    expect(context.draft.value?.form.caseSetId).toBe("set-smoke");

    const discard = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find(button => button.textContent?.trim() === "Discard")!;
    discard.click();
    await vi.waitFor(() => expect(formReads().at(-1)?.body).toMatchObject({ values: current.content }));
    expect(context.instance.dirty()).toBe(false);
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/"))).toHaveLength(definitions);
    expect(sent.filter(request => request.path === "/api/product-assets/subscriptions")).toHaveLength(1);
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
  } finally {
    app.unmount();
    stream.close();
  }
});

it("reconnects after EOF, reconciles missed changes, and stops on unmount", async () => {
  let current = task;
  let panel = p;
  let summary = projections["projection-schedules-summary"]!;
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();
  const { app, element, frame, sent } = await open(panelAddress(`/applications/${appA}/tasks`, deepState), false, request => {
    if (request.path === "/api/product-assets/subscriptions") return new Response(new ReadableStream<Uint8Array>({
      start(controller) { streams.push(controller); },
    }), { headers: { "content-type": "text/event-stream" } });
    if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    if (request.path === `${taskPath}/${task.id}`) return Response.json(current);
    if (request.path === `${taskPath}/applications/${task.appId}/form`)
      return taskFormFor((request.body as { values: typeof taskForm.values }).values);
    return answer(request);
  });
  const definitionReads = () => sent.filter(request => /\/api\/product-(panels|projections)\//.test(request.path));
  const formReads = () => sent.filter(request => request.path.endsWith("/form"));
  const snapshot = (stream: ReadableStreamDefaultController<Uint8Array>) => stream.enqueue(encoder.encode(`data: ${JSON.stringify({
    kind: "snapshot", panel: { id: panel.id, revision: panel.revision },
    projections: Object.values(projections).map(projection => ({
      id: projection.id, revision: projection.id === summary.id ? summary.revision : projection.revision,
    })),
  })}\n\n`));
  try {
    snapshot(streams[0]!);
    await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const initialDefinitions = definitionReads().length;
    const initialForms = formReads().length;
    streams[0]!.close();
    summary = { ...summary, revision: summary.revision + 1, display: { fields: ["settings"] } };
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-cases" },
      summary: [{ key: "instruction", label: "Instruction", value: "Changed while disconnected" }] };

    await vi.waitFor(() => expect(streams).toHaveLength(2));
    snapshot(streams[1]!);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Changed while disconnected");
      expect(document.querySelector(".sdk-object-summary dt")?.textContent).toBe("settings");
      expect(formReads().at(-1)?.body).toMatchObject({ values: current.content });
    });
    expect(formReads()).toHaveLength(initialForms + 1);
    expect(definitionReads().slice(initialDefinitions).map(request => request.path)).toEqual([
      `/api/product-projections/${summary.id}`,
    ]);
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
    expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toHaveLength(4);

    panel = { ...p, revision: p.revision + 1 };
    streams[1]!.close();
    await vi.waitFor(() => expect(streams).toHaveLength(3));
    snapshot(streams[2]!);
    await vi.waitFor(() => expect(hostMessageOf(frame.srcdoc).panel.revision).toBe(panel.revision));
    expect(definitionReads().slice(initialDefinitions).map(request => request.path)).toEqual([
      `/api/product-projections/${summary.id}`, `/api/product-panels/${panel.id}`,
    ]);
  } finally {
    app.unmount();
    if (streams.length > 1) streams.at(-1)!.close();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(streams).toHaveLength(3);
});

it.each([true, false])("resolves a panel draft through the bridge with created=%s", async created => {
  const path = `/applications/${appA}/tasks`;
  const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } };
  const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
  const { app, element, frame, router, sent } = await open(panelAddress(path, selected), false, request => {
    if (request.path.endsWith("/page-draft")) return Response.json({
      pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: {},
      form: { ...task.content, caseSetId: "set-smoke" },
      ...(created ? { created: { id: task.id } } : {}),
    });
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull());
    const taskReads = () => sent.filter(request => request.method === "GET" && request.path.startsWith(`${taskPath}/`));
    const initialReads = taskReads().length;
    await router.push(panelAddress(`${path}?${query}`, selected));
    if (created) {
      await vi.waitFor(() => {
        expect(context.draft.value?.target.id).toBe(task.id);
        expect(context.instance.deepLink()).toEqual(deepState);
        expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain("caseSetId");
      });
      const addressedReads = taskReads().slice(initialReads);
      expect(addressedReads).not.toHaveLength(0);
      expect(addressedReads.every(request => request.path === `${taskPath}/${task.id}`)).toBe(true);
    } else {
      await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent)
        .toBe("This panel's form does not create objects"));
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(context.instance.deepLink()).toEqual(selected);
      expect(taskReads()).toHaveLength(initialReads);
    }
    expect(sent.filter(request => request.method === "PUT")).toEqual([]);
  } finally {
    app.unmount();
  }
});

it.each([
  { name: "revision outside the form", extra: { revision: 7 }, invalid: "revision" },
  { name: "a removed field", extra: { caseSetId: task.content.caseSetId }, invalid: "caseSetId" },
  { name: "fields of the refreshed form", extra: {}, invalid: null },
])("validates draft $name after asking the owner for the dependent form", async ({ extra, invalid }) => {
  const path = `/applications/${appA}/tasks`;
  const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/inspection.page-draft.json" });
  const drafted = { operation: "inspection", instruction: "Inspect the latest failures", ...extra };
  const formPath = `${taskPath}/applications/${task.appId}/form`;
  const { app, element, frame, router, sent } = await open(panelAddress(path, deepState), false, request => {
    if (request.path.endsWith("/page-draft")) return Response.json({
      pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: task.id }, form: drafted,
    });
    if (request.path === formPath) {
      const { values, changedField } = request.body as {
        values: { operation: string; instruction?: string }; changedField: string | null;
      };
      if (changedField === "operation")
        return Response.json({ ...inspectionTaskForm, values: { operation: values.operation, instruction: values.instruction }, submittable: true });
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector('.sdk-owner-form [data-field="caseSetId"]')).not.toBeNull());
    await router.push(panelAddress(`${path}?${query}`, deepState));
    await vi.waitFor(() => expect(sent.filter(request => request.path === formPath)
      .some(request => (request.body as { changedField?: string }).changedField === "operation")).toBe(true));
    if (invalid) {
      await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent ?? "")
        .toContain(`Draft fields not in the current form: ${invalid}`));
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
      expect([...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].every(button => button.disabled)).toBe(true);
    } else {
      await vi.waitFor(() => {
        expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain("operation, instruction");
        expect(document.querySelector<HTMLTextAreaElement>('[data-field="instruction"] textarea')?.value).toBe(drafted.instruction);
        expect(document.querySelector('.sdk-owner-form [data-field="caseSetId"]')).toBeNull();
      });
      const save = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
        .find(button => button.textContent?.trim() === "Save");
      expect(save?.disabled).toBe(false);
    }
    expect(sent.filter(request => request.method === "PUT")).toEqual([]);
  } finally {
    app.unmount();
  }
});
