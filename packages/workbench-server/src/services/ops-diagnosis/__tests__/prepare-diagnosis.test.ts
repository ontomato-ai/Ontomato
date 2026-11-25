import express from "express";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { HttpError } from "../../../utils/errors";
import { workbenchServerResourceRoot } from "../../../content/resources";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  allowed: vi.fn(),
  readModel: vi.fn(),
  publicSkills: vi.fn(),
  publishSkill: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../model-settings", () => ({ readDiagnosisModel: mocks.readModel }));
vi.mock("../../assistant/store", () => ({
  assistantStore: { opsDiagnosis: vi.fn(async () => undefined) },
}));
vi.mock("../../../core/skills/registry/manager", () => ({
  skillRegistryManager: { publicSkills: mocks.publicSkills },
}));
vi.mock("../../agent-runtime/skills", () => ({ publishSkill: mocks.publishSkill }));
vi.mock("../../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ token: "test-callback-secret", callbackUrl: "http://workbench.test" }),
    queryTimeout: () => 30000,
  },
}));
vi.mock("../../../config/query-settings", () => ({ getQueryTimeoutMs: () => 900_000 }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "Diagnosis prompt" }));
vi.mock("../../../i18n", () => ({ resolveLocale: (locale?: string) => locale ?? "en", getOutputLanguageInstruction: () => "Reply in English" }));

vi.mock("../../product-governance/grants", () => ({
  productGrantAllowed: mocks.allowed,
  requireProductGrant: async (...args: unknown[]) => {
    if (!await mocks.allowed(...args)) throw new HttpError(403, "Use Grant required", "PRODUCT_FORBIDDEN");
  },
}));

import { diagnosisService, prepareDiagnosis } from "../service";
import { unwrapCallbackCredential } from "../../agent-runtime/callback-credential";

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const opsScript = path.resolve(workbenchServerResourceRoot, "resources/runtime-skills/ops-diagnosis/scripts/ops.mjs");
const servers: Server[] = [];

beforeAll(() => {
  // Ensure clean mocks
});

afterAll(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue(true);
  const createdAt = new Date();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM ops_sessions")) {
      return {
        rows: [{
          id: sessionId,
          domain_id: "domain",
          owner_id: "user",
          title: "",
          target: null,
          created_at: createdAt,
          updated_at: createdAt,
        }],
      };
    }
    if (sql.includes("SELECT * FROM ops_run_intents")) return { rows: [] };
    if (sql.includes("INSERT INTO ops_run_intents")) {
      return {
        rows: [{
          id: runId,
          session_id: sessionId,
          fingerprint: "",
          definition: null,
          language: "en",
        }],
      };
    }
    return { rows: [] };
  });
  mocks.readModel.mockResolvedValue({ modelSelection: { modelId: null } });
  mocks.publicSkills.mockResolvedValue([
    { id: "echarts", path: "/skills/echarts" },
    { id: "leaflet", path: "/skills/leaflet" },
    { id: "admin-choropleth-map", path: "/skills/admin-choropleth-map" },
  ]);
  mocks.publishSkill.mockImplementation(async (_root: string, skill: unknown) => ({
    skill,
    digest: "a".repeat(64),
  }));
});

