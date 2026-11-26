import { afterEach, expect, it, vi } from "vitest";
import { createScheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import type { ScheduledApplicationsStatus } from "@ontomato/platform-schedules/panel-reads";
import { panelOperationOutcomeSchema } from "@ontomato/contracts/panel-agent";
import { RUN_NOW, TRIGGER, USER } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import examples from "../../../../../contracts/examples/platform-schedules.json";
import { configureI18n, tForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { unwrapReadDirective } from "../../product-panels/read-directive";
import { createScheduledTaskReadAdapter } from "../panel-reads";
import { prepareRegisteredTriggerRead } from "../registered-trigger-reads";
import { triggerFixture } from "./fixtures";
import type { JavaPanelReadResult } from "../../product-panels/java-panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../identity/management", () => ({ assertManagement: vi.fn(async () => {}) }));
const directory = vi.hoisted(() => ({ agents: vi.fn(), caseSets: vi.fn(), opsDiagnosis: vi.fn() }));
vi.mock("../../assistant/store", () => ({ assistantStore: { agents: directory.agents, opsDiagnosis: directory.opsDiagnosis } }));
vi.mock("../../assistant/service", () => ({ assistantService: {} }));
vi.mock("../../ops-diagnosis/service", () => ({ diagnosisService: {} }));
vi.mock("../../assistant/authorization", async original => ({
  ...await original<typeof import("../../assistant/authorization")>(),
  allowedAgents: async (agents: { permitted: boolean }[]) => agents.filter(agent => agent.permitted),
}));
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

it("uses searchable members for the registered picker and marks unmatched selections unavailable", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const visible = { id: "member-jordan", name: "Jordan", kind: "member" };
  const inactive = "member-disabled";
  const directoryResult = (...options: (typeof visible)[]): JavaPanelReadResult => ({ status: "ready", payload: { options } });
  const directorySearch = (keyword: string, limit: number) => ({
    call: { type: USER, name: "principalDirectory", parameters: { kind: "member", keyword, limit } },
  });
  const options = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "memberOptions" },
    { keyword: "Jordan", page: { number: 1, size: 12 } }, viewer)!;
  expect(options.facts).toEqual([directorySearch("Jordan", 12)]);
  expect(await options.present(owner, [directoryResult(visible)]))
    .toMatchObject({ options: [{ value: visible.id, label: visible.name }] });

  const resolve = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "memberResolve" },
    { values: [inactive, visible.id, inactive] }, viewer)!;
  expect(resolve.facts).toEqual([directorySearch(inactive, 100), directorySearch(visible.id, 100)]);
  expect(await resolve.present(owner, [directoryResult(visible), directoryResult(visible)]))
    .toMatchObject({ options: [
      { value: inactive, label: inactive, unavailable: { reason: expect.any(String) } },
      { value: visible.id, label: visible.name },
      { value: inactive, label: inactive, unavailable: { reason: expect.any(String) } },
    ] });
  expect(fetch).not.toHaveBeenCalled();
});

it("presents the registered trigger catalogue from the task owner and admitted application label facts", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "catalogue" },
    { scope: "application", search: "Regression suite" }, viewer)!;
  expect(plan.facts).toEqual([
    { call: { type: TRIGGER, name: "list", parameters: {} } },
    { call: { type: "platform:Application", name: "scheduleTargets", parameters: {} } },
    { call: { type: TRIGGER, name: "applicationLabelAccess", parameters: {} }, visibleKinds: [{ kind: "AGENT", verbs: ["USE"] }] },
  ]);
  const access = {
    status: "ready" as const,
    payload: { inspection: { allowed: false, reason: "Inspection refused" }, caseSets: { allowed: true } },
    visibility: { AGENT: { USE: { fixed: false, all: false, authorId: null, objectIds: [] } } },
  };
  const { value } = unwrapReadDirective(await plan.present(owner, [
    { status: "ready", payload: { tasks: [task, triggerFixture], timeZone: "UTC" } },
    { status: "ready", payload: catalogue.data },
    access,
  ]));
  const rows = panelReadResultSchemas.panelRecordList.parse(value);
  expect(rows).toMatchObject([{ primaryKey: task.id, fields: { targetName: "Regression suite (12)" } }]);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps native trigger names and masks refused runs in the registered reads", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const list = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "list" }, {}, viewer)!;
  const { value } = unwrapReadDirective(await list.present(owner, [
    { status: "ready", payload: { tasks: [triggerFixture], timeZone: "UTC" } },
    { status: "forbidden", error: "Application directory refused" },
    { status: "forbidden", error: "Application labels refused" },
  ]));
  expect(value).toMatchObject([{ fields: { targetName: triggerFixture.targetName } }]);
  const history = prepareRegisteredTriggerRead({
    kind: "platform", typeId: TRIGGER, method: "runRecord", primaryKey: triggerFixture.id,
  }, {}, viewer)!;
  expect(history.facts).toEqual([{ call: { type: TRIGGER, name: "runRecord", parameters: { primaryKey: triggerFixture.id } } }]);
  expect(await history.present(owner, [{
    status: "ready", payload: { task: triggerFixture, history: { runs: [], nextCursor: null } },
  }])).toMatchObject({ fields: { timeZone: "UTC" }, outputs: { status: "", isRunning: false } });
  await expect(async () => history.present(owner, [{ status: "error", code: "TASK_NOT_FOUND", error: "Trigger or run not found" }]))
    .rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  expect(fetch).not.toHaveBeenCalled();
});

