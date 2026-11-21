import { afterEach, expect, it, vi } from "vitest";
import { createScheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import { panelOperationOutcomeSchema } from "@ontomato/contracts/panel-agent";
import { RUN_NOW, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import examples from "../../../../../contracts/examples/platform-schedules.json";
import { configureI18n, tForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createScheduledTaskReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));

const task = examples.creates.find(create => create.name === "operations-autotest")!.response;
const opening = examples.forms.find(form => form.name === "operations-empty")!.response;
const refreshed = examples.forms.find(form => form.name === "operations-switch-to-inspection")!.response;
const viewer = { token: "test-viewer", locale: "en" };

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads the viewer's task rows and selected summary, and recomputes the selected task's form", async () => {
  const fetchOwner = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const path = new URL(url).pathname;
    if (init.method === "GET" && path.endsWith("/platform/scheduled-tasks/applications"))
      return Response.json(examples.applicationsEnglish.response);
    if (init.method === "GET" && path.endsWith("/platform/scheduled-tasks"))
      return Response.json({ timeZone: task.timeZone, tasks: [task] });
    if (init.method === "GET" && path.endsWith(`/platform/scheduled-tasks/${task.id}`))
      return Response.json(task);
    if (init.method === "POST" && path.endsWith("/platform/scheduled-tasks/applications/operations/form")) {
      const input = JSON.parse(String(init.body));
      expect(input).toMatchObject({ taskId: task.id, timeZone: task.timeZone });
      if (input.changedField === null) {
        if (input.values.operation === "inspection") {
          expect(input.values).toEqual({ operation: "inspection", instruction: input.values.instruction });
          return Response.json({ ...refreshed, values: input.values, submittable: Boolean(input.values.instruction) });
        }
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
    fieldLabels: {
      application: "Application", settings: "Settings", state: "Status", nextRun: "Next run", lastRun: "Last run",
    },
  });
  const form = panelReadResultSchemas.panelFormDescription.parse(await reads.form(task.id, {}));
  expect(form).toMatchObject({
    values: { ...task.content, task: { title: task.title, appId: task.appId, frequency: task.frequency, timeZone: task.timeZone } },
    revision: task.revision,
  });
  expect(form.fields.map(field => field.path)).toEqual([
    "/task/title", "/task/appId", "/task/frequency", "/task/timeZone", "/task/notifyEmail", "/operation", "/caseSetId",
  ]);
  const create = await reads.createForm({});
  expect(create).toMatchObject({
    values: { task: { title: "", appId: "", frequency: { kind: "daily", time: "09:00" }, timeZone: task.timeZone } },
    save: { draftOperation: "platform:ScheduledTask.create" },
  });
  const replacement = panelReadResultSchemas.panelFormDescription.parse(await reads.form(task.id, {
    values: { operation: "inspection", caseSetId: "set-regression" }, changedField: "/operation",
  }));
  expect(replacement.values).toMatchObject(refreshed.values);
  expect(replacement.fields.map(field => field.path)).toContain("/instruction");
  expect(replacement.fields.map(field => field.path)).not.toContain("/caseSetId");
  expect(replacement.revision).toBe(task.revision);
  const draft = panelReadResultSchemas.panelFormDescription.parse(await reads.form(task.id, {
    values: { operation: "inspection", caseSetId: "set-regression" }, changedField: null,
  }));
  expect(draft).toMatchObject({
    values: refreshed.values,
    errors: expect.arrayContaining([
      { field: "/caseSetId", code: "invalid_object", message: "Not a field of this form" },
      { field: "/instruction", code: "required", message: expect.any(String) },
    ]),
  });
  const switchedValues = { operation: "inspection", instruction: "Review the latest run" };
  await expect(reads.form(task.id, { values: switchedValues, changedField: null })).resolves.toMatchObject({
    values: switchedValues,
    errors: [],
  });
});

it("checks a partial draft against the task's stored application values", async () => {
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentForm = examples.forms.find(form => form.name === "agents-empty")!.response;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const path = new URL(url).pathname;
    if (init.method === "GET" && path.endsWith("/platform/scheduled-tasks/applications"))
      return Response.json(examples.applicationsEnglish.response);
    if (init.method === "GET" && path.endsWith(`/platform/scheduled-tasks/${agentTask.id}`))
      return Response.json(agentTask);
    if (init.method === "POST" && path.endsWith("/platform/scheduled-tasks/applications/agents/form")) {
      const { values } = JSON.parse(String(init.body));
      const complete = { agentId: "", instruction: "", ...values };
      return Response.json({ ...agentForm, values: complete, submittable: Boolean(complete.agentId && complete.instruction) });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });
  const instruction = "Review the new inventory";
  const draft = await createScheduledTaskReadAdapter(viewer).form(agentTask.id, { values: { instruction }, changedField: null });
  expect(draft).toMatchObject({
    values: { ...agentTask.content, instruction },
    errors: [],
  });
});

