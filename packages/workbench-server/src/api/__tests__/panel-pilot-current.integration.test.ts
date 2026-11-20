import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { platformScheduleFormSchema, platformTaskRunSchema, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import { scheduledTaskPanelMessages, scheduledTaskPanelTextZhCn } from "@ontomato/platform-schedules/panel-text";
import examples from "../../../../contracts/examples/platform-schedules.json";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }) } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server;
let contentRoot: string;
const resourceIds = new Set<string>();
const projectionId = "projection-pilot-summary";
const panelId = "panel-schedules-pilot";
const task = platformTaskSchema.parse(examples.creates.find(item => item.name === "governance-instruction")!.response);
const taskForm = platformScheduleFormSchema.parse(examples.forms.find(item => item.name === "governance-ready")!.response);
const taskRun = platformTaskRunSchema.parse({
  ...examples.runs.find(item => item.name === "agents-running")!.response, taskId: task.id,
});
const ownerWrites: string[] = [];
let ownerTasks: typeof task[] = [];
const taskType = { kind: "object", objectType: "platform:ScheduledTask" };
const projection = {
  name: "Task summary", description: "", visibility: "domain",
  componentId: "@ontomato/sdk:ObjectSummary",
  inputs: { task: taskType },
  outputs: {},
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  config: { fields: ["state"] },
};
const panel = {
  name: "Schedules", description: "", visibility: "domain",
  content: { html: '<section flow="column"><panel-member ref="summary"></panel-member><panel-member ref="tasks"></panel-member><panel-member ref="form"></panel-member><panel-member ref="run"></panel-member></section>' },
  manifest: {
    state: { selectedTask: { type: taskType, deepLink: true, external: true, personal: false, default: null } },
    members: {
      summary: { target: { projectionId }, inputs: { task: { state: "selectedTask" } }, params: { width: "full" } },
      tasks: { target: { projectionId: "projection-pilot-list" } },
      form: { target: { projectionId: "projection-pilot-form" }, inputs: { task: { state: "selectedTask" } } },
      run: { target: { projectionId: "projection-pilot-run" }, inputs: { task: { state: "selectedTask" } } },
    },
    events: {},
  },
};

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      "zh-CN": { ...enLocaleMeta, messages: scheduledTaskPanelMessages(scheduledTaskPanelTextZhCn) },
    },
  });
  state.schema = `panel_pilot_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "panel-pilot-"));
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { ensurePanelOperationsSchema } = await import("../../infrastructure/postgres-migrations/20261118-panel-operations/schema");
  await ensurePanelOperationsSchema(state.pool);
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    resourceIds.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ allowed: resourceIds.has(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ ids: [...resourceIds] });
  });
  app.get("/platform/applications/app-schedules/panel-uses", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ success: true, data: {
      applicationId: "app-schedules",
      entry: { path: "/applications/app-schedules", renderer: "panels" },
      panelUses: [{ id: "pilot", pageKey: "pilot", path: "/applications/app-schedules/pilot", panelId,
        access: { kind: "domain-member" } }],
    } });
  });
  app.get("/platform/scheduled-tasks", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ tasks: ownerTasks, timeZone: task.timeZone });
  });
  app.get("/platform/scheduled-tasks/:taskId", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    if (req.params.taskId === task.id) { res.json(task); return; }
    res.status(404).json({ message: "Task no longer exists" });
  });
  app.post("/platform/scheduled-tasks/applications/:appId/form", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.params.appId).toBe(task.appId);
    expect(req.body).toMatchObject({ taskId: task.id, values: task.content, changedField: null });
    res.json(taskForm);
  });
  app.put("/platform/scheduled-tasks/:taskId", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.params.taskId).toBe(task.id);
    expect(req.body.revision).toBe(task.revision);
    ownerWrites.push("save");
    res.json({ ...task, revision: task.revision + 1 });
  });
  app.post("/platform/scheduled-tasks/:taskId/runs", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.params.taskId).toBe(task.id);
    ownerWrites.push("runNow");
    res.json(taskRun);
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: "pilot", userId: "reader", token: "pilot-reader", locale: req.header("Accept-Language") });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object, locale = "zh-CN") {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify(body),
  });
}

it("reads back stable member keys and named data, and leaves the record intact after a rejected update", async () => {
  const projectionPath = `product-projections/${projectionId}`;
  const panelPath = `product-panels/${panelId}`;
  const projectionWrite = await request("PUT", projectionPath, { ...projection, revision: 0 });
  expect(projectionWrite.status, await projectionWrite.text()).toBe(200);
  expect(await (await request("GET", projectionPath)).json()).toMatchObject({
    projection: { id: projectionId, data: projection.data },
  });
  const listWrite = await request("PUT", "product-projections/projection-pilot-list", {
    name: "Tasks", description: "", visibility: "domain", revision: 0, componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: taskType.objectType } }, read: "list", params: {} } },
  });
  expect(listWrite.status, await listWrite.text()).toBe(200);
  const formWrite = await request("PUT", "product-projections/projection-pilot-form", {
    ...projection, componentId: "@ontomato/sdk:ObjectForm", revision: 0,
    data: { form: { ...projection.data.record, read: "form" } },
  });
  expect(formWrite.status, await formWrite.text()).toBe(200);
  const runWrite = await request("PUT", "product-projections/projection-pilot-run", {
    ...projection, componentId: "@ontomato/sdk:OperationButton", revision: 0,
    data: { operation: { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} } },
  });
  expect(runWrite.status, await runWrite.text()).toBe(200);
  const panelWrite = await request("PUT", panelPath, { ...panel, revision: 0 });
  expect(panelWrite.status, await panelWrite.text()).toBe(200);
  const original = (await (await request("GET", panelPath)).json()).panel;
  expect(original).toMatchObject({ id: panelId, revision: 1, manifest: { members: panel.manifest.members } });

  expect((await request("PUT", panelPath, { ...panel, revision: original.revision })).status).toBe(200);
  expect((await request("PUT", panelPath, { ...panel, revision: original.revision })).status).toBe(409);
  const current = (await (await request("GET", panelPath)).json()).panel;
  const malformed = { ...panel, content: { html: '<section invented="true"></section>' }, revision: current.revision };
  const rejected = await request("PUT", panelPath, malformed);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: { message: expect.stringMatching(/^1:\d+ .*invented/u) } });
  expect((await (await request("GET", panelPath)).json()).panel).toEqual(current);

  const source = { kind: "registered", applicationId: "app-schedules", useId: "pilot" };
  const read = (member: string, dataName: string, inputs: object, locale?: string) =>
    request("POST", "product-panels/read", { source, memberPath: [{ member }], dataName, inputs }, locale);
  const taskRef = { className: taskType.objectType, primaryKey: task.id };
  const fieldLabels = { application: "应用", settings: "配置", state: "状态", nextRun: "下次运行", lastRun: "上次运行" };
  const record = await (await read("summary", "record", { task: taskRef })).json();
  expect(record).toMatchObject({
    status: "ready", value: { primaryKey: task.id, label: task.title, fieldLabels },
  });
  expect(await (await read("summary", "record", { task: taskRef }, "en")).json()).toMatchObject({
    status: "ready", value: { primaryKey: task.id, fieldLabels: { application: "Application", state: "Status" } },
  });
  expect(await (await read("tasks", "rows", {})).json()).toEqual({ status: "empty" });
  ownerTasks = [task];
  const rows = await (await read("tasks", "rows", {})).json();
  expect(rows).toMatchObject({ status: "ready", value: [{ primaryKey: task.id, fieldLabels }] });
  expect(await (await read("related", "record", { task: taskRef })).json()).toEqual({ status: "forbidden" });
  expect(await (await read("summary", "record", { task: { ...taskRef, primaryKey: "removed" } })).json()).toEqual({
    status: "error", message: "Task no longer exists",
  });
  expect(await (await read("form", "form", { task: taskRef })).json()).toMatchObject({
    status: "ready", value: { revision: task.revision },
  });
  const operation = await (await read("run", "operation", {})).json();
  expect(operation).toMatchObject({
    status: "ready", value: { effect: "write", handlerRef: "schedules.runNow", label: "立即运行" },
  });
  const target = { kind: "object", objectType: taskType.objectType, primaryKey: task.id };
  let runNowReceipt: unknown;
  for (const [operationId, input] of [
    ["form.save", { values: task.content, revision: task.revision }], ["run.runNow", {}],
  ] as const) {
    const prepared = await request("POST", "panel-operations/intents", {
      applicationId: source.applicationId, useId: source.useId, operationId, call: { target, input },
    });
    const { intentId, ...preparation } = await prepared.json();
    expect(prepared.status, JSON.stringify(preparation)).toBe(200);
    expect(preparation).toMatchObject({ operationId, confirmation: { kind: "none" } });
    const dispatch = `panel-operations/intents/${intentId}/dispatch`;
    const receipt = await (await request("POST", dispatch, {})).json();
    expect(receipt).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    if (operationId === "run.runNow") {
      expect(receipt).toMatchObject({ outcome: { message: "已开始运行。", data: { status: "running", taskId: task.id } } });
      runNowReceipt = receipt;
    }
    expect(await (await request("POST", dispatch, {})).json()).toEqual(receipt);
  }
  expect(ownerWrites).toEqual(["save", "runNow"]);
  const evidence = process.env.SCHEDULED_TASK_PANEL_HTTP_EVIDENCE;
  if (evidence) {
    await writeFile(evidence, JSON.stringify({ rows, record, operation, runNowReceipt }, null, 2) + "\n");
  }
});

it("rejects reader requests carrying a caller-selected URL or handler", async () => {
  const read = {
    source: { kind: "registered", applicationId: "app-schedules", useId: "pilot" },
    memberPath: [{ member: "summary" }], dataName: "record", inputs: {},
  };
  expect((await request("POST", "product-panels/read", { ...read, url: "/api/other-owner" })).status).toBe(400);
  expect((await request("POST", "product-panels/read", { ...read, handler: "otherOwner.record" })).status).toBe(400);
  expect((await request("POST", "product-panels/read", { ...read, executor: "another-user" })).status).toBe(400);
});
