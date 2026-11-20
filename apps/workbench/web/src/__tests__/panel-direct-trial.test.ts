import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelDefinitionSnapshotSchema } from "@ontomato/contracts/product-subscriptions";
import { directPanelSchema, productProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import recorded from "./fixtures/direct-panel-host-http.json";
import { panelAnswer, pageSkillContextFor, installPlatform, mountPlatformPage, nothingAt, panelUse, type Sent } from "./panel-frame";

/*
 * The scheduled tasks trial as it is registered (design 8, first gate): P is its layout and its declaration, with no code,
 * and its four projections read the scheduled task owner's registered reads. At its application's address the platform
 * draws it without a frame: the reader picks a task from the list, sees it summed up and in its application's form,
 * runs it now, and picks another — all in one instance, each datum read through the platform as the reader.
 *
 * Real route, panel host, SDK instance and the trial's own material. Node's answers for the panel, its snapshot and its
 * projections are the ones Node gave for this material over HTTP (`fixtures/direct-panel-host-http.json`, recorded by
 * the workbench server's `direct-panel-host.integration.test.ts` with `DIRECT_PANEL_HOST_HTTP_EVIDENCE`), so a host
 * call Node would refuse for a direct panel is not hidden by a stand-in; the owners' data and operations are stand-ins.
 *
 * What this rules out: trial material the platform cannot draw without a frame; a choice that does not reach the
 * summary, the form and the button, or the address; a run that bypasses the host's confirmation, runs twice or leaves
 * what it changed unread; a new choice that rebuilds the panel or reads its projections again.
 */

const application = "app-panels-trial-a";
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", "panel-schedules-trial", `/applications/${application}/tasks`);
const panel = directPanelSchema.parse(recorded.panel.panel);
const snapshot = panelDefinitionSnapshotSchema.parse(recorded.snapshot);
const projections = Object.fromEntries(Object.entries(recorded.projections).map(([id, answer]) => [id, productProjectionResponseSchema.parse(answer)]));

const rows = [
  { primaryKey: "t-1", label: "Nightly audit", fields: { application: "ops", settings: "daily 02:00", state: "on", nextRun: "2026-11-23T02:00:00Z" } },
  { primaryKey: "t-2", label: "Weekly backup", fields: { application: "ops", settings: "sun 03:00", state: "off", nextRun: "" } },
];
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const form = (name: string) => ({
  fields: [field("/name", "Name")], values: { name }, errors: [], revision: 3,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
});
const runNow = { handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const INTENT = "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05";

type Read = { dataName: string; memberPath: [{ member: string }]; inputs: { task?: { primaryKey: string }; values?: { name: string } } };
function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return Response.json({ ...snapshot, pageSkillContext: pageSkillContextFor(panel, request) });
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection) return Response.json(projections[decodeURIComponent(projection[1]!)]);
  if (request.path === "/api/product-panels/read") {
    const { dataName, inputs } = request.body as Read;
    const value = dataName === "rows" ? rows : dataName === "operation" ? runNow
      : dataName === "record" ? rows.find(row => row.primaryKey === inputs.task!.primaryKey)
      : form(inputs.values?.name ?? `Task ${inputs.task!.primaryKey}`);
    return Response.json({ status: "ready", value });
  }
  if (request.path === "/api/panel-operations/intents" || request.path === `/api/panel-operation-intents/${INTENT}`)
    return Response.json({ intentId: INTENT, operationId: "run.runNow", label: "Run now", confirmation: { kind: "none" } });
  if (request.path === `/api/panel-operations/intents/${INTENT}/dispatch`)
    return Response.json({ kind: "dispatched", intentId: INTENT, outcome: { kind: "success", data: {}, affected: {
      objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK],
    } } });
  return nothingAt(request);
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("runs the trial's P without code: choose a task, see it summed up and in its form, run it now, choose another", async () => {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId }),
  }] });
  await router.push(use.path);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  const reads = (name: string) => sent.filter(request => request.path === "/api/product-panels/read")
    .map(request => request.body as Read).filter(read => read.dataName === name);
  const options = () => element.querySelectorAll<HTMLElement>("[data-member='tasks'] [role='option']");
  try {
    // The list is there to choose from and the summary asks for a choice; nothing but the list is read before one.
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector("[data-member='summary'] [data-state='awaiting']")).not.toBeNull();
    expect(element.querySelector("[data-member='form']")).toBeNull();
    expect(["record", "form", "operation"].flatMap(reads)).toEqual([]);

    options()[0]!.click();
    await vi.waitFor(() => expect(element.querySelector("[data-member='summary'] .sdk-object-summary-title")?.textContent).toBe("Nightly audit"));
    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>("[data-member='form'] [data-field='/name'] input")?.value).toBe("Task t-1"));
    expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } });

    // Run now: prepared, confirmed and dispatched once by the host; what the owner reports changed is read again once.
    const button = await vi.waitFor(() => {
      const found = element.querySelector<HTMLButtonElement>("[data-member='run'] button");
      if (!found || found.disabled) throw new Error("Run now is not ready");
      return found;
    });
    const before = { rows: reads("rows").length, record: reads("record").length, form: reads("form").length };
    button.click();
    await vi.waitFor(() => expect({ rows: reads("rows").length, record: reads("record").length, form: reads("form").length })
      .toEqual({ rows: before.rows + 1, record: before.record + 1, form: before.form + 1 }));
    expect(sent.filter(request => request.path.endsWith("/dispatch"))).toHaveLength(1);

    // Another task: the same instance follows it, and no projection is read again.
    const layout = element.querySelector(".panel-layout");
    const projectionReads = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    options()[1]!.click();
    await vi.waitFor(() => expect(element.querySelector("[data-member='summary'] .sdk-object-summary-title")?.textContent).toBe("Weekly backup"));
    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>("[data-member='form'] [data-field='/name'] input")?.value).toBe("Task t-2"));
    expect(element.querySelector(".panel-layout")).toBe(layout);
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/")).length).toBe(projectionReads);
  } finally {
    app.unmount();
  }
});
