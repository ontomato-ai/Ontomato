import { expect, it, vi } from "vitest";
import { CREATE_TRIGGER, DELETE_TRIGGER, RUN_NOW, SET_TRIGGER_STATUS, TRIGGER } from "@ontomato/contracts/platform-object-types";
import { platformSchedulesPath, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import examples from "../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskServerOperations } from "../panel-server-operations";

const operations = createScheduledTaskServerOperations((_, key) => key);
const example = examples.creates[0];
const action = platformTaskSchema.parse(example.response);
const idempotencyKey = example.headers["Idempotency-Key"];
const target = { kind: "object", objectType: TRIGGER, primaryKey: "legacy:correct status" } as const;
const recordPath = `${platformSchedulesPath}/${encodeURIComponent(target.primaryKey)}`;

it("submits native parameters and explicit run-start dates without an application lookup", async () => {
  const create = operations.find(operation => operation.handlerRef === CREATE_TRIGGER)!;
  const { content, ...settings } = example.request;
  const host = { request: vi.fn(async (path: string, init: RequestInit) => {
    expect(path).toBe(`${platformSchedulesPath}?enabled=false`);
    expect(init.headers).toMatchObject({ "Idempotency-Key": idempotencyKey });
    expect(JSON.parse(String(init.body))).toMatchObject({
      targetKind: "action", targetId: "correct-status", executorId: "member-b", coauthorIds: ["member-c"], content,
    });
    return Response.json({ ...action, status: "PENDING_REVIEW", enabled: false, nextRunAt: null });
  }) };
  const { appId: _appId, formRevision: _formRevision, ...panelSettings } = settings;
  const outcome = await create.execute(host, { kind: "draft" }, { values: {
    task: { ...panelSettings, executorId: "member-b", coauthorIds: ["member-c"], capabilityContent: content, enabled: false },
  } }, idempotencyKey);
  expect(host.request).toHaveBeenCalledOnce();
  expect(outcome).toMatchObject({ kind: "success", created: { objectType: TRIGGER, primaryKey: action.id } });
});

it("edits and publishes a trigger with a text ID, preserving the observed revision and unedited typed parameters", async () => {
  const [save] = operations;
  const publish = operations.find(operation => operation.handlerRef === SET_TRIGGER_STATUS)!;
  const request = vi.fn(async (path: string, init: RequestInit) => {
    if (!init.method) return Response.json({ ...action, id: target.primaryKey, revision: 8 });
    expect(init.method).toBe("PUT");
    if (path.endsWith("/status")) {
      expect(path).toBe(`${recordPath}/status`);
      expect(JSON.parse(String(init.body))).toEqual({ status: "PUBLISHED", revision: 8, enabled: false });
    } else {
      expect(path).toBe(recordPath);
      expect(JSON.parse(String(init.body))).toMatchObject({
        content: { ...action.content, runStartParameters: ["requestedAt"] }, executorId: action.executorId, revision: 7,
      });
    }
    return Response.json({ ...action, id: target.primaryKey });
  });
  const result = await save.execute({ request }, target, {
    values: { task: { capabilityContent: { runStartParameters: ["requestedAt"], parameters: { ignored: true } } } },
    submittedFields: ["/task/capabilityContent/runStartParameters"], revision: 7,
  }, idempotencyKey);
  expect(result).toMatchObject({ kind: "success", affected: { objects: [{ objectType: TRIGGER, primaryKey: target.primaryKey }] } });
  expect(await publish.execute({ request }, target, { status: "PUBLISHED", revision: 8, enabled: false })).toMatchObject({ kind: "success" });
});

it("uses the application's replacement form after changing its selector, without writing the old dependent values", async () => {
  const [save] = operations;
  const original = examples.creates.find(item => item.name === "operations-autotest")!.response;
  const replacement = examples.forms.find(item => item.name === "operations-switch-to-inspection")!.response;
  const content = { operation: "inspection", instruction: "Inspect the latest run" };
  const request = vi.fn(async (_path: string, init: RequestInit) => {
    if (!init.method) return Response.json(original);
    if (init.method === "POST") return Response.json({ ...replacement, values: content, submittable: true });
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ formRevision: replacement.formRevision });
    expect(JSON.parse(String(init.body)).content).toEqual(content);
    return Response.json({ ...original, content, formRevision: replacement.formRevision });
  });
  const operationTarget = { ...target, primaryKey: original.id };
  expect(await save.execute({ request }, operationTarget, {
    values: content, submittedFields: ["/operation", "/instruction"], revision: original.revision,
  }, idempotencyKey)).toMatchObject({ kind: "success", data: { content } });
});

it("routes run and delete independently on the same text identity", async () => {
  const run = operations.find(operation => operation.handlerRef === RUN_NOW)!;
  const remove = operations.find(operation => operation.handlerRef === DELETE_TRIGGER)!;
  const request = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method === "POST") {
      expect(path).toBe(`${recordPath}/runs`);
      expect(init.headers).toMatchObject({ "Idempotency-Key": idempotencyKey });
      return Response.json({ ...examples.runs[0].response, taskId: target.primaryKey });
    }
    expect(init.method).toBe("DELETE");
    expect(path).toBe(recordPath);
    expect(init.headers).toMatchObject({ "If-Match": '"7"' });
    return new Response(null, { status: 204 });
  });
  expect(await run.execute({ request }, target, {}, idempotencyKey)).toMatchObject({ kind: "success" });
  expect(await remove.execute({ request }, target, { revision: 7 })).toMatchObject({
    kind: "success", affected: { removed: [{ objectType: TRIGGER, primaryKey: target.primaryKey }] },
  });
});