it("keeps an unavailable choice and its owner error in the form", async () => {
  const unavailable = examples.forms.find(form => form.name === "edit-unavailable-agent")!.response;
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const path = new URL(url).pathname;
    if (init.method === "GET" && path.endsWith("/platform/scheduled-tasks/applications"))
      return Response.json(examples.applicationsEnglish.response);
    if (init.method === "GET" && path.endsWith(`/platform/scheduled-tasks/${agentTask.id}`))
      return Response.json(agentTask);
    if (init.method === "POST" && path.endsWith("/platform/scheduled-tasks/applications/agents/form"))
      return Response.json(unavailable);
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });

  const form = panelReadResultSchemas.panelFormDescription.parse(
    await createScheduledTaskReadAdapter(viewer).form(agentTask.id, {}),
  );
  expect(form).toMatchObject({
    fields: expect.arrayContaining([expect.objectContaining({ path: "/agentId" })]),
    values: unavailable.values,
    errors: unavailable.errors.map(error => ({ ...error, field: "/agentId" })),
  });
});

it("describes the registered write without dispatching it and propagates owner denials", async () => {
  const denial = examples.errors.find(error => error.name === "permission-lost")!;
  const fetchOwner = vi.fn(async () => Response.json(denial.response, { status: 403 }));
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createScheduledTaskReadAdapter(viewer);
  const operation = panelReadResultSchemas.panelOperationDescriptor.parse(reads[`${RUN_NOW}.describe`]());
  expect(operation).toMatchObject({
    handlerRef: RUN_NOW, label: "Run now", effect: "write", target: { source: "input", input: "task" },
  });
  expect(fetchOwner).not.toHaveBeenCalled();
  await expect(reads.record(task.id)).rejects.toMatchObject({
    status: 403, code: "PERMISSION_DENIED", message: denial.response.error.message,
  });
});

it("returns a rejected save with the owner's code and field pointer relative to the panel form", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const ownerTask = examples.creates.find(create => create.name === "ontology-with-line-arrays")!.response;
  const ownerForm = examples.forms.find(form => form.name === "ontology-selection-clears-old-parameters")!.response;
  const denial = examples.errors.find(error => error.name === "numeric-array-validation")!;
  const target = { kind: "object", objectType: SCHEDULED_TASK, primaryKey: ownerTask.id } as const;
  const values = { ...ownerTask.content, "parameter:thresholds": "10\ninvalid" };
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (path.endsWith(`/platform/scheduled-tasks/${ownerTask.id}`) && !init.method)
      return Response.json(ownerTask);
    if (path.endsWith("/platform/scheduled-tasks/applications/ontology/form") && init.method === "POST")
      return Response.json(ownerForm);
    if (path.endsWith(`/platform/scheduled-tasks/${ownerTask.id}`) && init.method === "PUT") {
      expect(JSON.parse(String(init.body))).toMatchObject({ content: values, revision: ownerTask.revision });
      return Response.json(denial.response, { status: denial.status });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  };

  const outcome = panelOperationOutcomeSchema.parse(await save.execute(
    { request }, target, { values, revision: ownerTask.revision }, "test-intent",
  ));
  expect(outcome).toMatchObject({
    kind: "refusal", code: denial.response.error.code, message: denial.response.error.message,
    errors: [{ field: "/parameter:thresholds", code: "invalid_number", message: "第2行不是有效数字" }],
  });
  expect(outcome).not.toHaveProperty("details.fields");
});

it("reports a started run without replacing its structured result", async () => {
  const [, runNow] = createScheduledTaskServerOperations(tForLocale);
  const started = examples.runs.find(run => run.name === "agents-running")!;
  const { taskId } = started.response;
  const intentId = "50000000-0000-4000-8000-000000000001";
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(path).toBe(`/api/data-query/platform/scheduled-tasks/${taskId}/runs`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(intentId);
    return Response.json(started.response, { status: started.status });
  };
  const outcome = panelOperationOutcomeSchema.parse(await runNow.execute(
    { request, locale: viewer.locale }, { kind: "object", objectType: SCHEDULED_TASK, primaryKey: taskId }, {}, intentId,
  ));
  expect(outcome).toMatchObject({
    kind: "success", message: "The run has started.", data: { taskId, status: "running" },
  });
});

