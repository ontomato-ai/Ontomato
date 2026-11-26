import express from "express";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { runtimeBusinessCallbacksSchema, type RuntimeBusinessCallbacks } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { workbenchServerResourceRoot } from "../../../content/resources";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  skills: vi.fn(),
  open: vi.fn(),
  overview: vi.fn(),
  hasGovernance: vi.fn(),
  authorize: vi.fn(),
}));


vi.mock("../../../utils/backend-client", () => ({
  backendPost: vi.fn(),
  buildBackendHeaders: (_token: unknown, _user: unknown, _locale: unknown, _key: unknown, headers: unknown) => headers ?? {},
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "Prompt" }));
vi.mock("../prompts", () => ({ effectiveSystemPrompt: () => "Instructions" }));
vi.mock("../../../i18n", () => ({ resolveLocale: (locale?: string) => locale ?? "en", getOutputLanguageInstruction: () => "Reply in English" }));
vi.mock("../../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ token: "test-callback-secret", callbackUrl: "http://workbench.test" }),
    queryTimeout: () => 30000,
  },
}));
vi.mock("../../../config/query-settings", () => ({ getQueryTimeoutMs: () => 900_000 }));
vi.mock("../skills", () => ({
  needsRetrievalScope: (skills: unknown[]) => skills.length > 0,
  hasGovernanceSkill: mocks.hasGovernance,
  prepareAssistantSkills: mocks.skills,
}));
vi.mock("../context", () => ({ assistantOntologyContext: mocks.overview }));
vi.mock("../store", () => ({ assistantStore: { turns: async () => [], recordRetrievalScope: mocks.record } }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    session = async () => ({ messages: [{ id: "input", messageSeq: 1, message: { role: "user", content: "Question", timestamp: 1 } }] });
  },
}));
vi.mock("../ontology-retrieval", () => ({ OntologyRetrievalClient: class { open = mocks.open; } }));
vi.mock("../../app-builder/build-tests", () => ({ WorkspaceBuildTests: class { authorize = mocks.authorize; } }));
vi.mock("../../app-builder/sdk", () => ({ currentAppSdk: async () => ({ version: "sdk" }) }));
vi.mock("../../agent-runtime/skills", () => ({
  workbenchBuiltinSkillRoot: () => "/skills",
  publishSkill: async (_root: string, skill: unknown) => ({ skill, digest: "a".repeat(64) }),
}));

import { prepareAnalystRun, type AssistantPreparation } from "../prepare";
import { prepareAppBuilderRun } from "../../app-builder/prepare";
import { executionBusinessCallbacks } from "../execution-callback";
import { unwrapCallbackCredential } from "../../agent-runtime/callback-credential";

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const mcpServiceId = "55555555-5555-4555-8555-555555555555";
const analyst = { name: "analyst", namespace: { kind: "provider" as const, provider: "ontology" } };
const digest = "a".repeat(64);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(unwrapCallbackCredential);
  app.all("*", (req, res) => {
    res.json({
      hasCallback: Boolean(res.locals.runtimeCallback),
      runId: res.locals.runtimeCallback?.runId ?? null,
      tk: req.headers.tk ?? null,
      apiKey: req.headers["x-api-key"] ?? null,
    });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockResolvedValue({ id: runId });
  mocks.skills.mockResolvedValue({ skills: [{ skill: analyst, digest }], pageControl: true });
  mocks.overview.mockResolvedValue("Ontology");
  mocks.hasGovernance.mockReturnValue(false);
});

function basePreparation(executionUserId: string | null = null): AssistantPreparation {
  return {
    a: {
      id: "agent",
      kind: "regular",
      skills: [analyst],
      enabled_mcp_service_ids: [mcpServiceId],
      model_selection: { modelId: null },
    },
    session: { id: sessionId, agent_id: "agent", workspace_id: workspaceId },
    turn: { id: runId, created_at: new Date(), retrieval_scope_id: runId, class_names: ["Person"] },
    message: "Question",
    inputId: "input",
    input: { role: "user", content: "Question", timestamp: 1 },
    ontologyContext: null,
    owner: { domainId: "domain", userId: "human" },
    credentials: { token: "human-secret", locale: "en" },
    executionUserId,
    executionCredentials: executionUserId === null
      ? { token: "human-secret", locale: "en" }
      : { apiKey: "executor-key", locale: "en", executionUserId },
    externalVariables: { step: "1" },
  } as unknown as AssistantPreparation;
}

async function callWithCredential(
  path: string,
  credential: string,
  header: "X-Ontomato-Callback-Credential" | "tk" = "X-Ontomato-Callback-Credential",
  method = "POST",
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { [header]: credential, "X-Ontomato-Run-Id": runId },
  });
}

