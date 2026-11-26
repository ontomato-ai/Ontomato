import { afterEach, expect, it, vi } from "vitest";
import { createScheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import type { ScheduledApplicationsStatus } from "@ontomato/platform-schedules/panel-reads";
import { panelOperationOutcomeSchema } from "@ontomato/contracts/panel-agent";
import { RUN_NOW, TRIGGER } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import examples from "../../../../../contracts/examples/platform-schedules.json";
import { configureI18n, tForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { unwrapReadDirective } from "../../product-panels/read-directive";
import { createScheduledTaskReadAdapter } from "../panel-reads";
import { triggerFixture } from "./fixtures";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../identity/management", () => ({ assertManagement: vi.fn(async () => {}) }));
const directory = vi.hoisted(() => ({ agents: vi.fn(), caseSets: vi.fn() }));
vi.mock("../../assistant/store", () => ({ assistantStore: { agents: directory.agents } }));
vi.mock("../../assistant/service", () => ({ assistantService: {} }));
vi.mock("../../ops-diagnosis/service", () => ({ diagnosisService: {} }));
vi.mock("../../assistant/authorization", () => ({ allowedAgents: async (agents: { permitted: boolean }[]) => agents.filter(agent => agent.permitted) }));
vi.mock("../../../platform/diagnosis/autotest/cases/repository", () => ({ listCaseSets: directory.caseSets }));
directory.agents.mockResolvedValue([]);
directory.caseSets.mockReturnValue([{ id: "set-regression", name: "Regression suite", caseCount: 12 }]);

const task = examples.creates.find(create => create.name === "operations-autotest")!.response;
const opening = examples.forms.find(form => form.name === "operations-empty")!.response;
const refreshed = examples.forms.find(form => form.name === "operations-switch-to-inspection")!.response;
const owner = { userId: "test-member", domainId: "test-domain" };
const viewer = { token: "test-viewer", locale: "en" };
const catalogue = {
  success: true,
  data: ["agents", "operations"].map(id => ({
    id, kind: "native", names: { en: id === "operations" ? "Operations center" : id },
    descriptions: {}, icon: "apps", rail: "apps", category: "business", sort: 0,
    entry: { path: `/${id}`, entryKey: id }, scheduleAdapter: `workbench:${id}`, releaseId: null, entryAvailable: true,
  })),
};

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("carries the owner's pause cause on both the card and the selected record", async () => {
  const paused = { ...task, nextRunAt: null, pause: { code: "definition_changed", message: "The application form changed." } };
  vi.stubGlobal("fetch", async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/platform/applications") return Response.json(catalogue);
    return Response.json(pathname.endsWith(`/${task.id}`) ? paused : { timeZone: task.timeZone, tasks: [paused] });
  });
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  const expected = { fields: { state: "paused: The application form changed.", pauseCode: "definition_changed" } };
  await expect(reads.list()).resolves.toMatchObject([expected]);
  await expect(reads.record(task.id)).resolves.toMatchObject(expected);
});

it("keeps an uninstalled application's name and reason in the picker so the task can be moved", async () => {
  const retired = { ...task, appId: "app-old-schedule" };
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/platform/applications") return Response.json(catalogue);
    if (path === "/platform/triggers/targets") return Response.json({ actions: [], workflows: [] });
    if (path.endsWith(`/${task.id}`)) return Response.json(retired);
    throw new Error(`Unexpected owner request ${path}`);
  });
  const form = panelReadResultSchemas.panelFormDescription.parse(await createScheduledTaskReadAdapter(owner, viewer).form(task.id, {}));
  expect(form.values.task).toMatchObject({ appId: retired.appId });
  expect(form.fields.find(({ path }) => path === "/task/appId")?.control).toMatchObject({
    kind: "select", options: expect.arrayContaining([
      expect.objectContaining({ value: retired.appId, label: retired.appId, disabled: true, disabledReason: "Not installed" }),
    ]),
  });
  expect(form.errors).toContainEqual({ field: "/task/appId", code: "invalid_option", message: "Not installed" });
});