it("preserves an existing value when a save only submits another field", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentForm = examples.forms.find(form => form.name === "agents-empty")!.response;
  const instruction = "Send a new summary";
  const content = { ...agentTask.content, instruction };
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const taskPath = `/platform/scheduled-tasks/${agentTask.id}`;
    if (path.endsWith(taskPath) && !init.method) return Response.json(agentTask);
    if (path.endsWith("/platform/scheduled-tasks/applications/agents/form") && init.method === "POST") {
      expect(JSON.parse(String(init.body)).values).toEqual(content);
      return Response.json({ ...agentForm, values: content });
    }
    if (path.endsWith(taskPath) && init.method === "PUT") {
      expect(JSON.parse(String(init.body))).toMatchObject({
        title: "Updated task", timeZone: agentTask.timeZone, content, revision: agentTask.revision,
      });
      return Response.json({ ...agentTask, title: "Updated task", content, revision: agentTask.revision + 1 });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  };

  const input = {
    values: { instruction, agentId: "", task: { title: "Updated task", timeZone: "Europe/Paris" } },
    revision: agentTask.revision, submittedFields: ["/instruction", "/task/title"],
  };
  expect(save.draftInput(input)).toEqual({ instruction, task: { title: "Updated task" } });
  await expect(save.execute(
    { request }, { kind: "object", objectType: SCHEDULED_TASK, primaryKey: agentTask.id }, input, "test-intent",
  )).resolves.toMatchObject({ kind: "success", data: { content } });
});

it("writes the active owner fields when a submitted choice changes the form", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const content = { operation: "inspection", instruction: "Inspect the latest run" };
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const taskPath = `/platform/scheduled-tasks/${task.id}`;
    if (path.endsWith(taskPath) && !init.method) return Response.json(task);
    if (path.endsWith("/platform/scheduled-tasks/applications/operations/form") && init.method === "POST")
      return Response.json({ ...refreshed, values: content });
    if (path.endsWith(taskPath) && init.method === "PUT") {
      expect(JSON.parse(String(init.body)).content).toEqual(content);
      return Response.json({ ...task, content, formRevision: refreshed.formRevision, revision: task.revision + 1 });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  };

  const input = { values: { ...task.content, ...content }, revision: task.revision, submittedFields: ["/operation", "/instruction"] };
  await expect(save.execute(
    { request }, { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.id }, input, "test-intent",
  )).resolves.toMatchObject({ kind: "success", data: { content } });
});

it("reads paged run history and one run as the panel's viewer", async () => {
  const example = examples.runs.find(run => run.name === "agents-running")!.response;
  const page = { runs: [example], nextCursor: "next-page" };
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const { pathname, searchParams } = new URL(url);
    const runsPath = `/platform/scheduled-tasks/${example.taskId}/runs`;
    if (pathname === runsPath) {
      expect(searchParams.get("cursor")).toBe("previous-page");
      return Response.json(page);
    }
    if (pathname === `${runsPath}/${example.id}`) return Response.json(example);
    throw new Error(`Unexpected owner request ${pathname}`);
  });
  const reads = createScheduledTaskReadAdapter(viewer);
  await expect(reads.runs(example.taskId, "previous-page")).resolves.toEqual(page);
  await expect(reads.run(example.taskId, example.id)).resolves.toEqual(example);
});

it("returns a field refusal when submitted task settings are invalid", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const request = vi.fn(async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (path.endsWith(`/platform/scheduled-tasks/${task.id}`) && !init.method) return Response.json(task);
    if (path.endsWith("/platform/scheduled-tasks/applications/operations/form") && init.method === "POST")
      return Response.json({ ...opening, values: task.content, submittable: true });
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });
  const input = { values: { task: { notifyEmail: "invalid" } }, revision: task.revision, submittedFields: ["/task/notifyEmail"] };
  await expect(save.execute(
    { request }, { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.id }, input, "test-intent",
  )).resolves.toMatchObject({
    kind: "refusal", code: "FIELD_VALIDATION_FAILED",
    errors: [{ field: "/task/notifyEmail", message: expect.any(String) }],
  });
  expect(request).toHaveBeenCalledTimes(1);
});
