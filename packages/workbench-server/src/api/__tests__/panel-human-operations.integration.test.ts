import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { panelHumanOperationPreparationSchema } from "@ontomato/contracts/panel-agent";
import { platformTaskRunSchema, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import scheduleExamples from "../../../../contracts/examples/platform-schedules.json";
import { ensurePanelOperationsSchema } from "../../infrastructure/postgres-migrations/20261118-panel-operations/schema";
import { buildTestAccess } from "../build-test-access";
import { panelOperationsRouter } from "../routes/product-panels";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));
vi.mock("../../services/assistant/skills", () => ({ readPageSkills: vi.fn() }));

const objectType = "platform:ScheduledTask";
const use = { applicationId: "app-tasks", useId: "tasks", operationId: "run.runNow" };
vi.mock("../../services/product-panels/current", () => ({
  readCurrentPanelRecord: async () => ({
    sdkVersion: "1.0.0",
    manifest: {
      state: { task: { kind: "object", objectType } },
      slots: { run: { projectionId: "run", inputs: { task: { state: "task" } } } },
      operations: [],
    },
  }),
  readCurrentProjection: async () => ({
    id: "run", componentId: "run", name: "Run now",
    binding: { kind: "PlatformOperation", id: "schedules.runNow" },
    inputs: { task: { kind: "object", objectType } },
  }),
}));
vi.mock("../../services/product-panels/skill-package", () => ({
  readComponentCatalogue: async () => new Map([["run", { componentId: "run", meaning: "Run now" }]]),
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const task = platformTaskSchema.parse(scheduleExamples.creates.find(example => example.name === "governance-instruction")!.response);
const run = platformTaskRunSchema.parse({
  ...scheduleExamples.runs.find(example => example.name === "agents-running")!.response, taskId: task.id,
});
const call = { target: { kind: "object", objectType, primaryKey: task.id }, input: {} };
let server: Server;
let ownerReads = 0;
const ownerWrites: { credential: string | undefined; idempotencyKey: string | undefined }[] = [];

beforeAll(async () => {
  state.schema = `panel_human_operations_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensurePanelOperationsSchema(state.pool);

  const app = express();
  app.use(express.json());
  app.get("/platform/applications/app-tasks/panel-uses", (req, res) => {
    if (req.header("tk") !== "alice") { res.sendStatus(403); return; }
    res.json({ success: true, data: {
      applicationId: use.applicationId, entry: { path: "/applications/app-tasks", renderer: "panels" },
      panelUses: [{ id: use.useId, pageKey: "tasks", path: "/applications/app-tasks/tasks",
        panelId: "panel-tasks", access: { kind: "domain-member" } }],
    } });
  });
  app.get("/platform/scheduled-tasks/:taskId", (req, res) => {
    if (req.params.taskId !== task.id || req.header("tk") !== "alice") { res.sendStatus(403); return; }
    ownerReads += 1;
    res.json(task);
  });
  app.post("/platform/scheduled-tasks/:taskId/runs", (req, res) => {
    if (req.params.taskId !== task.id || req.header("tk") !== "alice") { res.sendStatus(403); return; }
    ownerWrites.push({ credential: req.header("tk"), idempotencyKey: req.header("Idempotency-Key") });
    res.json(run);
  });
  app.use("/api", (req, _res, next) => {
    const userId = req.header("tk");
    Object.assign(req, { userId, domainId: "domain", token: userId, locale: "en" });
    next();
  }, buildTestAccess, panelOperationsRouter);
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
});

function request(path: string, user: string, body?: object, preview = false) {
  return fetch(state.base + "/api" + path, {
    headers: { tk: user, "Content-Type": "application/json", ...(preview && { [BUILD_TEST_HEADER]: "preview" }) },
    ...(body && { method: "POST", body: JSON.stringify(body) }),
  });
}

it("stores the host's exact confirmation and claims the registered owner once as the same reader", async () => {
  const prepared = await request("/panel-operations/intents", "alice", { ...use, call });
  expect(prepared.status).toBe(200);
  const confirmation = panelHumanOperationPreparationSchema.parse(await prepared.json());
  const { intentId } = confirmation;
  expect(confirmation.confirmation).toEqual({ kind: "none" });
  expect(ownerReads).toBe(0);
  expect(ownerWrites).toEqual([]);
  const read = `/panel-operation-intents/${intentId}?applicationId=${use.applicationId}&useId=`;
  expect(await (await request(read + use.useId, "alice")).json()).toEqual(confirmation);
  expect((await request(read + use.useId, "bob")).status).toBe(404);
  expect((await request(read + "another-use", "alice")).status).toBe(404);
  expect((await request(read + use.useId, "alice", undefined, true)).status).toBe(422);
  const dispatch = `/panel-operations/intents/${intentId}/dispatch`;
  expect((await request(dispatch, "bob", {})).status).toBe(404);
  expect((await request(dispatch, "alice", { call })).status).toBe(400);
  expect((await request(dispatch, "alice", {}, true)).status).toBe(422);
  expect(ownerWrites).toEqual([]);

  const results = await Promise.all([request(dispatch, "alice", {}), request(dispatch, "alice", {})]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const result = {
    kind: "dispatched", intentId, outcome: { kind: "success", data: run, affected: {
      objects: [{ objectType, primaryKey: task.id }], objectTypes: [objectType],
    } },
  };
  expect(await Promise.all(results.map(response => response.json()))).toContainEqual(result);
  expect(await (await request(dispatch, "alice", {})).json()).toEqual(result);
  expect((await request(read + use.useId, "alice")).status).toBe(409);
  expect(ownerWrites).toEqual([{ credential: "alice", idempotencyKey: intentId }]);
  const stored = await state.pool!.query(`SELECT question_id,intent FROM "${state.schema}".panel_operation_intents WHERE id=$1`, [intentId]);
  expect(stored.rows).toMatchObject([{ question_id: null, intent: {
    source: { kind: "human" }, call, confirmation: { kind: "none" }, dispatched: true, outcome: result.outcome,
  } }]);
});