it("reads the viewer's task rows and selected summary, and recomputes the selected task's form", async () => {
  const fetchOwner = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const { pathname: path, searchParams } = new URL(url);
    if (init.method === "GET" && path === "/platform/applications") return Response.json(catalogue);
    if (path === "/platform/triggers/targets") return Response.json({ actions: [], workflows: [] });
    if (init.method === "GET" && path.endsWith("/platform/triggers"))
      return Response.json({
        timeZone: task.timeZone, tasks: [task],
        ...(searchParams.get("includeCredentialStatus") === "true" && { credentialStatus: "renewal-required" }),
      });
    if (init.method === "GET" && path.endsWith(`/platform/triggers/${task.id}`))
      return Response.json(task);
    if (init.method === "POST" && path.endsWith("/platform/triggers/applications/operations/form")) {
      const input = JSON.parse(String(init.body));
      if (input.taskId === null) {
        expect(input).toMatchObject({ values: {}, changedField: null, timeZone: task.timeZone });
        return Response.json(opening);
      }
      expect(input).toMatchObject({ taskId: task.id, timeZone: task.timeZone });
      if (input.changedField === null) {
        if (input.values.operation === "inspection") {
          const values = { operation: "inspection", instruction: input.values.instruction ?? "" };
          return Response.json({ ...refreshed, values, submittable: Boolean(values.instruction) });
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

  const reads = createScheduledTaskReadAdapter(owner, viewer);
  await expect(reads.status()).resolves.toMatchObject({ outputs: { credentialStatus: "renewal-required" } });
  const rows = panelReadResultSchemas.panelRecordList.parse(await reads.list());
  const record = panelReadResultSchemas.panelRecord.parse(await reads.record(task.id));
  expect(rows).toEqual([record]);
  expect(record).toMatchObject({
    primaryKey: task.id, label: task.title,
    fields: { targetKind: "application", targetName: "Regression suite (12)", targetIcon: "apps", state: "on", nextRun: task.nextRunAt, frequency: expect.any(String), lastRunAt: "", lastRunSummary: "" },
  });
  const form = panelReadResultSchemas.panelFormDescription.parse(await reads.form(task.id, {}));
  expect(form).toMatchObject({
    values: { ...task.content, task: { title: task.title, appId: task.appId, frequency: task.frequency, timeZone: task.timeZone } },
    revision: task.revision,
    sections: [
      { key: "application", title: "What Operations center gets" },
      { key: "notifications", title: "After it runs" },
    ],
    fields: expect.arrayContaining([
      expect.objectContaining({ path: "/task/frequency", help: `In this task's time zone (${task.timeZone}).` }),
      expect.objectContaining({ path: "/task/notifyEmail", section: "notifications" }),
      expect.objectContaining({ path: "/operation", section: "application" }),
    ]),
  });
  expect(form.fields.map(field => field.path)).toEqual(expect.arrayContaining([
    "/task/title", "/task/targetKind", "/task/description", "/task/executorId", "/task/coauthorIds",
    "/task/appId", "/task/frequency", "/task/timeZone", "/task/notifyEmail", "/operation", "/caseSetId",
  ]));
  const create = await reads.createForm({});
  expect(create).toMatchObject({
    values: { task: { title: "", appId: "", frequency: { kind: "daily", time: "09:00" }, timeZone: task.timeZone } },
  });
  const prefilling = await reads.createForm({ defaultAppId: "operations" });
  expect(prefilling.values.task).toMatchObject({ appId: "operations" });
  expect(prefilling.fields.find(({ path }) => path === "/task/appId")?.control).toMatchObject({
    kind: "select", options: expect.arrayContaining([expect.objectContaining({ value: "operations", label: "Operations center" })]),
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
    if (init.method === "GET" && path === "/platform/applications") return Response.json(catalogue);
    if (init.method === "GET" && path.endsWith(`/platform/triggers/${agentTask.id}`))
      return Response.json(agentTask);
    if (path === "/platform/triggers/targets") return Response.json({ actions: [], workflows: [] });
    if (init.method === "POST" && path.endsWith("/platform/triggers/applications/agents/form")) {
      const { values } = JSON.parse(String(init.body));
      const complete = { agentId: "", instruction: "", ...values };
      return Response.json({ ...agentForm, values: complete, submittable: Boolean(complete.agentId && complete.instruction) });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });
  const instruction = "Review the new inventory";
  const draft = await createScheduledTaskReadAdapter(owner, viewer).form(agentTask.id, { values: { instruction }, changedField: null });
  expect(draft).toMatchObject({
    values: { ...agentTask.content, instruction },
    errors: [],
  });
  const refused = await createScheduledTaskReadAdapter(owner, viewer).form(agentTask.id, {
    values: { content: { instruction } }, changedField: null,
  });
  expect(panelReadResultSchemas.panelFormDescription.parse(refused)).toMatchObject({
    values: agentTask.content,
    errors: [{
      field: "/content", code: "invalid_format",
      message: "The draft field /content must be text. Fill in each application field separately.",
    }],
  });
});

it("keeps an unavailable choice and its owner error in the form", async () => {
  const unavailable = examples.forms.find(form => form.name === "edit-unavailable-agent")!.response;
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const path = new URL(url).pathname;
    if (init.method === "GET" && path === "/platform/applications") return Response.json(catalogue);
    if (init.method === "GET" && path.endsWith(`/platform/triggers/${agentTask.id}`))
      return Response.json(agentTask);
    if (path === "/platform/triggers/targets") return Response.json({ actions: [], workflows: [] });
    if (init.method === "POST" && path.endsWith("/platform/triggers/applications/agents/form"))
      return Response.json(unavailable);
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });

  const form = panelReadResultSchemas.panelFormDescription.parse(
    await createScheduledTaskReadAdapter(owner, viewer).form(agentTask.id, {}),
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
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  const operation = createScheduledTaskServerOperations(tForLocale).find(item => item.handlerRef === RUN_NOW);
  expect(operation).toMatchObject({ handlerRef: RUN_NOW, effect: "write", targetInput: "task", targetType: TRIGGER });
  expect(fetchOwner).not.toHaveBeenCalled();
  await expect(reads.record(task.id)).rejects.toMatchObject({
    status: 403, code: "PERMISSION_DENIED", message: denial.response.error.message,
  });
});

it("reports a started run without replacing its structured result", async () => {
  const [, runNow] = createScheduledTaskServerOperations(tForLocale);
  const started = examples.runs.find(run => run.name === "agents-running")!;
  const { taskId } = started.response;
  const intentId = "50000000-0000-4000-8000-000000000001";
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(path).toBe(`/api/data-query/platform/triggers/${taskId}/runs`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(intentId);
    return Response.json(started.response, { status: started.status });
  };
  const outcome = panelOperationOutcomeSchema.parse(await runNow.execute(
    { request, locale: viewer.locale }, { kind: "object", objectType: TRIGGER, primaryKey: taskId }, {}, intentId,
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
    const taskPath = `/platform/triggers/${agentTask.id}`;
    if (path.endsWith(taskPath) && !init.method) return Response.json(agentTask);
    if (path.endsWith("/platform/triggers/applications/agents/form") && init.method === "POST") {
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
    { request }, { kind: "object", objectType: TRIGGER, primaryKey: agentTask.id }, input, "test-intent",
  )).resolves.toMatchObject({ kind: "success", data: { content } });
});

it("writes the active owner fields when a submitted choice changes the form", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const content = { operation: "inspection", instruction: "Inspect the latest run" };
  const request = async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const taskPath = `/platform/triggers/${task.id}`;
    if (path.endsWith(taskPath) && !init.method) return Response.json(task);
    if (path.endsWith("/platform/triggers/applications/operations/form") && init.method === "POST")
      return Response.json({ ...refreshed, values: content });
    if (path.endsWith(taskPath) && init.method === "PUT") {
      expect(JSON.parse(String(init.body)).content).toEqual(content);
      return Response.json({ ...task, content, formRevision: refreshed.formRevision, revision: task.revision + 1 });
    }
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  };

  const input = { values: { ...task.content, ...content }, revision: task.revision, submittedFields: ["/operation", "/instruction"] };
  await expect(save.execute(
    { request }, { kind: "object", objectType: TRIGGER, primaryKey: task.id }, input, "test-intent",
  )).resolves.toMatchObject({ kind: "success", data: { content } });
});

it("reads paged run history and one run as the panel's viewer", async () => {
  const example = examples.runs.find(run => run.name === "agents-running")!.response;
  const page = { runs: [example], nextCursor: "next-page" };
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const { pathname, searchParams } = new URL(url);
    const runsPath = `/platform/triggers/${example.taskId}/runs`;
    if (pathname === runsPath) {
      expect(searchParams.get("cursor")).toBe("previous-page");
      return Response.json(page);
    }
    if (pathname === `${runsPath}/${example.id}`) return Response.json(example);
    throw new Error(`Unexpected owner request ${pathname}`);
  });
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  await expect(reads.runs(example.taskId, "previous-page")).resolves.toEqual(page);
  await expect(reads.run(example.taskId, example.id)).resolves.toEqual(example);
});