async function assertNarrowedCallbacks(callbacks: RuntimeBusinessCallbacks) {
  runtimeBusinessCallbacksSchema.parse(callbacks);
  const sampleSubpath: Record<keyof RuntimeBusinessCallbacks, string> = {
    workbench: "/api/dashboards",
    ontology: "/ontology/query/overview",
    panelOperations: "/read",
    authoring: "/action/context",
    generation: "/runtime-context",
    retrieval: "",
    governance: "",
  };
  for (const [key, entry] of Object.entries(callbacks) as [keyof RuntimeBusinessCallbacks, NonNullable<RuntimeBusinessCallbacks[keyof RuntimeBusinessCallbacks]>][]) {
    const declaredPrefix = new URL(entry.baseUrl).pathname;
    const validPath = declaredPrefix + sampleSubpath[key];
    const okResponse = await callWithCredential(validPath, entry.credential, key === "governance" ? "tk" : "X-Ontomato-Callback-Credential");
    expect(okResponse.status, `${key} should allow ${validPath}`).toBe(200);
    expect(await okResponse.json()).toMatchObject({ hasCallback: true, runId, tk: "human-secret" });

    // Sibling path outside the declared prefix must be rejected (credential prefix cannot be wider than baseUrl).
    const parentPrefix = declaredPrefix.slice(0, declaredPrefix.lastIndexOf("/")) || "/";
    const outsidePath = `${parentPrefix}/outside-scope`;
    const deniedResponse = await callWithCredential(outsidePath, entry.credential);
    expect(deniedResponse.status, `${key} must reject ${outsidePath}`).toBe(401);
  }
}

it("declares narrowed businessCallbacks and strips addresses/credentials for user-initiated analyst runs", async () => {
  const run = runtimeStartRunRequestSchema.parse(await prepareAnalystRun(basePreparation(null)));
  expect(run).not.toHaveProperty("environment");
  expect(Object.keys(run.businessCallbacks ?? {}).sort()).toEqual([
    "authoring",
    "ontology",
    "panelOperations",
    "retrieval",
    "workbench",
  ]);
  await assertNarrowedCallbacks(run.businessCallbacks!);
  expect(JSON.stringify(run)).not.toContain("human-secret");
});

it("uses initiator credentials inside businessCallbacks for execution-user runs without leaking executor keys", async () => {
  const run = runtimeStartRunRequestSchema.parse(await prepareAnalystRun(basePreparation("executor")));
  expect(run).not.toHaveProperty("environment");
  expect(Object.keys(run.businessCallbacks ?? {}).sort()).toEqual([
    "authoring",
    "ontology",
    "panelOperations",
    "retrieval",
    "workbench",
  ]);
  await assertNarrowedCallbacks(run.businessCallbacks!);
  expect(JSON.stringify(run)).not.toContain("executor-key");
  expect(JSON.stringify(run)).not.toContain("human-secret");
});

it("adds the governance callback only when a governance skill is loaded", async () => {
  mocks.hasGovernance.mockReturnValue(true);
  const run = runtimeStartRunRequestSchema.parse(await prepareAnalystRun(basePreparation(null)));
  expect(run).not.toHaveProperty("environment");
  expect(Object.keys(run.businessCallbacks ?? {}).sort()).toEqual([
    "authoring",
    "governance",
    "ontology",
    "panelOperations",
    "retrieval",
    "workbench",
  ]);
  expect(run.businessCallbacks?.governance?.baseUrl).toBe(`http://workbench.test/api/assistant/sessions/${sessionId}/governance-window`);
  await assertNarrowedCallbacks(run.businessCallbacks!);
});

it("declares workbench, ontology, authoring and panel callbacks for app-builder runs without credentials in environment", async () => {
  const prep = basePreparation(null);
  prep.a.kind = "app-builder";
  const run = runtimeStartRunRequestSchema.parse(await prepareAppBuilderRun(prep));
  expect(run).not.toHaveProperty("environment");
  expect(run.definition.skills).toContainEqual(expect.objectContaining({
    skill: { namespace: { kind: "provider", provider: "workbench" }, name: "dashboard-pages" },
  }));
  expect(Object.keys(run.businessCallbacks ?? {}).sort()).toEqual([
    "authoring",
    "ontology",
    "panelOperations",
    "workbench",
  ]);
  await assertNarrowedCallbacks(run.businessCallbacks!);
});

it("supports authoringOnly callback scoping narrowed strictly to authoring/", async () => {
  const callbacks = executionBusinessCallbacks(
    { domainId: "domain", userId: "human" },
    { token: "human-secret" },
    runId,
    { scope: "authoring-only" },
  );
  expect(Object.keys(callbacks)).toEqual(["authoring"]);
  await assertNarrowedCallbacks(callbacks);
  const workbenchDenied = await callWithCredential(`/api/assistant/executions/${runId}/workbench/api/dashboards`, callbacks.authoring!.credential);
  expect(workbenchDenied.status).toBe(401);
});

