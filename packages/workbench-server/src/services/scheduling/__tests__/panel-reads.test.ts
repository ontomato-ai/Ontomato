import { afterEach, expect, it, vi } from "vitest";
import { RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import examples from "../../../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));

const task = examples.creates.find(create => create.name === "operations-autotest")!.response;
const opening = examples.forms.find(form => form.name === "operations-empty")!.response;
const refreshed = examples.forms.find(form => form.name === "operations-switch-to-inspection")!.response;
const viewer = { token: "test-viewer", locale: "en" };

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads the viewer's task rows and selected summary, and recomputes the selected task's form", async () => {
  const fetchOwner = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const path = new URL(url).pathname;
    if (init.method === "GET" && path.endsWith("/platform/scheduled-tasks"))
      return Response.json({ timeZone: task.timeZone, tasks: [task] });
    if (init.method === "GET" && path.endsWith(`/platform/scheduled-tasks/${task.id}`))
      return Response.json(task);
    if (init.method === "POST" && path.endsWith("/platform/scheduled-tasks/applications/operations/form")) {
      const input = JSON.parse(String(init.body));
      expect(input).toMatchObject({ taskId: task.id, timeZone: task.timeZone });
      if (input.changedField === null) {
        expect(input.values).toEqual(task.content);
        return Response.json({ ...opening, values: task.content, submittable: true });
      }
      expect(input).toMatchObject({ changedField: "operation", values: { operation: "inspection", caseSetId: "set-regression" } });
      return Response.json(refreshed);
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchOwner);

  const reads = createScheduledTaskReadAdapter(viewer);
  const rows = panelReadResultSchemas.panelRecordList.parse(await reads.list());
  const record = panelReadResultSchemas.panelRecord.parse(await reads.record(task.id));
  expect(rows).toEqual([record]);
  expect(record).toMatchObject({
    primaryKey: task.id, label: task.title,
    fields: { application: task.appId, state: "on", nextRun: task.nextRunAt },
  });
  const form = panelReadResultSchemas.panelFormDescription.parse(await reads.form(task.id, {}));
  expect(form).toMatchObject({ values: task.content, revision: task.revision });
  const replacement = await reads.form(task.id, {
    values: { operation: "inspection", caseSetId: "set-regression" }, changedField: "/operation",
  });
  expect(replacement.values).toEqual(refreshed.values);
  expect(replacement.fields.map(field => field.path)).toContain("/instruction");
  expect(replacement.fields.map(field => field.path)).not.toContain("/caseSetId");
  expect(replacement.revision).toBe(task.revision);
  await expect(reads.form(task.id, {
    values: { operation: "inspection", caseSetId: "set-regression" }, changedField: null,
  })).rejects.toMatchObject({
    status: 422, code: "FIELD_VALIDATION_FAILED", details: { fieldErrors: { "/caseSetId": "Not a field of this form" } },
  });
});

it("describes the registered write without dispatching it and propagates owner denials", async () => {
  const denial = examples.errors.find(error => error.name === "permission-lost")!;
  const fetchOwner = vi.fn(async () => Response.json(denial.response, { status: 403 }));
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createScheduledTaskReadAdapter(viewer);
  const operation = panelReadResultSchemas.panelOperationDescriptor.parse(reads[`${RUN_NOW}.describe`]());
  expect(operation).toMatchObject({
    handlerRef: RUN_NOW, effect: "write", target: { source: "input", input: "task" },
  });
  expect(fetchOwner).not.toHaveBeenCalled();
  await expect(reads.record(task.id)).rejects.toMatchObject({
    status: 403, code: "PERMISSION_DENIED", message: denial.response.error.message,
  });
});
