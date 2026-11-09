import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as contract from "../src/platform-schedules.ts";

// These are wire fixtures for all producers and consumers. They do not simulate the application services.
const examples = JSON.parse(await readFile(new URL("../examples/platform-schedules.json", import.meta.url), "utf8"));
function roundTrip(schema, value) {
  const parsed = schema.parse(value);
  assert.deepEqual(schema.parse(JSON.parse(JSON.stringify(parsed))), parsed);
  return parsed;
}
const form = (name) => examples.forms.find((example) => example.name === name).response;
const run = (name) => examples.runs.find((example) => example.name === name).response;

test("application descriptions round trip in either locale and remain an explicit nullable field", () => {
  for (const exchange of [examples.applications, examples.applicationsEnglish]) {
    const parsed = roundTrip(contract.platformScheduleApplicationsSchema, exchange.response);
    assert.deepEqual(parsed.applications.map((value) => value.description), exchange.response.applications.map((value) => value.description));
  }
  const application = examples.applications.response.applications[0];
  contract.platformScheduleApplicationSchema.parse({ ...application, description: null });
  assert.equal(contract.platformScheduleApplicationSchema.safeParse({ ...application, description: undefined }).success, false);
  assert.equal(contract.platformScheduleApplicationSchema.safeParse({ ...application, description: 12 }).success, false);
});

test("shared form and create exchanges cover all four applications", () => {
  roundTrip(contract.platformScheduleApplicationsSchema, examples.applications.response);
  for (const example of examples.forms) {
    roundTrip(contract.platformScheduleFormRequestSchema, example.request);
    roundTrip(contract.platformScheduleFormSchema, example.response);
    assert.equal(example.response.appId, example.appId);
  }
  for (const example of examples.creates) {
    roundTrip(contract.platformTaskInputSchema, example.request);
    const task = roundTrip(contract.platformTaskSchema, example.response);
    contract.platformScheduleIdempotencyKeySchema.parse(example.headers["Idempotency-Key"]);
    assert.equal(task.id, example.headers["Idempotency-Key"]);
    assert.deepEqual(task.content, example.request.content);
  }
  assert.deepEqual(new Set(examples.creates.map((example) => example.request.appId)), new Set(["ontology", "agents", "operations", "governance"]));
});

test("a form is replaced as a whole: stale hidden values, duplicate field IDs and option IDs are rejected", () => {
  for (const example of examples.forms.filter((value) => value.request.changedField !== null)) {
    const merged = structuredClone(example.response);
    merged.values = { ...example.request.values, ...merged.values };
    assert.equal(contract.platformScheduleFormSchema.safeParse(merged).success, false, example.name);
  }
  const duplicate = structuredClone(form("governance-empty"));
  duplicate.fields.push(duplicate.fields[0]);
  assert.equal(contract.platformScheduleFormSchema.safeParse(duplicate).success, false);
  const duplicateOptions = structuredClone(form("agents-empty"));
  duplicateOptions.fields[0].options.push(duplicateOptions.fields[0].options[0]);
  assert.equal(contract.platformScheduleFormSchema.safeParse(duplicateOptions).success, false);
});

test("an unavailable historical selection is readable but cannot be declared submittable", () => {
  const unavailable = structuredClone(form("edit-unavailable-agent"));
  contract.platformScheduleFormSchema.parse(unavailable);
  unavailable.submittable = true;
  assert.equal(contract.platformScheduleFormSchema.safeParse(unavailable).success, false);
  unavailable.errors = [];
  assert.equal(contract.platformScheduleFormSchema.safeParse(unavailable).success, false);
  const empty = structuredClone(form("governance-empty"));
  empty.submittable = true;
  assert.equal(contract.platformScheduleFormSchema.safeParse(empty).success, false);
});

