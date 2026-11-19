import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { DirectPanel, DirectProjection } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, mountPlatformPage, nothingAt, panelUse, READER, type Sent } from "./panel-frame";

/*
 * A panel without code at its application's address (direct rendering design 5, 8): the platform draws it in its own
 * document — no frame, no SDK build fetched — from its layout, and each member reads what it shows through the
 * platform's read entry, within the panel's own application use, as the reader. A person's run-now is prepared by the
 * coordinator, confirmed and dispatched once by the host, and what the owner reports changed is read again. Choosing
 * another task changes the instance's state; it does not start another instance.
 *
 * Real route, panel host, SDK instance and components; the network is a stand-in.
 *
 * What this rules out: a panel without code put in a frame, or drawn after an SDK build is fetched for it; a member that
 * reads outside its use or for nothing selected; a write that bypasses the host's confirmation or runs twice; a change
 * the owner reported left on screen as it was; a new selection that rebuilds the panel.
 */

const application = "app-direct";
const use = panelUse("use-direct-tasks", "direct-tasks", "panel-direct-tasks", `/applications/${application}/tasks`);
const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const panel: DirectPanel = {
  ...base, id: use.panelId, name: "Scheduled tasks",
  content: {
    html: `<div flow="row" gap="small">
  <section when="selectedTask" ne="null">
    <panel-member ref="form"></panel-member>
    <panel-member ref="run"></panel-member>
  </section>
</div>`,
  },
  manifest: {
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: true, default: null } },
    members: {
      form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } }, params: { width: "full" } },
      run: { target: { projectionId: "task-run" }, inputs: { task: { state: "selectedTask" } }, params: { width: "auto" } },
    },
    events: {},
  },
};
const projections: Record<string, DirectProjection> = {
  "task-form": {
    ...base, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  },
  "task-run": {
    ...base, id: "task-run", name: "Run now", componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
    data: { operation: { source: { operation: "schedules.runNow" }, read: "describe", params: {} } },
  },
};
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const form = (name: string) => ({
  fields: [field("/name", "Name")], values: { name }, revision: 3,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
});
const runNow = { handlerRef: "schedules.runNow", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const INTENT = "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05";
const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
  if (request.path === `/api/product-panels/${panel.id}/snapshot`)
    return Response.json({ panel: { id: panel.id, revision: 1 }, projections: Object.values(projections).map(({ id, revision }) => ({ id, revision })) });
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection) return Response.json({ projection: projections[decodeURIComponent(projection[1]!)] });
  if (request.path === "/api/product-panels/read") {
    const { dataName, inputs } = request.body as { dataName: string; inputs: { task: { primaryKey: string } } };
    return Response.json({ status: "ready", value: dataName === "operation" ? runNow : form(`Task ${inputs.task.primaryKey}`) });
  }
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

const reads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read").map(request => request.body as {
  source: unknown; memberPath: unknown; dataName: string; inputs: { task?: { primaryKey: string } };
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws a panel without code in the platform's document and reads its members within its use, as the reader", async () => {
  const { app, element, sent } = await open(panelAddress(use.path, { selectedTask: task("t-1") }));
  try {
    await vi.waitFor(() => expect(element.querySelector('[data-member="form"] [data-field="/name"] input')).not.toBeNull());
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector(".panel-layout-row")).not.toBeNull();
    // A panel without code needs no SDK build: the host never asks where the SDK is served.
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
    await vi.waitFor(() => expect(element.querySelector(".panel-layout-row")).not.toBeNull());
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
    const layout = element.querySelector(".panel-layout-row");
    const projectionReads = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    await router.push(panelAddress(use.path, { selectedTask: task("t-2") }));
    await vi.waitFor(() => expect(reads(sent).some(read => read.dataName === "form" && read.inputs.task?.primaryKey === "t-2")).toBe(true));
    // The same instance: its layout stays in place and its members' projections are not read again.
    expect(element.querySelector(".panel-layout-row")).toBe(layout);
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/")).length).toBe(projectionReads);
  } finally {
    app.unmount();
  }
});