it("keeps platform-mode URLs from page.mjs, dashboard-skill and app-builder inside declared prefixes", async () => {
  const prep = basePreparation(null);
  const analystRun = runtimeStartRunRequestSchema.parse(await prepareAnalystRun(prep));
  prep.a.kind = "app-builder";
  const builderRun = runtimeStartRunRequestSchema.parse(await prepareAppBuilderRun(prep));

  const seen: { kind: string; method: string; targetPath: string; tk: unknown }[] = [];
  const relay = express();
  relay.use(express.json());
  relay.all("/session/business/:kind/*", async (req, res) => {
    const kind = req.params.kind as "workbench" | "ontology";
    const callbacks = kind === "workbench" ? builderRun.businessCallbacks! : analystRun.businessCallbacks!;
    const declaration = callbacks[kind]!;
    const suffix = (req.params as Record<string, string>)[0] ?? "";
    const targetPath = new URL(declaration.baseUrl).pathname + "/" + suffix;
    expect(targetPath.startsWith(new URL(declaration.baseUrl).pathname + "/")).toBe(true);
    seen.push({ kind, method: req.method, targetPath, tk: req.header("tk") });
    const search = new URL(req.originalUrl, "http://relay.test").search;
    if (suffix === "api/assistant/agent-skills") expect(search).toBe("?agentTarget=draft");
    const unwrapped = await callWithCredential(targetPath + search, declaration.credential, "X-Ontomato-Callback-Credential", req.method);
    expect(unwrapped.status).toBe(200);
    if (kind === "workbench" && req.method === "GET" && suffix === "api/assistant/agent-definitions") {
      res.json({ agents: [], nextCursor: null });
      return;
    }
    if (kind === "ontology" && suffix.startsWith("model-options")) {
      res.json({ data: [] });
      return;
    }
    if (kind === "workbench" && suffix.startsWith("api/dashboards")) {
      res.json({ data: suffix === "api/dashboards" ? [] : { id: "d1", name: "Board", groups: [] } });
      return;
    }
    res.json({ data: [] });
  });
  const relayServer = relay.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => relayServer.once("listening", resolve));
  const relayBase = `http://127.0.0.1:${(relayServer.address() as AddressInfo).port}/session`;

  const runNodeScript = (scriptPath: string, args: string[], env: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], { env });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error(`${scriptPath} ${args.join(" ")} exited ${code}: ${stderr}`)));
    });

  try {
    const sessionEnv = {
      PATH: process.env.PATH ?? "",
      ONTOMATO_SKILL_SCENARIO: "platform",
      ONTOMATO_WORKBENCH_URL: `${relayBase}/business/workbench`,
      ONTOMATO_ONTOLOGY_URL: `${relayBase}/business/ontology`,
      ONTOMATO_TK: "session-placeholder-token",
    };

    const pageScript = path.resolve(workbenchServerResourceRoot, "resources/runtime-skills/ontomato-agent-builder/scripts/page.mjs");
    await runNodeScript(pageScript, ["list"], sessionEnv);
    await runNodeScript(pageScript, ["skills", "draft"], sessionEnv);
    await runNodeScript(pageScript, ["models"], sessionEnv);
    await runNodeScript(pageScript, ["execution-users"], sessionEnv);

    const dashboardScript = path.resolve(workbenchServerResourceRoot, "skills/pages/dashboard-pages/scripts/dashboard-pages.mjs");
    await runNodeScript(dashboardScript, ["list"], sessionEnv);
    await runNodeScript(dashboardScript, ["read", "--dashboard-id", "d1"], sessionEnv);

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
    const { currentSdkClient } = await import(path.join(repoRoot, "agent-skills/ontomato-app-builder/scripts/current-sdk.mjs"));
    const { panelRegistrationClient } = await import(path.join(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-registration.mjs"));
    const sdk = currentSdkClient({ workbenchUrl: sessionEnv.ONTOMATO_WORKBENCH_URL, headers: { tk: sessionEnv.ONTOMATO_TK } });
    await sdk.current();
    await sdk.read({ publicBasePath: "", sdkBasePath: "/apps-sdk/current" }, "sdk.json");
    const registration = panelRegistrationClient({
      workbenchUrl: sessionEnv.ONTOMATO_WORKBENCH_URL,
      ontologyUrl: sessionEnv.ONTOMATO_ONTOLOGY_URL,
      headers: { tk: sessionEnv.ONTOMATO_TK },
    });
    await registration.deletePanel("panel-1");
    await registration.deleteApplication("app-1");

    expect(seen).toEqual([
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/api/assistant/agent-definitions`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/api/assistant/agent-skills`, tk: "session-placeholder-token" },
      { kind: "ontology", method: "GET", targetPath: `/api/assistant/executions/${runId}/ontology/model-options`, tk: "session-placeholder-token" },
      { kind: "ontology", method: "GET", targetPath: `/api/assistant/executions/${runId}/ontology/platform/agent-execution/options`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/api/dashboards`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/api/dashboards/d1`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/api/apps-sdk/current`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "GET", targetPath: `/api/assistant/executions/${runId}/workbench/apps-sdk/current/sdk.json`, tk: "session-placeholder-token" },
      { kind: "workbench", method: "DELETE", targetPath: `/api/assistant/executions/${runId}/workbench/api/product-panels/panel-1`, tk: "session-placeholder-token" },
      { kind: "ontology", method: "DELETE", targetPath: `/api/assistant/executions/${runId}/ontology/platform/applications/app-1`, tk: "session-placeholder-token" },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => relayServer.close(err => err ? reject(err) : resolve()));
  }
});