test("application IDs are open, while old targets, arbitrary controls and client-supplied ownership are rejected", () => {
  const input = structuredClone(examples.creates[1].request);
  contract.platformTaskInputSchema.parse({ ...input, appId: "customer-app" });
  for (const extra of [{ creatorId: "other-user" }, { ownerId: "other-user" }, { target: { kind: "function", functionId: "f" } }, { name: "old title" }, { summary: [] }])
    assert.equal(contract.platformTaskInputSchema.safeParse({ ...input, ...extra }).success, false);
  for (const appId of ["../agents", "agents/foo", "https://example.com", "Agents"])
    assert.equal(contract.platformTaskAppSchema.safeParse(appId).success, false);
  const field = { ...form("governance-empty").fields[0], type: "date" };
  assert.equal(contract.platformScheduleFormFieldSchema.safeParse(field).success, false);
  assert.equal(contract.platformTaskListQuerySchema.safeParse({ agentId: "20000000-0000-4000-8000-000000000001" }).success, false);
});

test("content preserves line arrays and local time text; UTF-8 limits cannot be bypassed with multibyte text", () => {
  const input = examples.creates[0].request;
  const parsed = contract.platformTaskInputSchema.parse(input);
  assert.equal(parsed.content["parameter:departments"], "销售部\n\n市场部");
  assert.equal(parsed.content["parameter:cutoff"], "");
  assert.equal(parsed.content["parameter:checkpoints"], "2026-11-06\n2026-11-07 09:30\n2026-11-08T01:30:00Z");
  const within = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`field-${index}`, "中".repeat(4000)]));
  contract.platformScheduleContentSchema.parse(within);
  assert.equal(contract.platformScheduleContentSchema.safeParse({ ...within, extra: "中".repeat(4000) }).success, false);
  assert.equal(contract.platformScheduleContentSchema.safeParse({ instruction: "x".repeat(4001) }).success, false);
  assert.equal(contract.platformScheduleContentSchema.safeParse(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), ""]))).success, false);
});

test("frequency boundaries remain shared while Spring owns cron interpretation", () => {
  for (const value of examples.frequencies) roundTrip(contract.platformTaskFrequencySchema, value);
  for (const value of [
    { kind: "interval", every: 0, unit: "hour" }, { kind: "interval", every: 1.5, unit: "day" },
    { kind: "daily", time: "24:00" }, { kind: "weekly", weekday: 0, time: "12:00" },
    { kind: "monthly", day: 32, time: "12:00" }, { kind: "cron", expression: " " },
  ]) assert.equal(contract.platformTaskFrequencySchema.safeParse(value).success, false);
  contract.platformScheduleTimeZoneSchema.parse("Asia/Shanghai");
  contract.platformScheduleTimeZoneSchema.parse("UTC");
  assert.equal(contract.platformScheduleTimeZoneSchema.safeParse("invalid/timezone").success, false);
});

test("execution summaries, immutable snapshots and pages round trip without the old target or session fields", () => {
  for (const example of examples.runs) roundTrip(contract.platformTaskRunSchema, example.response);
  roundTrip(contract.platformTaskRunPageSchema, { runs: examples.runs.map((example) => example.response), nextCursor: null });
  const task = structuredClone(examples.creates[1].response);
  const latest = structuredClone(run("agents-running"));
  delete latest.snapshot;
  delete latest.result;
  delete latest.executionDetails;
  task.lastRun = latest;
  task.activeRunId = latest.id;
  task.latestResult = { runId: latest.id, link: latest.resultLink };
  roundTrip(contract.platformTaskListSchema, { tasks: [task], timeZone: "Asia/Shanghai" });
  task.activeRunId = null;
  assert.equal(contract.platformTaskSchema.safeParse(task).success, false);
});

test("running, completed, failed and skipped executions cannot contradict their finish time or reason", () => {
  const running = run("agents-running");
  assert.equal(contract.platformTaskRunSchema.safeParse({ ...running, finishedAt: running.startedAt }).success, false);
  const completed = run("governance-completed");
  assert.equal(contract.platformTaskRunSchema.safeParse({ ...completed, error: { code: "run_failed", message: null } }).success, false);
  const skipped = run("operations-batch-skipped");
  assert.equal(contract.platformTaskRunSchema.safeParse({ ...skipped, status: "failed" }).success, false);
  const failed = run("operations-lost-busy-response-is-interrupted");
  assert.equal(contract.platformTaskRunSchema.safeParse({ ...failed, error: null }).success, false);
});