it("accepts a redacted failed history row without inventing a reason or result", async () => {
  const example = examples.runs.find(run => run.name === "agents-running")!.response;
  const legacy = {
    ...example, status: "failed", finishedAt: "2026-11-26T09:15:00Z",
    error: null, result: null, resultLink: null, resultSummary: null, spendTime: null,
    snapshot: { ...example.snapshot, executorId: null, title: "Historical execution", content: {}, summary: [], targetId: null },
    executionDetails: { legacyIdentity: "unknown" },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    expect(new URL(url).pathname).toBe(`/platform/triggers/${legacy.taskId}/runs/${legacy.id}`);
    return Response.json(legacy);
  }));
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  await expect(reads.run(legacy.taskId, legacy.id)).resolves.toEqual(legacy);
  const record = unwrapReadDirective(await reads.runRecord(legacy.taskId, legacy.id)).value;
  expect(record).toMatchObject({ outputs: { status: "failed", resultPath: "" } });
  expect(record).not.toHaveProperty("fields.error");
  expect(record).not.toHaveProperty("fields.result");
});

it("returns a field refusal when submitted task settings are invalid", async () => {
  const [save] = createScheduledTaskServerOperations(tForLocale);
  const request = vi.fn(async (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (path.endsWith(`/platform/triggers/${task.id}`) && !init.method) return Response.json(task);
    if (path.endsWith("/platform/triggers/applications/operations/form") && init.method === "POST")
      return Response.json({ ...opening, values: task.content, submittable: true });
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  });
  const input = { values: { task: { notifyEmail: "invalid" } }, revision: task.revision, submittedFields: ["/task/notifyEmail"] };
  await expect(save.execute(
    { request }, { kind: "object", objectType: TRIGGER, primaryKey: task.id }, input, "test-intent",
  )).resolves.toMatchObject({
    kind: "refusal", code: "FIELD_VALIDATION_FAILED",
    errors: [{ field: "/task/notifyEmail", message: expect.any(String) }],
  });
  expect(request.mock.calls.some(([, init]) => init.method === "PUT")).toBe(false);
});

