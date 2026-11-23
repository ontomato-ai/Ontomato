import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { config } from "../../config/application";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { buildTestAccess } from "../build-test-access";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const workspaceId = randomUUID();
const projectionId = "candidate-action";
const context = {
  contextId: "workspace-context", workspaceId, status: "READY", expiresAt: Date.now() + 60_000,
  classNames: [], sampleSummary: { name: null, classes: 0, sha256: null }, resources: [],
};
const previousQueryUrl = config.dataQuery.baseUrl;
const ownerContexts: unknown[] = [];
let issuedContext: typeof context | null;
let canUseProjection: boolean;
let server: Server;
let root: string;
let base: string;

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
    packs: { en: { messages: en, ...enLocaleMeta } } });
  state.schema = `candidate_read_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  root = await mkdtemp(join(tmpdir(), "candidate-panel-read-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });

  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  const runtime = express.Router();
  runtime.use((req, res, next) => {
    expect(req.header("authorization")).toBe("Bearer runtime-service");
    if (req.header("x-domain-id") !== "domain" || req.header("x-workspace-owner-id") !== "alice") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Workspace not found" } });
      return;
    }
    next();
  });
  const files = {
    "panel.html": '<projection slot="result" />',
    "panel.mjs": 'throw new Error("Definition loading never runs the module");',
    "panel.json": JSON.stringify({ manifest: {
      state: {}, members: { result: { target: { projectionId } } },
    } }),
  };
  runtime.get("/", (_req, res) => res.json({ id: workspaceId }));
  runtime.get("/tree", (_req, res) => res.json({ files: Object.keys(files).map(path => ({ path })) }));
  runtime.get("/files/content", (req, res) => res.send(files[req.query.path as keyof typeof files]));
  app.use(`/v1/workspaces/${workspaceId}`, runtime);
  app.get("/java/platform/applications", (_req, res) => res.json({ success: true, data: [{
    id: "app-builder", kind: "native", names: { en: "App Builder" }, descriptions: {}, icon: "Hammer",
    rail: "apps", category: "build", sort: 1, entry: { path: "/app-builder" },
    entryAccess: ["app-builder"], scheduleAdapter: null, releaseId: null,
  }] }));
  app.get("/java/ontology/build-tests/current", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    expect(req.header(BUILD_TEST_HEADER)).toBeUndefined();
    expect(req.query.workspaceId).toBe(workspaceId);
    res.json(issuedContext);
  });
  app.post("/java/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    expect(req.body).toMatchObject({ id: projectionId, domainId: "domain", ownerId: "alice" });
    res.json({ success: true });
  });
  app.post("/java/product-governance/check", (req, res) => {
    expect(req.body.id).toBe(projectionId);
    res.json({ allowed: req.header("tk") === "alice" && canUseProjection });
  });
  app.post("/java/action/queryById", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    expect(req.header("Accept-Language")).toBe("en");
    expect(req.body).toEqual({ id: "review" });
    ownerContexts.push(JSON.parse(req.header(BUILD_TEST_HEADER)!));
    res.json({ success: true, data: { id: "review", name: "Review candidate" } });
  });
  app.use("/api", (req, _res, next) => {
    const user = req.header("tk");
    Object.assign(req, { userId: user, domainId: "domain", token: user, locale: "en" });
    next();
  }, buildTestAccess);
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("AGENT_RUNTIME_URL", base);
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "runtime-service");
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "fixture-service");
  vi.stubEnv("DATA_QUERY_BASE_URL", base + "/java");
  config.dataQuery.baseUrl = base + "/java";
  canUseProjection = true;
  const registration = await fetch(`${base}/api/product-projections/${projectionId}`, {
    method: "PUT", headers: { tk: "alice", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Action record", description: "", visibility: "domain", revision: 0,
      componentId: "@ontomato/sdk:ObjectSummary", inputs: {}, outputs: {}, config: {},
      data: { record: { source: { object: { literal: { className: "platform:Action", primaryKey: "review" } } },
        read: "record", params: {} } },
    }),
  });
  expect(registration.status, await registration.text()).toBe(200);
});

beforeEach(() => {
  issuedContext = context;
  canUseProjection = true;
  ownerContexts.length = 0;
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(root, { recursive: true });
});

async function readCandidate(member = "result", caller = "alice") {
  const response = await fetch(`${base}/api/product-panels/read`, {
    method: "POST",
    headers: { tk: caller, "Content-Type": "application/json",
      [BUILD_TEST_HEADER]: JSON.stringify({ kind: "build-test", contextId: "untrusted-client-context" }) },
    body: JSON.stringify({
      source: { kind: "candidate", workspace: { id: workspaceId, ref: "working" } },
      memberPath: [{ member }], dataName: "record", inputs: {},
    }),
  });
  expect(response.status).toBe(200);
  return productPanelReadResponseSchema.parse(await response.json());
}

it("reads an authored candidate member using the workspace's actual build-test context", async () => {
  expect(await readCandidate()).toMatchObject({ status: "ready", value: { primaryKey: "review", label: "Review candidate" } });
  issuedContext = null;
  expect(await readCandidate()).toMatchObject({ status: "ready" });
  expect(ownerContexts).toEqual([
    { kind: "build-test", contextId: "workspace-context" }, { kind: "build-test", contextId: null },
  ]);
});

it("refuses a missing member, an off-workspace caller and a projection without use", async () => {
  expect(await readCandidate("invented")).toEqual({ status: "forbidden" });
  expect(await readCandidate("result", "bob")).toMatchObject({ status: "error", message: "Workspace not found" });
  canUseProjection = false;
  expect(await readCandidate()).toEqual({ status: "forbidden" });
  expect(ownerContexts).toEqual([]);
});