test("revision checks cover update, enabled and If-Match without reusing a task definition as a command", () => {
  const { update, disable, delete: deletion } = examples.mutations;
  roundTrip(contract.platformTaskUpdateSchema, update.request);
  roundTrip(contract.platformTaskSchema, update.response);
  roundTrip(contract.platformTaskEnabledSchema, disable.request);
  roundTrip(contract.platformTaskSchema, disable.response);
  contract.platformTaskIfMatchSchema.parse(deletion.headers["If-Match"]);
  for (const invalid of ["3", "\"0\"", "\"-1\"", "\"9007199254740992\""])
    assert.equal(contract.platformTaskIfMatchSchema.safeParse(invalid).success, false);
  assert.equal(contract.platformTaskUpdateSchema.safeParse({ ...update.request, revision: 0 }).success, false);
  assert.deepEqual(contract.platformTaskCreateQuerySchema.parse({}), { enabled: true });
  assert.deepEqual(contract.platformTaskRunPageQuerySchema.parse({}), { limit: 20 });
});

test("user-disabled, system-paused and failed tasks remain distinct", () => {
  const task = structuredClone(examples.creates[0].response);
  const paused = { ...task, nextRunAt: null, pause: { code: "permission_denied", message: "执行权限已撤销" } };
  contract.platformTaskSchema.parse(paused);
  assert.equal(contract.platformTaskSchema.safeParse({ ...paused, enabled: false }).success, false);
  assert.equal(contract.platformTaskSchema.safeParse({ ...paused, nextRunAt: task.nextRunAt }).success, false);
  contract.platformTaskSchema.parse({ ...task, enabled: false, nextRunAt: null });
});

test("error exchanges carry field pointers and FORM_CHANGED always contains a replacement form", () => {
  for (const example of examples.errors) roundTrip(contract.platformScheduleErrorSchema, example.response);
  const changed = structuredClone(examples.errors.find((example) => example.name === "form-changed").response);
  delete changed.error.form;
  assert.equal(contract.platformScheduleErrorSchema.safeParse(changed).success, false);
  contract.platformScheduleFieldErrorSchema.parse({ field: "/content/parameter:region~1name~0", code: "required", message: "Required" });
  assert.equal(contract.platformScheduleFieldErrorSchema.safeParse({ field: "/content/bad~escape", code: "required", message: "Required" }).success, false);
});

test("application result links are same-origin paths, including ontology's execution-history exception", () => {
  for (const example of examples.runs)
    if (example.response.resultLink) roundTrip(contract.platformScheduleResultLinkSchema, example.response.resultLink);
  for (const path of ["https://example.com/", "%2Fagents/chat", "//example.com/", "/%2Fexample.com/", "/%5Cexample.com/", "/\\example.com/", "/ok\nheader", "/%00", "/bad%escape"])
    assert.equal(contract.platformScheduleResultLinkSchema.safeParse({ appId: "agents", path }).success, false, path);
});

test("service exchanges use stable execution IDs and opaque handles without online credentials in the body", () => {
  for (const example of examples.serviceExchanges) {
    roundTrip(contract.platformScheduleExecutionRequestSchema, example.request);
    roundTrip(contract.platformScheduleExecutionStateSchema, example.response);
    roundTrip(contract.platformScheduleExecutionStatusRequestSchema, {
      taskId: example.request.taskId, runId: example.request.runId,
      owner: { userId: "member-a", domainId: "domain-a" }, handle: example.response.handle,
    });
    assert.equal(contract.platformScheduleExecutionRequestSchema.safeParse({ ...example.request, apiKey: "not-a-body-field" }).success, false);
  }
  const state = examples.serviceExchanges[0].response;
  assert.equal(contract.platformScheduleExecutionStateSchema.safeParse({ ...state, error: { code: "run_failed", message: null } }).success, false);
  assert.equal(contract.platformScheduleHandleSchema.safeParse({ value: "中".repeat(3000) }).success, false);
  const request = { content: examples.creates[1].request.content, formRevision: "agents-v1", timeZone: "Asia/Shanghai" };
  roundTrip(contract.platformScheduleValidationRequestSchema, request);
  roundTrip(contract.platformScheduleValidationSchema, { ...request, summary: examples.creates[1].response.summary, references: null });
});
