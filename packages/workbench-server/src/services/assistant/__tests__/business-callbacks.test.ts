import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { runtimeBusinessCallbacksSchema, type RuntimeBusinessCallbacks } from "@ontomato/contracts/agent-runtime-business-callbacks";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  source: vi.fn(),
  record: vi.fn(),
  skills: vi.fn(),
  open: vi.fn(),
  overview: vi.fn(),
  hasGovernance: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock("../../product-assets/agent-profile", () => ({
  profileForSession: mocks.profile,
  profileSourceForSession: mocks.source,
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
const releaseId = "44444444-4444-4444-8444-444444444444";
const mcpServiceId = "55555555-5555-4555-8555-555555555555";
const analyst = { name: "analyst", namespace: { kind: "provider" as const, provider: "ontology" } };
const digest = "a".repeat(64);
const forbiddenEnvPattern = /(?:TK|API_KEY|CALLBACK|_URL|RETRIEVAL_CALLER_ID|EXTERNAL_VARIABLES|RUN_ID)$/;

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
  mocks.source.mockResolvedValue(null);
  mocks.open.mockResolvedValue({ id: runId });
  mocks.profile.mockResolvedValue(null);
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

function assertCleanEnvironment(env: { values: Record<string, string>; secrets: Record<string, string> }) {
  expect(env.secrets).toEqual({});
  for (const key of [...Object.keys(env.values), ...Object.keys(env.secrets)]) {
    expect(key).not.toMatch(forbiddenEnvPattern);
  }
}

async function callWithCredential(path: string, credential: string, header: "X-Ontomato-Callback-Credential" | "tk" = "X-Ontomato-Callback-Credential") {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
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
    retrieval: "",
    governance: "",
    product: "/tool-1",
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
  assertCleanEnvironment(run.environment);
  expect(run.environment.values).toEqual({ ONTOMATO_ASSISTANT_SESSION_ID: sessionId });
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
  assertCleanEnvironment(run.environment);
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
  assertCleanEnvironment(run.environment);
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

it("declares only the product callback for product-profile runs and keeps absolute tool paths", async () => {
  mocks.source.mockResolvedValue({ profileId: "profile" });
  mocks.profile.mockResolvedValue({
    id: "profile",
    agentId: "agent",
    releaseId,
    instructions: "Instructions",
    tools: [{ assetId: "tool-1", name: "Tool 1", kind: "action", parameters: [] }],
    contextViews: [],
    issues: [],
  });
  const run = runtimeStartRunRequestSchema.parse(await prepareAnalystRun(basePreparation(null)));
  assertCleanEnvironment(run.environment);
  expect(Object.keys(run.businessCallbacks ?? {})).toEqual(["product"]);
  expect(run.businessCallbacks?.product?.baseUrl).toBe(
    `http://workbench.test/api/product-assets/profile/releases/${releaseId}/tools`,
  );
  expect(run.definition.productTools?.[0]?.path).toBe(
    `/api/product-assets/profile/releases/${releaseId}/tools/tool-1?sessionId=${sessionId}`,
  );
  // Bare /tools without trailing slash/toolId must be rejected because credential pathPrefix ends with /tools/.
  const bareTools = await callWithCredential(
    `/api/product-assets/profile/releases/${releaseId}/tools`,
    run.businessCallbacks!.product!.credential,
  );
  expect(bareTools.status).toBe(401);
  await assertNarrowedCallbacks(run.businessCallbacks!);
});

it("declares workbench, ontology and authoring callbacks for app-builder runs without credentials in environment", async () => {
  const prep = basePreparation(null);
  prep.a.kind = "app-builder:variant";
  const run = runtimeStartRunRequestSchema.parse(await prepareAppBuilderRun(prep));
  assertCleanEnvironment(run.environment);
  expect(run.environment.values).toEqual({
    ONTOMATO_WORKSPACE_ID: workspaceId,
    ONTOMATO_EXECUTION_KIND: "build-test",
  });
  expect(Object.keys(run.businessCallbacks ?? {}).sort()).toEqual([
    "authoring",
    "ontology",
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
