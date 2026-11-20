import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { appsSdkComponentCatalogSchema } from "@ontomato/contracts/apps-sdk";
import { fileURLToPath } from "node:url";
import { panelFormDescriptionSchema, panelOptionListSchema } from "@ontomato/contracts/panel-projection";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { platformScheduleFormSchema, platformTaskRunSchema, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import { scheduledTaskPanelMessages, scheduledTaskPanelTextZhCn } from "@ontomato/platform-schedules/panel-text";
import examples from "../../../../contracts/examples/platform-schedules.json";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureAgentExecutionSchema } from "../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { HttpError } from "../../utils/errors";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "", allowAgentReads: true }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "" } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));
vi.mock("../../identity/installed", async original => ({
  ...await original<typeof import("../../identity/installed")>(),
  assertPermission: async ({ token }: { token: string }, keys: readonly string[]) => {
    expect(token).toBe("pilot-reader");
    expect(keys).toEqual(["analysis-agent"]);
    if (!state.allowAgentReads) throw new HttpError(403, "Forbidden", "FORBIDDEN");
  },
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server;
let contentRoot: string;
let cataloguePath: string;
const resourceIds = new Set<string>();
const projectionId = "projection-pilot-summary";
const panelId = "panel-schedules-pilot";
const graphPanelId = "panel-ontology-pilot";
const dataPanelId = "panel-data-port-pilot";
const agentPanelId = "panel-agent-settings-pilot";
const agentId = randomUUID();
const task = platformTaskSchema.parse(examples.creates.find(item => item.name === "governance-instruction")!.response);
const taskForm = platformScheduleFormSchema.parse(examples.forms.find(item => item.name === "governance-ready")!.response);
const taskRun = platformTaskRunSchema.parse({
  ...examples.runs.find(item => item.name === "agents-running")!.response, taskId: task.id,
});
const ownerWrites: string[] = [];
let ownerTasks: typeof task[] = [];
const taskType = { kind: "object", objectType: "platform:ScheduledTask" };
/** The metric owner's output columns, its partial-result mark, and the refusals it answers some years with. */
const columns = [{ key: "value", label: null, type: null }];
const metricTruncation = { truncated: true as const, rowLimit: 1, truncationHint: "Narrow the year to see every customer" };
const metricRefusals: Record<number, { status: number; message: string }> = {
  1990: { status: 400, message: "Missing parameter: region" },
  1991: { status: 403, message: "Field is outside the authorized scope" },
  1992: { status: 404, message: "Executable read metric not found" },
  1993: { status: 409, message: "Metric specification changed; retrieve it again" },
};
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
  content: { html: '<section style="display:flex;flex-direction:column">'
    + '<panel-member ref="summary" style="width:100%"></panel-member>'
    + '<panel-member ref="tasks"></panel-member><panel-member ref="form"></panel-member>'
    + '<panel-member ref="run"></panel-member></section>' },
  manifest: {
    state: { selectedTask: { type: taskType, deepLink: true, external: true, personal: false, default: null } },
    members: {
      summary: { target: { projectionId }, inputs: { task: { state: "selectedTask" } } },
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
      "zh-CN": { ...enLocaleMeta, messages: {
        ...scheduledTaskPanelMessages(scheduledTaskPanelTextZhCn),
        "assistant.default.knowledge-governance.name": "知识治理",
        "assistant.skills.unavailable.name": "技能不可用",
        "assistant.skills.unavailable.reason": "你无法使用此技能。",
      } },
    },
  });
  state.schema = `panel_pilot_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensureAssistantSchema(state.pool);
  await ensureAssistantDefaultPromptSchema(state.pool);
  await ensureAgentExecutionSchema(state.pool);
  await state.pool.query(
    `INSERT INTO "${state.schema}".assistant_agents (id,domain_id,kind,name,description,system_prompt,enabled)
     VALUES ($1,'pilot','custom','Inventory analyst','Inventory summary','Read inventory',false)`, [agentId],
  );
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "panel-pilot-"));
  cataloguePath = await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({
    runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, runtimeResources: [],
    prompts: [{ from: fileURLToPath(new URL("../../../prompts", import.meta.url)), to: "." }],
  });

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
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== "app-schedules") { next(); return; }
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ success: true, data: {
      applicationId: "app-schedules",
      menu: { groups: [], panelUses: [] },
      use: { id: "pilot", pageKey: "pilot", path: "/applications/app-schedules/pilot", panelId,
        access: { kind: "domain-member" } },
    } });
  });
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== "ontology-pilot") { next(); return; }
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ success: true, data: {
      applicationId: "ontology-pilot", menu: { groups: [], panelUses: [] },
      use: req.query.useId === "data" ? {
        id: "data", pageKey: "data", path: "/applications/ontology-pilot/data", panelId: dataPanelId,
        access: { kind: "domain-member" },
      } : {
        id: "graph", pageKey: "graph", path: "/applications/ontology-pilot/graph", panelId: graphPanelId,
        access: { kind: "domain-member" },
      },
    } });
  });
  app.post("/admin/getMetas", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    res.json({ success: true, data: {
      classDef: [{ className: "warehouse", showName: "Warehouse", attrs: [] }, { className: "item", attrs: [] }],
      relationship_rule: { contains: { fromclass: "warehouse", toclass: "item", desc: "Contains" } },
    } });
  });
  app.get("/ontology/model/field-labels", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    res.json({ objectType: { className: "API 名称" }, attribute: { name: "API 名称" }, relationship: { fromclass: "来源对象" } });
  });
  app.get("/ontology/model/object-types", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    res.json([{ className: "warehouse", showName: "Warehouse", classDesc: "", attributeCount: 1,
      businessKeyCount: 0, relationshipCount: 1, primaryKey: { status: "ok", name: "id" } }]);
  });
  app.get("/ontology/model/relationships", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    const relationship = { relationship: "contains", fromclass: "warehouse", toclass: "item", desc: "Contains", fromField: "id", toField: "store" };
    if (req.query.className === "person") {
      res.json([{ ...relationship, relationship: "person_to_org", fromclass: "person", toclass: "org" }]);
    } else {
      res.json(req.query.className === "item" ? [{ ...relationship, relationship: "filtered-contains" }] : [relationship]);
    }
  });
  app.get("/ontology/model/attributes", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    const className = req.query.className;
    expect(["warehouse", "person", "org"]).toContain(className);
    const primary = { className, name: "id", showName: "Identifier", type: "string", attrDesc: "",
      enable: true, businessKey: false, primaryKey: true };
    res.json(className === "warehouse" ? [primary] : [
      primary, { ...primary, name: "name", showName: "Name", primaryKey: false, businessKey: true },
    ]);
  });
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== "agent-settings") { next(); return; }
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ success: true, data: {
      applicationId: "agent-settings", menu: { groups: [], panelUses: [] },
      use: {
        id: "settings", pageKey: "settings", path: "/applications/agent-settings/settings", panelId: agentPanelId,
        access: { kind: "domain-member" },
      },
    } });
  });
  app.get("/platform/page-skills", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    res.json({ success: true, data: { pageSkills: [], registeredSkills: [], admittedEntrances: [] } });
  });
  app.get("/model-options", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    res.json({ success: true, data: {
      models: [
        { type: "chat", ref: "demo/chat", name: "Demo Chat" },
        { type: "embedding", ref: "demo/embed", name: "Demo Embedding", dimensions: 3 },
      ],
      defaultModelId: "demo/chat", embeddingModelId: "demo/embed",
    } });
  });
  app.get("/platform/agent-execution/options", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    if (req.query.selected) {
      res.json({ canSetExecutionUser: false, users: [],
        selected: { id: req.query.selected, name: "Former reader", available: false, reason: "disabled" } });
      return;
    }
    if (req.query.keyword) {
      expect(req.query).toEqual({ keyword: "Ada", pageNum: "2", pageSize: "5" });
      res.json({ canSetExecutionUser: true, users: [{ id: "ada", name: "Ada" }] });
      return;
    }
    res.json({ canSetExecutionUser: false, users: [] });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    const family = String(req.query.applicationId);
    expect(req.header("tk")).toBe("pilot-reader");
    res.json({ success: true, data: {
      applicationId: family, menu: { groups: [], panelUses: [] },
      use: { id: "data", pageKey: "data", path: `/applications/${family}/data`,
        panelId: `panel-${family}`, access: { kind: "domain-member" } },
    } });
  });
  for (const endpoint of ["queryList", "queryById", "definitionForm"]) {
    app.post("/action/" + endpoint, (req, res) => {
      expect(req.header("tk")).toBe("pilot-reader");
      expect(req.header("Accept-Language")).toBe("zh-CN");
      const action = { id: "review", name: "Review", statusLabel: "Published" };
      if (endpoint === "queryList") {
        expect(req.body).toEqual({});
        res.json({ success: true, data: [action] });
      } else if (endpoint === "queryById") {
        expect(req.body).toEqual({ id: action.id });
        res.json({ success: true, data: action });
      } else {
        expect(req.body).toMatchObject({
          target: { kind: "object", objectType: "platform:Action", primaryKey: action.id },
          values: { name: "Draft review" }, changedField: "/name",
        });
        res.json({ success: true, data: {
          fields: [], values: req.body.values, errors: [],
          save: { method: "POST", path: "/action/save", bodySchema: {}, draftOperation: "action.update" },
        } });
      }
    });
  }
  app.post("/ontology/query/metrics/describe", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    expect(req.body).toEqual({ id: "metric-pilot" });
    res.json({ id: "metric-pilot", revision: "metric-r2", status: "PUBLISHED", name: "Example metric",
      parameterDefs: [], outputColumns: columns, sourceObjectTypes: [] });
  });
  app.post("/ontology/query/metrics/execute", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.body).toMatchObject({ id: "metric-pilot", revision: "metric-r2", parameters: { customer: "p1" } });
    const { year } = req.body.parameters;
    const refusal = metricRefusals[year];
    if (refusal) {
      res.status(refusal.status).json({ error: { code: "ONTOLOGY_QUERY_FAILED", message: refusal.message } });
      return;
    }
    const truncation = year === 2024 || year === 2025 ? metricTruncation : null;
    res.json({ columns, rows: year === 2023 || year === 2025 ? [] : [{ value: 15 }], truncation });
  });
  app.post("/data/getWholeClassDataByPage", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.header("Accept-Language")).toBe("zh-CN");
    expect(req.body).toEqual({ classname: "person", pagenum: 2, pagecount: 3, search: "Ali" });
    res.json({ success: true, data: [{ id: "p1", name: "Alice" }], total_count: 12 });
  });
  app.post("/data/queryInfoByNode", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.body).toEqual({ class: "person", id: "person:p1" });
    res.json({ success: true, data: { data: { name: "Alice" } } });
  });
  app.post("/dsl/executeV1", (req, res) => {
    expect(req.header("tk")).toBe("pilot-reader");
    expect(req.body.answer.steps[0].graph.patterns[0].relationship).toEqual([{ from: 0, to: 1, type: ["person_to_org"] }]);
    res.json({ data: [{ answer: [{ id: "org1", name: "Example Org" }] }] });
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
    Object.assign(req, { domainId: "pilot", userId: "reader", userName: "Pilot Reader", token: "pilot-reader", locale: req.header("Accept-Language") });
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
    operations: { save: { operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.save" }, target: { input: "task" } } },
  });
  expect(formWrite.status, await formWrite.text()).toBe(200);
  const runWrite = await request("PUT", "product-projections/projection-pilot-run", {
    ...projection, componentId: "@ontomato/sdk:OperationButton", revision: 0,
    data: {}, operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
  });
  expect(runWrite.status, await runWrite.text()).toBe(200);
  const panelWrite = await request("PUT", panelPath, { ...panel, revision: 0 });
  expect(panelWrite.status, await panelWrite.text()).toBe(200);
  const original = (await (await request("GET", panelPath)).json()).panel;
  expect(original).toMatchObject({ id: panelId, revision: 1, manifest: { members: panel.manifest.members } });

  expect((await request("PUT", panelPath, { ...panel, revision: original.revision })).status).toBe(200);
  expect((await request("PUT", panelPath, { ...panel, revision: original.revision })).status).toBe(409);
  const current = (await (await request("GET", panelPath)).json()).panel;
  const malformed = { ...panel, content: { html: '<section flow="column"></section>' }, revision: current.revision };
  const rejected = await request("PUT", panelPath, malformed);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: { message: expect.stringMatching(/^Panel 'panel-schedules-pilot', field 'content.html' – 1:\d+ .*flow/u) } });
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
  const operation = await (await request("POST", "product-panels/read", {
    source, memberPath: [{ member: "run" }], operations: true, inputs: { task: taskRef },
  })).json();
  expect(operation).toMatchObject({
    status: "ready", value: { runNow: { kind: "action", effect: "write", handlerRef: "schedules.runNow", label: "立即运行" } },
  });
  const target = { kind: "object", objectType: taskType.objectType, primaryKey: task.id };
  let runNowReceipt: unknown;
  for (const [operationId, input] of [
    ["form.save", { values: task.content, revision: task.revision, submittedFields: ["/instruction"] }], ["run.runNow", {}],
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

it("reads the seven named ontology data items with the panel viewer", async () => {
  const type = (id: string, read: string, params = {}) => ({
    source: { type: { kind: "PlatformObjectType", id } }, read, params,
  });
  const members: Record<string, { target: { projectionId: string } }> = {};
  const projections = {
    scope: { componentId: "@ontomato/sdk:ObjectGraph",
      data: { nodes: type("platform:ObjectType", "list"), edges: type("platform:Relationship", "list") } },
    ontology: { componentId: "@ontomato/sdk:OntologyGraph", inputs: { node: { kind: "json" } }, data: {
      schema: type("platform:OntologyType", "schema"), counts: type("platform:OntologyType", "counts"),
      start: type("platform:OntologyType", "start"),
      neighbors: type("platform:OntologyType", "neighbors", { node: { input: "node" }, relationKinds: { literal: [] } }),
    } },
    objects: { componentId: "@ontomato/sdk:ObjectList", data: {
      objects: type("platform:OntologyType", "objects", { type: { literal: "platform:ObjectType" } }),
    } },
    attributes: { componentId: "@ontomato/sdk:ObjectList", data: {
      rows: type("platform:Attribute", "list", { className: { literal: "warehouse" } }),
    } },
    relationships: { componentId: "@ontomato/sdk:ObjectList", data: {
      rows: type("platform:Relationship", "list", { className: { literal: "item" } }),
    } },
  };
  const runtimeProjectionId = "ontology-pilot-runtime";
  const runtimeProjection = {
    name: "Runtime neighbors", description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {},
    componentId: "@ontomato/sdk:OntologyGraph",
    data: { neighbors: type("platform:OntologyType", "neighbors", { relationKinds: { literal: [] } }) },
  };
  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
  const declareGraphParameters = (runtimeParams: string[]) => writeFile(cataloguePath, JSON.stringify({
    ...catalogue,
    components: catalogue.components.map(component => component.componentId === "OntologyGraph"
      ? { ...component, data: { ...component.data, neighbors: { ...component.data!.neighbors, runtimeParams } } }
      : component),
  }));
  await declareGraphParameters([]);
  const registered = await request("PUT", "product-projections/" + runtimeProjectionId, runtimeProjection);
  expect(registered.status, await registered.text()).toBe(200);

  const state = { focus: { type: { kind: "object", objectType: "platform:ObjectType" }, default: null } };
  const placement = { target: { projectionId: runtimeProjectionId } };
  const saveGraph = (placements: Record<string, typeof placement>, revision: number) => request("PUT", "product-panels/" + graphPanelId, {
    name: "Ontology", description: "", visibility: "domain", revision,
    content: { html: "<section>" + Object.keys(placements)
      .map(key => `<panel-member ref="${key}"></panel-member>`).join("") + "</section>" },
    manifest: { state, members: placements, events: {} },
  });
  const unbound = await saveGraph({ runtime: placement }, 0);
  expect(unbound.status).toBe(400);
  expect(await unbound.json()).toMatchObject({ error: { message: expect.stringContaining("node") } });
  const typo = { ...placement, inputs: { nodo: { state: "focus" } } };
  const rejected = await saveGraph({ runtime: typo }, 0);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: { message: expect.stringContaining("nodo") } });
  expect(resourceIds.has(graphPanelId)).toBe(false);

  const implicit = { ...placement, inputs: { node: { state: "focus" } } };
  const implicitOutput = { ...placement, outputs: { node: { state: "focus" } } };
  const authored = await saveGraph({ implicit, implicitOutput }, 0);
  expect(authored.status, await authored.text()).toBe(200);
  await declareGraphParameters(["node"]);
  for (const [key, projection] of Object.entries(projections)) {
    const projectionId = "ontology-pilot-" + key;
    const saved = await request("PUT", "product-projections/" + projectionId, {
      name: key, description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {}, ...projection,
    });
    expect(saved.status, await saved.text()).toBe(200);
    members[key] = { target: { projectionId } };
  }
  const saved = await saveGraph({ ...members, runtime: placement, implicit, implicitOutput }, 1);
  expect(saved.status, await saved.text()).toBe(200);
  const read = async (member: string, dataName: string, inputs: object = {}, runtimeParams?: object) => {
    const response = await request("POST", "product-panels/read", {
      source: { kind: "registered", applicationId: "ontology-pilot", useId: "graph" },
      memberPath: [{ member }], dataName, inputs, runtimeParams,
    });
    expect(response.status).toBe(200);
    return productPanelReadResponseSchema.parse(await response.json());
  };
  const ready = async (...args: Parameters<typeof read>) => {
    const reply = await read(...args);
    expect(reply, args.slice(0, 2).join("/")).toMatchObject({ status: "ready" });
    if (reply.status !== "ready") throw new Error(reply.status);
    return reply.value;
  };
  expect(await ready("scope", "nodes")).toContainEqual(expect.objectContaining({
    primaryKey: "warehouse", label: "Warehouse", fieldLabels: { className: "API 名称" },
  }));
  expect(await ready("scope", "edges")).toMatchObject([{ primaryKey: "contains", fields: { fromclass: "warehouse", toclass: "item" } }]);
  expect(await ready("attributes", "rows")).toMatchObject([{ label: "Identifier", fields: { className: "warehouse", name: "id" } }]);
  expect(await ready("relationships", "rows")).toMatchObject([{ primaryKey: "filtered-contains" }]);
  expect(await ready("ontology", "schema")).toMatchObject({ objectTypes: expect.any(Array), relationKinds: expect.any(Array) });
  expect(await ready("ontology", "counts")).toMatchObject({ counts: expect.any(Array) });
  expect(await ready("ontology", "start")).toMatchObject({ node: { primaryKey: "reader", label: "Pilot Reader" } });
  expect(await ready("ontology", "neighbors", { node: { className: "platform:ObjectType", primaryKey: "warehouse" } }))
    .toMatchObject({ node: { primaryKey: "warehouse" }, neighbors: expect.any(Array) });
  expect(await ready("objects", "objects")).toMatchObject({ items: expect.arrayContaining([
    expect.objectContaining({ node: { className: "platform:ObjectType", primaryKey: "warehouse" } }),
  ]) });
  const warehouse = { className: "platform:ObjectType", primaryKey: "warehouse" };
  const item = { className: "platform:ObjectType", primaryKey: "item" };
  expect(await ready("runtime", "neighbors", {}, { node: warehouse })).toMatchObject({ node: { primaryKey: "warehouse" } });
  expect(await ready("ontology", "neighbors", { node: warehouse }, { node: item }))
    .toMatchObject({ node: { primaryKey: "warehouse" } });
  expect(await ready("implicit", "neighbors", { node: warehouse }, { node: item }))
    .toMatchObject({ node: { primaryKey: "warehouse" } });
  expect(await ready("implicitOutput", "neighbors", { node: warehouse }))
    .toMatchObject({ node: { primaryKey: "warehouse" } });
  expect(await read("runtime", "neighbors", { node: warehouse })).toMatchObject({
    status: "error", message: expect.stringContaining("Unknown projection input: node"),
  });
  expect(await read("runtime", "neighbors", {}, { node: null })).toMatchObject({
    status: "error", message: "Missing read parameter: node",
  });
  expect(await read("runtime", "neighbors", {}, { node: warehouse, relationKinds: [] }))
    .toMatchObject({ status: "error", message: expect.stringContaining("relationKinds") });
  expect(await read("runtime", "neighbors", {}, { node: "warehouse" })).toMatchObject({ status: "error" });

  await declareGraphParameters([]);
  const update = await request("PUT", "product-projections/" + runtimeProjectionId, { ...runtimeProjection, revision: 1 });
  expect(update.status).toBe(409);
  expect(await update.json()).toMatchObject({ error: { message: expect.stringContaining("node") } });
});

it("registers and reads an author-named datum through the SDK catalogue wildcard", async () => {
  const original = await readFile(cataloguePath, "utf8");
  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(original));
  await writeFile(cataloguePath, JSON.stringify({
    ...catalogue,
    components: [...catalogue.components, {
      componentId: "Data", module: "@ontomato/sdk/base", exportName: "Data", role: "presentation",
      meaning: "Supplies author-named data to the panel.", ports: { props: [], events: [], slots: [] },
      data: { "*": { results: ["panelGraphNeighbors"], required: false, runtimeParams: ["node", "page"] } },
    }],
  }));

  try {
    const source = { type: { kind: "PlatformObjectType", id: "platform:OntologyType" } };
    const datumName = "nearbyWarehouses";
    const projection = {
      name: "Warehouse neighbors", description: "", visibility: "domain", componentId: "@ontomato/sdk:Data",
      revision: 0, inputs: {}, outputs: {}, config: {},
      data: { [datumName]: { source, read: "neighbors", params: {} } },
    };
    const projectionPath = "product-projections/data-port-pilot";
    const wrongResult = await request("PUT", projectionPath, {
      ...projection, data: { [datumName]: { source, read: "counts", params: {} } },
    });
    expect(wrongResult.status).toBe(400);
    expect(await wrongResult.json()).toMatchObject({
      error: { code: "PANEL_COMPONENT_DATA_RESULT_MISMATCH", message: expect.stringContaining(datumName) },
    });

    const savedProjection = await request("PUT", projectionPath, projection);
    expect(savedProjection.status, await savedProjection.text()).toBe(200);
    const savedPanel = await request("PUT", "product-panels/" + dataPanelId, {
      name: "Warehouse data", description: "", visibility: "domain", revision: 0,
      content: { html: '<section><panel-member ref="data"></panel-member></section>' },
      manifest: { state: {}, members: { data: { target: { projectionId: "data-port-pilot" } } }, events: {} },
    });
    expect(savedPanel.status, await savedPanel.text()).toBe(200);

    const read = async (runtimeParams: object) => {
      const response = await request("POST", "product-panels/read", {
        source: { kind: "registered", applicationId: "ontology-pilot", useId: "data" },
        memberPath: [{ member: "data" }], dataName: datumName, inputs: {}, runtimeParams,
      });
      expect(response.status).toBe(200);
      return productPanelReadResponseSchema.parse(await response.json());
    };
    const node = { className: "platform:ObjectType", primaryKey: "warehouse" };
    expect(await read({ node })).toMatchObject({ status: "ready", value: { node: { primaryKey: "warehouse" } } });
    expect(await read({ node, page: { number: 1, size: 10 } })).toMatchObject({
      status: "error", message: expect.stringContaining("parameter 'page'"),
    });
    expect(await read({ node, relationKinds: [] })).toMatchObject({
      status: "error", message: expect.stringContaining("parameter 'relationKinds'"),
    });
  } finally {
    await writeFile(cataloguePath, original);
  }
});

it("reads agent settings and reference options with the panel viewer", async () => {
  const type = (id: string, read: string, params = {}) => ({
    source: { type: { kind: "PlatformObjectType", id } }, read, params,
  });
  const object = (read: string) => ({ source: { object: { input: "agent" } }, read, params: {} });
  const picker = (id: string, inputs = {}, params = {}) => ({
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { values: { kind: "json" }, ...inputs },
    data: { options: type(id, "options", params), selected: type(id, "resolve", { values: { input: "values" } }) },
  });
  const agentType = { agent: { kind: "object", objectType: "platform:AgentDefinition" } };
  const written: Record<string, { componentId: string; inputs?: object; data: object; operations?: object }> = {
    agents: { componentId: "@ontomato/sdk:ObjectList", data: { rows: type("platform:AgentDefinition", "list") } },
    summary: { componentId: "@ontomato/sdk:ObjectSummary", inputs: agentType, data: { record: object("record") } },
    definition: { componentId: "@ontomato/sdk:ObjectForm", inputs: agentType,
      data: { form: object("form"), createForm: type("platform:AgentDefinition", "createForm") },
      operations: { save: { operation: { kind: "PlatformOperation", id: "platform:AgentDefinition.save" }, target: { input: "agent" } } },
    },
    models: picker("platform:ModelOption"),
    users: picker("platform:User", { keyword: { kind: "scalar", type: "string" }, page: { kind: "json" } },
      { keyword: { input: "keyword" }, page: { input: "page" } }),
    skills: picker("platform:Skill"),

  };
  const members: Record<string, { target: { projectionId: string }; inputs?: object }> = {};
  for (const [key, projection] of Object.entries(written)) {
    const projectionId = "agent-settings-" + key;
    const saved = await request("PUT", "product-projections/" + projectionId, {
      name: key, description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {}, ...projection,
    });
    expect(saved.status, await saved.text()).toBe(200);
    members[key] = { target: { projectionId }, ...(key === "definition" && { inputs: { agent: { state: "selectedAgent" } } }) };
  }
  const saved = await request("PUT", "product-panels/" + agentPanelId, {
    name: "Agent settings", description: "", visibility: "domain", revision: 0,
    content: { html: "<section>" + Object.keys(members).map(key => `<panel-member ref="${key}"></panel-member>`).join("") + "</section>" },
    manifest: { state: { selectedAgent: { type: agentType.agent, default: null } }, members, events: {} },
  });
  expect(saved.status, await saved.text()).toBe(200);
  const read = async (member: string, dataName: string, inputs: object = {}) => {
    const response = await request("POST", "product-panels/read", {
      source: { kind: "registered", applicationId: "agent-settings", useId: "settings" },
      memberPath: [{ member }], dataName, inputs,
    });
    expect(response.status).toBe(200);
    return productPanelReadResponseSchema.parse(await response.json());
  };
  const ready = async (...args: Parameters<typeof read>) => {
    const reply = await read(...args);
    expect(reply, args.join("/")).toMatchObject({ status: "ready" });
    if (reply.status !== "ready") throw new Error(reply.status);
    return reply.value;
  };
  const agent = { className: "platform:AgentDefinition", primaryKey: agentId };
  const describeSave = async (inputs: object) => (await request("POST", "product-panels/read", {
    source: { kind: "registered", applicationId: "agent-settings", useId: "settings" },
    memberPath: [{ member: "definition" }], operations: true, inputs,
  })).json();
  expect(await describeSave({ agent })).toMatchObject({
    status: "ready", value: { save: { kind: "form.save", target: { source: "input", input: "agent" } } },
  });
  expect(await describeSave({ agent: null })).toMatchObject({
    status: "ready", value: { save: { kind: "form.save", target: { source: "draft", slot: "definition" } } },
  });
  expect(await ready("agents", "rows")).toContainEqual(expect.objectContaining({ primaryKey: agentId, label: "Inventory analyst" }));
  expect(await ready("summary", "record", { agent })).toMatchObject({
    primaryKey: agentId, fields: { description: "Inventory summary", enabled: "false" },
    fieldLabels: { description: "Description", enabled: "Enabled" },
  });
  const form = panelFormDescriptionSchema.parse(await ready("definition", "form", { agent }));
  expect(form.values).toMatchObject({ name: "Inventory analyst", enabled: false, skills: [] });
  expect(form.fields.find(field => field.path === "/executionUserId")?.readOnly).toBe(true);
  expect(panelFormDescriptionSchema.parse(await ready("definition", "createForm")).values).toMatchObject({
    name: "", enabled: true, modelSelection: { modelId: null }, skills: [],
  });
  expect(panelOptionListSchema.parse(await ready("models", "options")).options.map(option => option.value)).toEqual(["demo/chat"]);
  const models = panelOptionListSchema.parse(await ready("models", "selected", { values: ["demo/missing", "demo/chat", null] }));
  expect(models.options.map(option => option.value)).toEqual(["demo/missing", "demo/chat", null]);
  expect(models.options[0]?.unavailable?.reason).toEqual(expect.any(String));
  const users = panelOptionListSchema.parse(await ready("users", "options", { keyword: "Ada", page: { number: 2, size: 5 } }));
  expect(users).toEqual({ options: [{ primaryKey: "ada", value: "ada", label: "Ada" }] });
  expect(panelOptionListSchema.parse(await ready("users", "selected", { values: ["former", null] })).options).toMatchObject([
    { value: "former", label: "Former reader", unavailable: { reason: expect.any(String) } }, { value: null },
  ]);
  const governance = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" };
  const missing = { namespace: { kind: "domain", domainId: "elsewhere" }, name: "private-skill" };
  expect(panelOptionListSchema.parse(await ready("skills", "options")).options).toContainEqual(expect.objectContaining({
    value: governance, label: "知识治理",
  }));
  const skills = panelOptionListSchema.parse(await ready("skills", "selected", { values: [missing, governance, missing] })).options;
  expect(skills.map(option => option.value)).toEqual([missing, governance, missing]);
  expect(skills[0]).toMatchObject({ label: "技能不可用", unavailable: { reason: "你无法使用此技能。" } });
  expect(skills[0]).toEqual(skills[2]);

  state.allowAgentReads = false;
  expect(await read("definition", "createForm")).toEqual({ status: "forbidden" });
  expect(await read("skills", "selected", { values: [missing] })).toEqual({ status: "forbidden" });
});

async function ownerReadPanel(
  family: string, projections: Record<string, object>, state = {},
  wiring: Record<string, object> = {},
) {
  const members: Record<string, object> = {};
  for (const [name, projection] of Object.entries(projections)) {
    const projectionId = `${family}-${name}`;
    const response = await request("PUT", "product-projections/" + projectionId, {
      name, description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {}, ...projection,
    });
    expect(response.status, await response.text()).toBe(200);
    members[name] = { target: { projectionId }, ...wiring[name] };
  }
  const response = await request("PUT", "product-panels/panel-" + family, {
    name: family, description: "", visibility: "domain", revision: 0,
    content: { html: "<section>" + Object.keys(members).map(name => `<panel-member ref="${name}"></panel-member>`).join("") + "</section>" },
    manifest: { state, members, events: {} },
  });
  expect(response.status, await response.text()).toBe(200);
  return async (member: string, dataName: string, inputs: object = {}) => {
    const read = await request("POST", "product-panels/read", {
      source: { kind: "registered", applicationId: family, useId: "data" },
      memberPath: [{ member }], dataName, inputs,
    });
    expect(read.status).toBe(200);
    return productPanelReadResponseSchema.parse(await read.json());
  };
}

it("dispatches the action catalog's three reads and both operation descriptions", async () => {
  const action = { className: "platform:Action", primaryKey: "review" };
  const actionType = { kind: "object", objectType: action.className };
  const selected = { object: { literal: action } };
  const operation = (id: string) => ({
    componentId: "@ontomato/sdk:OperationButton", inputs: { action: actionType },
    data: {}, operations: { change: { operation: { kind: "PlatformOperation", id }, target: { input: "action" } } },
  });
  const read = await ownerReadPanel("owner-actions", {
    list: { componentId: "@ontomato/sdk:ObjectList", data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: action.className } }, read: "list", params: {} },
    } },
    summary: { componentId: "@ontomato/sdk:ObjectSummary", data: { record: { source: selected, read: "record", params: {} } } },
    definition: { componentId: "@ontomato/sdk:ObjectForm", data: {
      form: { source: selected, read: "form", params: {
        values: { literal: { name: "Draft review" } }, changedField: { literal: "/name" },
      } },
    } },
    status: operation("actions.setStatus"),
    remove: operation("actions.delete"),
  }, { selected: { type: actionType, default: null } }, {
    status: { inputs: { action: { state: "selected" } } },
    remove: { inputs: { action: { state: "selected" } } },
  });
  expect(await read("list", "rows")).toMatchObject({ status: "ready", value: [{ primaryKey: "review", label: "Review" }] });
  expect(await read("summary", "record")).toMatchObject({ status: "ready", value: { fields: { status: "Published" } } });
  expect(await read("definition", "form")).toMatchObject({ status: "ready", value: { values: { name: "Draft review" }, errors: [] } });
  const readOperations = async (member: string) => (await request("POST", "product-panels/read", {
    source: { kind: "registered", applicationId: "owner-actions", useId: "data" },
    memberPath: [{ member }], operations: true, inputs: { action },
  })).json();
  expect(await readOperations("status")).toMatchObject({
    status: "ready", value: { change: { handlerRef: "actions.setStatus", batch: true } },
  });
  expect(await readOperations("remove")).toMatchObject({
    status: "ready", value: { change: { handlerRef: "actions.delete", inspectImpact: { handlerRef: "actions.delete.inspect-impact" } } },
  });
});

/** Reads a MetricView result through a registered projection whose SDK component this fixture declares as its consumer. */
async function withMetricProjection(
  family: string, projection: { inputs: object; params: object },
  check: (read: (inputs: object) => Promise<ReturnType<typeof productPanelReadResponseSchema.parse>>) => Promise<void>,
) {
  const installed = await readFile(cataloguePath, "utf8");
  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(installed));
  await writeFile(cataloguePath, JSON.stringify({
    ...catalogue, components: catalogue.components.map(component => component.componentId === "MetricViewData"
      ? { ...component, data: { result: { results: ["metricOutput"], required: true } } } : component),
  }));
  try {
    const read = await ownerReadPanel(family, {
      metric: {
        componentId: "@ontomato/sdk:MetricViewData", inputs: projection.inputs,
        data: { result: {
          source: { object: { literal: { className: "platform:MetricView", primaryKey: "metric-pilot" } } },
          read: "result", params: projection.params,
        } },
      },
    });
    await check(inputs => read("metric", "result", inputs));
  } finally {
    await writeFile(cataloguePath, installed);
  }
}

it("passes named metric parameters to the owner and reports untruncated zero rows as empty", async () => {
  await withMetricProjection("owner-metric", {
    inputs: { year: { kind: "scalar", type: "number" } },
    params: { customer: { literal: { className: "person", primaryKey: "p1" } }, year: { input: "year" } },
  }, async read => {
    expect(await read({ year: 2026 })).toMatchObject({ status: "ready", value: { rows: [{ value: 15 }] } });
    expect(await read({ year: 2023 })).toEqual({ status: "empty" });
  });
});

it("gives a metric parameter the chosen object's key and keeps the owner's truncation and refusals", async () => {
  await withMetricProjection("owner-metric-outcomes", {
    inputs: { customer: { kind: "object", objectType: "person" }, year: { kind: "scalar", type: "number" } },
    params: { customer: { input: "customer" }, year: { input: "year" } },
  }, async read => {
    const customer = { className: "person", primaryKey: "p1" };
    // A partial result is still the owner's answer, with its hint, even when the processed part has no rows.
    expect(await read({ customer, year: 2024 })).toEqual({
      status: "ready", value: { columns, rows: [{ value: 15 }], truncation: metricTruncation },
    });
    expect(await read({ customer, year: 2025 })).toEqual({
      status: "ready", value: { columns, rows: [], truncation: metricTruncation },
    });
    for (const [year, { status, message }] of Object.entries(metricRefusals))
      expect(await read({ customer, year: Number(year) }))
        .toEqual(status === 403 ? { status: "forbidden" } : { status: "error", message });
  });
});

it("reads a customer type and a relationship by the registered source identity", async () => {
  const person = { className: "person", primaryKey: "p1" };
  const read = await ownerReadPanel("owner-customer", {
    rows: { componentId: "@ontomato/sdk:ObjectList", data: { rows: {
      source: { type: { kind: "ObjectType", id: "person" } }, read: "query",
      params: { search: { literal: "Ali" }, page: { literal: { number: 2, size: 3 } } },
    } } },
    detail: { componentId: "@ontomato/sdk:ObjectSummary", data: { record: {
      source: { object: { literal: person } }, read: "record", params: {},
    } } },
    relations: { componentId: "@ontomato/sdk:ObjectRelations", data: { neighbors: {
      source: { type: { kind: "Relationship", id: "person_to_org" } }, read: "neighbors",
      params: { node: { literal: person }, limit: { literal: 10 } },
    } } },
  });
  expect(await read("rows", "rows")).toMatchObject({ status: "ready", value: { rows: [{ label: "Alice" }], total: 12 } });
  expect(await read("detail", "record")).toMatchObject({ status: "ready", value: { primaryKey: "p1", label: "Alice" } });
  expect(await read("relations", "neighbors")).toMatchObject({
    status: "ready", value: { neighbors: [{ primaryKey: "org1", label: "Example Org" }] },
  });
});