it("combines Java's native targets and app entries without resolving private names outside the viewer's authorization", async () => {
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const otherAgentId = "20000000-0000-4000-8000-000000000002";
  const otherTask = { ...agentTask, id: "shared-trigger", content: { ...agentTask.content, agentId: otherAgentId } };
  directory.agents.mockClear().mockResolvedValueOnce([
    { id: "20000000-0000-4000-8000-000000000001", name: "Inventory reader", enabled: true, permitted: true },
    { id: otherAgentId, name: "Private agent", enabled: true, permitted: false },
  ]);
  directory.caseSets.mockClear();
  const http = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/platform/applications") {
      expect(searchParams.get("purpose")).toBe("schedules");
      return Response.json({ ...catalogue, data: catalogue.data.map(app => ({ ...app, entryAvailable: app.id === "agents" })) });
    }
    if (pathname === "/platform/triggers/targets") return Response.json({
      actions: [], workflows: [{ id: triggerFixture.targetId, name: triggerFixture.targetName, description: null }],
    });
    if (pathname === "/platform/triggers") return Response.json({ timeZone: "UTC", tasks: [agentTask, otherTask, task] });
    throw new Error(`Unexpected owner request ${pathname}`);
  });
  vi.stubGlobal("fetch", http);
  let batch: Promise<ScheduledApplicationsStatus> | undefined;
  const reads = createScheduledTaskReadAdapter(owner, viewer, undefined, load => batch ??= load());
  const form = await reads.createForm({ values: { task: { targetKind: "workflow" } }, changedField: "/task/targetKind" });
  expect(form.fields.find(field => field.path === "/task/targetId")?.control).toMatchObject({
    options: expect.arrayContaining([expect.objectContaining({ value: triggerFixture.targetId, label: triggerFixture.targetName })]),
  });
  const appForm = await reads.createForm({});
  expect(appForm.fields.find(field => field.path === "/task/appId")?.control).toMatchObject({
    options: expect.arrayContaining([expect.objectContaining({
      value: "operations", disabled: true, disabledReason: "Application entry permission is required",
    })]),
  });
  const rows = await reads.list();
  expect(rows).toMatchObject([
    { fields: { targetName: "Inventory reader" } },
    { fields: { targetName: "agents" } },
    { fields: { targetName: "Operations center" } },
  ]);
  expect(JSON.stringify(rows)).not.toContain("Private agent");
  expect(directory.agents).toHaveBeenCalledTimes(1);
  expect(directory.caseSets).not.toHaveBeenCalled();
  expect(http.mock.calls.filter(([url]) => new URL(url).pathname === "/platform/applications")).toHaveLength(1);
});