function triggerFormFacts(agentIds: readonly string[] = []): [JavaPanelReadResult, JavaPanelReadResult, JavaPanelReadResult] {
  return [
    { status: "ready", payload: { actions: [{ id: "post", name: "Post orders", description: null }], workflows: [] } },
    { status: "ready", payload: catalogue.data.map(app => app.id === "agents" ? { ...app, scheduleAdapter: "java:agents" } : app) },
    { status: "ready", payload: { inspection: { allowed: true }, caseSets: { allowed: false, reason: "Case sets refused" } },
      visibility: { AGENT: { USE: { fixed: false, all: false, authorId: null, objectIds: [...agentIds] } } } },
  ];
}

it("keeps a native Trigger create draft in Node and shows only its admitted Java targets", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" }, {
    values: { task: { title: "Draft orders", targetKind: "action", targetId: "private-action" } }, changedField: "/task/targetId",
  }, viewer)!;
  expect(plan.facts.map(fact => fact.call)).toEqual([
    { type: TRIGGER, name: "createForm", parameters: {} },
    { type: TRIGGER, name: "targets", parameters: {} },
    { type: "platform:Application", name: "scheduleTargets", parameters: {} },
    { type: TRIGGER, name: "applicationLabelAccess", parameters: {} },
  ]);
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, ...triggerFormFacts(),
  ]));
  expect(form.values.task).toMatchObject({ title: "Draft orders", targetKind: "action", targetId: "private-action", timeZone: "UTC" });
  expect(form.fields.find(field => field.path === "/task/targetId")?.control).toMatchObject({
    kind: "select", options: expect.arrayContaining([expect.objectContaining({ value: "post", label: "Post orders" })]),
  });
  expect(form.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "/task/targetId", code: "invalid_option" })]));
  expect(form.save.path).toContain("/platform/triggers");
  expect(fetch).not.toHaveBeenCalled();
});

it("reads the original agent form using the stored task and present edit and use decisions", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentId = agentTask.content.agentId!;
  directory.agents.mockClear().mockResolvedValue([{
    id: agentId, name: "Inventory assistant", description: "", enabled: true,
    domain_id: owner.domainId, owner_id: "another-member",
  }]);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "form", primaryKey: agentTask.id },
    { values: { instruction: "Review new inventory" } }, viewer)!;
  expect(plan.facts[0]).toEqual({ call: { type: TRIGGER, name: "form", parameters: { primaryKey: agentTask.id } } });
  await expect(plan.present(owner, [
    { status: "ready", payload: { task: agentTask, edit: { allowed: false, reason: "Edit refused" } } },
    ...triggerFormFacts([agentId]),
  ])).rejects.toMatchObject({ status: 403, message: "Edit refused" });
  expect(directory.agents).not.toHaveBeenCalled();
  const state = { status: "ready" as const, payload: { task: agentTask, edit: { allowed: true } } };
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [state, ...triggerFormFacts([agentId])]));
  expect(form.values).toMatchObject({ agentId, instruction: "Review new inventory" });
  expect(form.revision).toBe(agentTask.revision);
  expect(form.errors).toEqual([]);
  const forbidden = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [state, ...triggerFormFacts()]));
  expect(forbidden.fields.find(field => field.path === "/agentId")?.control).toMatchObject({
    kind: "select", options: [expect.objectContaining({ value: agentId, label: agentId, disabled: true, disabledReason: "Agent use permission required" })],
  });
  const [targets, , access] = triggerFormFacts([agentId]);
  await expect(plan.present(owner, [
    state, targets,
    { status: "ready", payload: catalogue.data.map(app => app.id === "agents" ? { ...app, scheduleAdapter: "java:other" } : app) },
    access,
  ])).rejects.toMatchObject({ status: 502, code: "DEPENDENCY_UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the admitted operations branch and the scoped diagnosis option without checking Java again", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  directory.opsDiagnosis.mockResolvedValueOnce({ id: "diagnosis", domain_id: owner.domainId, owner_id: "another-member", enabled: true });
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" },
    { defaultAppId: "operations" }, viewer)!;
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, ...triggerFormFacts(["diagnosis"]),
  ]));
  expect(form.values).toMatchObject({ operation: "inspection", task: { appId: "operations", timeZone: "UTC" } });
  expect(form.fields.some(field => field.path === "/instruction")).toBe(true);
  expect(form.fields.some(field => field.path === "/caseSetId")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("retains the selected workspace task and the agent default in the registered Trigger reads", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentId = agentTask.content.agentId!;
  directory.agents.mockResolvedValueOnce([{
    id: agentId, name: "Inventory assistant", description: "", enabled: true,
    domain_id: owner.domainId, owner_id: "another-member",
  }]);
  const [targets, applications, permissions] = triggerFormFacts([agentId]);
  const catalogueRead = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "catalogue" }, {
    workspace: "agent", workspaceAgent: agentId, selectedTask: { className: TRIGGER, primaryKey: triggerFixture.id },
  }, viewer)!;
  const rows = unwrapReadDirective(await catalogueRead.present(owner, [
    { status: "ready", payload: { tasks: [triggerFixture, agentTask], timeZone: "UTC" } }, applications, permissions,
  ])).value;
  expect(rows).toMatchObject([{ primaryKey: triggerFixture.id }]);

  const create = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" }, {
    defaultAppId: "agents", defaultAgentId: agentId,
  }, viewer)!;
  const form = panelReadResultSchemas.panelFormDescription.parse(await create.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, targets, applications, permissions,
  ]));
  expect(form.values).toMatchObject({ agentId, task: { appId: "agents" } });
  expect(fetch).not.toHaveBeenCalled();
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
