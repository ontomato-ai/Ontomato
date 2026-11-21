import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { ProductPanel, DirectProjection } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { panelAnswer, panelSnapshot, installPlatform, mountPlatformPage, nothingAt, panelUse, READER, type Sent } from "./panel-frame";

/*
 * A panel at its application's address (direct rendering design 5, 8): its component runs in the platform's own
 * document — no frame, no SDK build fetched — from its `#app` template, and each member reads what it shows through the
 * platform's read entry, within the panel's own application use, as the reader. A person's run-now is prepared by the
 * coordinator, confirmed and dispatched once by the host, and what the owner reports changed is read again. Choosing
 * another task changes the instance's state; it does not start another instance.
 *
 * Real route, panel host, SDK instance and components; the network is a stand-in.
 *
 * What this rules out: a panel put in a frame, or run after an SDK build is fetched for it; a member that
 * reads outside its use or for nothing selected; a write that bypasses the host's confirmation or runs twice; a change
 * the owner reported left on screen as it was; a new selection that rebuilds the panel.
 */

const application = "app-direct";
const use = panelUse("use-direct-tasks", "direct-tasks", "panel-direct-tasks", `/applications/${application}/tasks`);
const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const panel: ProductPanel = {
  ...base, id: use.panelId, name: "Scheduled tasks",
  content: {
    html: `<div id="app" class="tasks-page">
  <section v-if="chosen">
    <projection slot="form"></projection>
    <projection slot="run"></projection>
  </section>
</div>`,
    // The form and the button only once a task is chosen: the template reads the instance's state.
    module: `import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    return { chosen: computed(() => instance.state.values.value.selectedTask != null) };
  },
});`,
  },
  manifest: {
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: true, default: null } },
    members: {
      form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
      run: { target: { projectionId: "task-run" }, inputs: { task: { state: "selectedTask" } } },
    },
    commands: {},
  },
};
const projections: Record<string, DirectProjection> = {
  "task-form": {
    ...base, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
  },
  "task-run": {
    ...base, id: "task-run", name: "Run now", componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: { operation: "runNow" },
    data: {}, operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
  },
};
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const form = (name: string) => ({
  fields: [field("/name", "Name")], values: { name }, errors: [], revision: 3,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
});
const runNow = { kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const save = { kind: "form.save", handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const INTENT = "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05";
const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`)
    return panelSnapshot(panel, projections, request);
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection) return Response.json({ projection: projections[decodeURIComponent(projection[1]!)] });
  if (request.path === "/api/product-panels/read") {
    // The owner answers its form with the values it was asked with, when there are any (a draft's, an edit's).
    const { operations, memberPath, inputs } = request.body as {
      operations?: true; memberPath: [{ member: string }]; inputs: { task: { primaryKey: string } | null; values?: { name: string } };
    };
    // What the owners admit each member for a chosen task: the run, and the form's save; nothing while none is chosen.
    if (operations) return Response.json({ status: "ready", value: !inputs.task ? {} : memberPath[0].member === "run" ? { runNow } : { save } });
    return Response.json({ status: "ready", value: form(inputs.values?.name ?? `Task ${inputs.task!.primaryKey}`) });
  }
  if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft")
    return Response.json({ pageKey: use.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: "t-1" }, form: { name: "Drafted by an agent" } });
  if (request.path === "/api/panel-operations/intents")
    return Response.json({ intentId: INTENT, operationId: "run.runNow", label: "Run now", confirmation: { kind: "none" } });
  if (request.path === `/api/panel-operation-intents/${INTENT}`)
    return Response.json({ intentId: INTENT, operationId: "run.runNow", label: "Run now", confirmation: { kind: "none" } });
  if (request.path === `/api/panel-operations/intents/${INTENT}/dispatch`)
    return Response.json({ kind: "dispatched", intentId: INTENT, outcome: { kind: "success", data: {}, affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK] } } });
  return nothingAt(request);
}

async function open(address: string) {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId }),
  }] });
  await router.push(address);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  return { app, element, router, sent };
}

/** The data the page read: its members' operations, read for every member from the start, are not data. */
const reads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read")
  .map(request => request.body as { source: unknown; memberPath: unknown; dataName?: string; inputs: { task?: { primaryKey: string } } })
  .filter(read => read.dataName !== undefined);

afterEach(() => {
  document.body.innerHTML = "";
});

it("runs a panel in the platform's document and reads its members within its use, as the reader", async () => {
  const { app, element, sent } = await open(panelAddress(use.path, { selectedTask: task("t-1") }));
  try {
    await vi.waitFor(() => expect(element.querySelector('[data-member="form"] [data-field="/name"] input')).not.toBeNull());
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector(".tasks-page")).not.toBeNull();
    // A panel run in the platform's document needs no SDK build: the host never asks where the SDK is served.
    expect(sent.some(request => request.path === "/api/apps-sdk/current")).toBe(false);
    expect(reads(sent).find(read => read.dataName === "form")).toEqual({
      source: { kind: "registered", applicationId: application, useId: use.id },
      memberPath: [{ member: "form" }], dataName: "form", inputs: { task: task("t-1"), changedField: null },
    });
    expect(sent.filter(request => request.path.startsWith("/api/")).every(request => request.credential === READER)).toBe(true);
  } finally {
    app.unmount();
  }
});

it("shows nothing selected-only until a task is chosen, without reading for nothing", async () => {
  const { app, element, sent } = await open(use.path);
  try {
    await vi.waitFor(() => expect(element.querySelector(".tasks-page")).not.toBeNull());
    await nextTick();
    expect(element.querySelector('[data-member="form"]')).toBeNull();
    expect(reads(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("runs run-now once through the host's confirmation and reads again what the owner reports changed", async () => {
  const { app, element, sent } = await open(panelAddress(use.path, { selectedTask: task("t-1") }));
  try {
    await vi.waitFor(() => expect(element.querySelector('[data-member="form"] [data-field="/name"] input')).not.toBeNull());
    const button = await vi.waitFor(() => {
      const found = element.querySelector<HTMLButtonElement>('[data-member="run"] button');
      if (!found || found.disabled) throw new Error("Run now is not ready");
      return found;
    });
    const formReads = () => reads(sent).filter(read => read.dataName === "form").length;
    const before = formReads();
    button.click();
    await vi.waitFor(() => expect(formReads()).toBe(before + 1));
    // Once: what the receipt reports changed reaches the instance through the host's one change port, not twice.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(formReads()).toBe(before + 1);
    expect(sent.filter(request => request.path.endsWith("/dispatch")).map(request => request.method)).toEqual(["POST"]);
    expect(sent.find(request => request.path === `/api/panel-operation-intents/${INTENT}`)?.search)
      .toBe(`?${new URLSearchParams({ applicationId: application, useId: use.id })}`);
  } finally {
    app.unmount();
  }
});

it("follows another chosen task in the same instance, reading the form for it", async () => {
  const { app, element, router, sent } = await open(panelAddress(use.path, { selectedTask: task("t-1") }));
  try {
    await vi.waitFor(() => expect(element.querySelector('[data-member="form"] [data-field="/name"] input')).not.toBeNull());
    const page = element.querySelector(".tasks-page");
    const projectionReads = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    await router.push(panelAddress(use.path, { selectedTask: task("t-2") }));
    await vi.waitFor(() => expect(reads(sent).some(read => read.dataName === "form" && read.inputs.task?.primaryKey === "t-2")).toBe(true));
    // The same instance: its element stays in place and its members' projections are not read again.
    expect(element.querySelector(".tasks-page")).toBe(page);
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/")).length).toBe(projectionReads);
  } finally {
    app.unmount();
  }
});

it("takes the draft its address links into the member's form, as a frame's form does", async () => {
  const draft = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
  const { app, element, sent } = await open(panelAddress(`${use.path}?${draft}`, { selectedTask: task("t-1") }));
  try {
    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-member="form"] [data-field="/name"] input')?.value)
      .toBe("Drafted by an agent"));
    expect(sent.find(request => request.path.endsWith("/page-draft"))).toMatchObject({
      method: "GET", search: `?${new URLSearchParams({ path: "outputs/drafts/task.page-draft.json" })}`, credential: READER,
    });
  } finally {
    app.unmount();
  }
});