it("looks up active members through the shared domain directory with the viewer's credentials", async () => {
  const fetchOwner = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new URL(url).pathname).toBe("/platform/identity/principals");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "member" });
    return Response.json({ options: [{ kind: "member", id: "member-jordan", name: "Jordan" }] });
  });
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  await expect(reads.memberOptions({ keyword: "Jordan", page: { number: 1, size: 12 } }))
    .resolves.toMatchObject({ options: [{ value: "member-jordan", label: "Jordan" }] });
  expect(JSON.parse(String(fetchOwner.mock.calls[0]![1].body))).toMatchObject({ keyword: "Jordan", limit: 12 });
  await expect(reads.memberResolve(["member-jordan"]))
    .resolves.toMatchObject({ options: [{ value: "member-jordan", label: "Jordan" }] });
});

it("filters scheduled task list by application and search and carries application icons (SC-04)", async () => {
  const secondTask = {
    ...task,
    id: "10000000-0000-4000-8000-000000000099",
    appId: "agents",
    title: "Weekly digest",
  };
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/platform/applications") return Response.json(catalogue);
    if (path === "/platform/triggers") return Response.json({ timeZone: task.timeZone, tasks: [task, secondTask] });
    throw new Error(`Unexpected owner request ${path}`);
  });
  const reads = createScheduledTaskReadAdapter(owner, viewer);
  const byApp = unwrapReadDirective(await reads.list({ scope: "operations" })).value as Array<{ primaryKey: string; fields: Record<string, unknown> }>;
  expect(byApp).toHaveLength(1);
  expect(byApp[0]?.primaryKey).toBe(task.id);
  expect(byApp[0]?.fields.targetIcon).toBe("apps");
  const bySearch = unwrapReadDirective(await reads.list({ search: "weekly" })).value as Array<{ primaryKey: string }>;
  expect(bySearch).toHaveLength(1);
  expect(bySearch[0]?.primaryKey).toBe(secondTask.id);
});

it("attaches declarative rereadAfterMs directives only while scheduled tasks or runs are active (SC-13)", async () => {
  const runningRun = examples.runs.find(run => run.name === "agents-running")!.response;
  const completedRun = { ...runningRun, id: "20000000-0000-4000-8000-000000000099", status: "completed" as const, finishedAt: "2026-04-01T00:05:00Z" };
  const activeTask = { ...task, activeRunId: runningRun.id };
  const idleTask = { ...task, activeRunId: null };
  let active = true;
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/platform/applications") return Response.json(catalogue);
    if (path === "/platform/triggers") return Response.json({ timeZone: task.timeZone, tasks: [active ? activeTask : idleTask] });
    if (path === `/platform/triggers/${task.id}`) return Response.json(active ? activeTask : idleTask);
    if (path === `/platform/triggers/${task.id}/runs`) {
      return Response.json({ runs: [active ? runningRun : completedRun], nextCursor: null });
    }
    if (path === `/platform/triggers/${task.id}/runs/${runningRun.id}`) {
      return Response.json(active ? runningRun : completedRun);
    }
    throw new Error(`Unexpected owner request ${path}`);
  });
  const reads = createScheduledTaskReadAdapter(owner, viewer);

  expect(unwrapReadDirective(await reads.list()).directive).toEqual({ rereadAfterMs: 30_000 });
  expect(unwrapReadDirective(await reads.record(task.id)).directive).toEqual({ rereadAfterMs: 5_000 });
  expect(unwrapReadDirective(await reads.runRecords(task.id)).directive).toEqual({ rereadAfterMs: 5_000 });
  expect(unwrapReadDirective(await reads.runRecord(task.id, runningRun.id)).directive).toEqual({ rereadAfterMs: 5_000 });
  expect(unwrapReadDirective(await reads.runRecord(task.id)).directive).toEqual({ rereadAfterMs: 5_000 });

  active = false;
  expect(unwrapReadDirective(await reads.list()).directive).toBeUndefined();
  expect(unwrapReadDirective(await reads.record(task.id)).directive).toBeUndefined();
  expect(unwrapReadDirective(await reads.runRecords(task.id)).directive).toBeUndefined();
  expect(unwrapReadDirective(await reads.runRecord(task.id, runningRun.id)).directive).toBeUndefined();
  expect(unwrapReadDirective(await reads.runRecord(task.id)).directive).toBeUndefined();
});