it("declares narrowed observe-evidence businessCallback and strips addresses/credentials from environment", async () => {
  // Let INSERT return empty so readIntent wouldn't override; make INSERT return the stored intent directly.
  let storedDefinition: unknown;
  let storedFingerprint = "";
  mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM ops_sessions")) {
      return { rows: [{ id: sessionId, domain_id: "domain", owner_id: "user", title: "", target: null, created_at: new Date(), updated_at: new Date() }] };
    }
    if (sql.includes("SELECT * FROM ops_run_intents")) return { rows: storedDefinition
      ? [{ id: runId, session_id: sessionId, fingerprint: storedFingerprint, definition: storedDefinition, language: "en" }]
      : [] };
    if (sql.includes("INSERT INTO ops_run_intents")) {
      storedFingerprint = String(params?.[2] ?? "");
      storedDefinition = JSON.parse(String(params?.[3] ?? "{}"));
      return { rows: [{ id: runId, session_id: sessionId, fingerprint: storedFingerprint, definition: storedDefinition, language: "en" }] };
    }
    return { rows: [] };
  });

  const prepare = () => prepareDiagnosis(
      sessionId,
      runId,
      { role: "user", content: "Check logs", timestamp: 1 },
      { domainId: "domain", userId: "user" },
      { token: "diagnosis-secret", locale: "en" },
    );
  const prepared = runtimeStartRunRequestSchema.parse(await prepare());

  expect(prepared.definition.agentId).toBe(DIAGNOSIS_AGENT_ID);
  expect(prepared.environment).toEqual({ values: {}, secrets: {} });
  for (const key of [...Object.keys(prepared.environment.values), ...Object.keys(prepared.environment.secrets)]) {
    expect(key).not.toMatch(/(?:TK|API_KEY|CALLBACK|_URL|RUN_ID|CORRELATION_ID)$/);
  }
  expect(JSON.stringify(prepared)).not.toContain("diagnosis-secret");
  expect(prepared.businessCallbacks).toMatchObject({
    workbench: {
      baseUrl: "http://workbench.test/api/observe/evidence",
      credential: expect.stringMatching(/^wbc1\./),
    },
  });

  storedDefinition = { ...prepared.definition, compaction: { systemPrompt: "Legacy prompt" } };
  expect(runtimeStartRunRequestSchema.parse(await prepare()).definition).toEqual(prepared.definition);

  // Verify the sealed credential works on /api/observe/evidence/* and rejects /api/observe/evidence or other routes.
  const app = express();
  app.use(unwrapCallbackCredential);
  app.all("*", (req, res) => {
    res.json({ ok: Boolean(res.locals.runtimeCallback), tk: req.headers.tk ?? null });
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cred = prepared.businessCallbacks!.workbench!.credential;

  const allowed = await fetch(`${base}/api/observe/evidence/logs/workbench`, {
    headers: { "X-Ontomato-Callback-Credential": cred, "X-Ontomato-Run-Id": runId },
  });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ ok: true, tk: "diagnosis-secret" });

  const outside = await fetch(`${base}/api/observe/diagnoses`, {
    headers: { "X-Ontomato-Callback-Credential": cred, "X-Ontomato-Run-Id": runId },
  });
  expect(outside.status).toBe(401);

  const barePrefix = await fetch(`${base}/api/observe/evidence`, {
    headers: { "X-Ontomato-Callback-Credential": cred, "X-Ontomato-Run-Id": runId },
  });
  expect(barePrefix.status).toBe(401);
});

it("ops.mjs uses forwarded path and callback credential in platform mode, and /api/observe/evidence + tk outside", async () => {
  const seen: { url: string; headers: IncomingMessage["headers"] }[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function runCli(env: Record<string, string>) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [opsScript, "health", "{}"], { env: { PATH: process.env.PATH ?? "", ...env } });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  const platformResult = await runCli({
    ONTOMATO_SKILL_SCENARIO: "platform",
    ONTOMATO_WORKBENCH_URL: `${base}/workbench`,
    ONTOMATO_EXECUTION_CALLBACK: "session-callback-placeholder",
    ONTOMATO_TK: "session-callback-placeholder",
    ONTOMATO_SESSION_ID: sessionId,
    ONTOMATO_LANGUAGE: "zh-CN",
  });
  expect(platformResult.code, platformResult.stderr).toBe(0);
  expect(seen[0]).toMatchObject({
    url: "/workbench/health?",
    headers: {
      "x-ontomato-callback-credential": "session-callback-placeholder",
      "x-ontomato-session-id": sessionId,
      "accept-language": "zh-CN",
    },
  });
  expect(seen[0].headers.tk).toBeUndefined();
  expect(seen[0].headers["x-ontomato-run-id"]).toBeUndefined();

  const externalResult = await runCli({
    ONTOMATO_WORKBENCH_URL: base,
    ONTOMATO_TK: "external-user-tk",
  });
  expect(externalResult.code, externalResult.stderr).toBe(0);
  expect(seen[1]).toMatchObject({
    url: "/api/observe/evidence/health?",
    headers: { tk: "external-user-tk" },
  });
});

it("hides diagnosis and refuses conversation writes and prepare when use is revoked", async () => {
  const owner = { domainId: "domain", userId: "user" };
  const credentials = { token: "reader" };
  const forbidden = { status: 403, code: "PRODUCT_FORBIDDEN" };
  mocks.allowed.mockResolvedValue(false);
  await expect(diagnosisService.agents(owner, credentials)).resolves.toEqual({ agents: [] });
  await expect(diagnosisService.create(sessionId, owner, { agentId: DIAGNOSIS_AGENT_ID }, credentials)).rejects.toMatchObject(forbidden);
  await expect(diagnosisService.send(sessionId, runId, { message: "Continue" }, owner, credentials, "human")).rejects.toMatchObject(forbidden);
  await expect(prepareDiagnosis(sessionId, runId, { role: "user", content: "Continue", timestamp: 1 }, owner, credentials)).rejects.toMatchObject(forbidden);
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.allowed).toHaveBeenCalledWith(DIAGNOSIS_AGENT_ID, "use", credentials);
});
