import { beforeEach, expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import type { AgentRow, SessionRow, TurnRow } from "../../assistant/store";

const mocks = vi.hoisted(() => ({
  publicSkills: vi.fn(),
  publishSkill: vi.fn(),
  validateCurrentPageContext: vi.fn(),
}));

vi.mock("../../../core/skills/registry/manager", () => ({
  skillRegistryManager: { publicSkills: mocks.publicSkills },
}));
vi.mock("../../agent-runtime/skills", () => ({ publishSkill: mocks.publishSkill, workbenchBuiltinSkillRoot: (skill: { name: string }) => `/builtin/${skill.name}` }));
vi.mock("../../assistant/skills", () => ({ validateCurrentPageContext: mocks.validateCurrentPageContext }));
vi.mock("../../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ token: "test-callback-secret", callbackUrl: "http://workbench.test" }),
    queryTimeout: () => 30_000,
  },
}));
vi.mock("../../../config/query-settings", () => ({ getQueryTimeoutMs: () => 900_000 }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "Diagnosis system prompt" }));
vi.mock("../../../i18n", () => ({
  resolveLocale: (locale?: string) => locale ?? "en",
  getOutputLanguageInstruction: () => "Reply in English",
}));

import { prepareOpsDiagnosisRun } from "../prepare";

const agentId = "33333333-3333-4333-8333-333333333333";
const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const agent: AgentRow = {
  id: agentId,
  domain_id: "domain-1",
  kind: OPS_DIAGNOSIS_KIND,
  name: "Operations diagnosis",
  description: "Read evidence and diagnose faults",
  icon: "wrench",
  enabled: true,
  owner_id: null, execution_user_id: null,
  system_prompt: null,
  model_selection: { modelId: "diagnosis-model" },
  skills: [{ namespace: { kind: "provider", provider: "workbench" }, name: "ops-diagnosis" }],
  class_names: [],
  enabled_mcp_service_ids: [],
  sort_order: 3,
};
const session: SessionRow = {
  id: sessionId,
  domain_id: "domain-1",
  owner_id: "user-1",
  agent_id: agentId,
  workspace_id: null,
  title: "",
  origin: "user",
  latest_run_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};
const turn: TurnRow = {
  id: runId,
  session_id: sessionId,
  request_seq: 0,
  retrieval_scope_id: null,
  governance_record_id: null,
  input_hash: "hash",
  class_names: [],
  admitted: false,
  settled: false,
  created_at: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicSkills.mockResolvedValue([
    { id: "echarts", path: "/skills/echarts" },
    { id: "leaflet", path: "/skills/leaflet" },
    { id: "admin-choropleth-map", path: "/skills/admin-choropleth-map" },
  ]);
  mocks.publishSkill.mockImplementation(async (_root: string, skill: unknown) => ({
    skill,
    digest: "a".repeat(64),
  }));
  mocks.validateCurrentPageContext.mockResolvedValue(null);
});

it("prepares a diagnosis run on assistant_sessions using the agent row model and narrowed evidence callback", async () => {
  const prepared = runtimeStartRunRequestSchema.parse(await prepareOpsDiagnosisRun({
    a: agent,
    session,
    turn,
    message: "Diagnose Turn",
    input: { role: "user", content: "Diagnose Turn", timestamp: 1 },
    inputId: "44444444-4444-4444-8444-444444444444",
    ontologyContext: null,
    owner: { domainId: "domain-1", userId: "user-1" },
    credentials: { token: "secret-token", locale: "en" },
    executionUserId: null,
    executionCredentials: { token: "secret-token", locale: "en" },
  }));

  expect(prepared.definition.agentId).toBe(agentId);
  expect(prepared.definition.modelId).toBe("diagnosis-model");
  expect(prepared.definition.systemPrompt).toContain("Page operations:");
  expect(prepared).not.toHaveProperty("environment");
  expect(JSON.stringify(prepared)).not.toContain("secret-token");
  expect(Object.keys(prepared.businessCallbacks ?? {}).sort()).toEqual(["panelOperations", "workbench"]);
  expect(prepared.businessCallbacks?.workbench).toMatchObject({
    baseUrl: "http://workbench.test/api/observe/evidence",
    credential: expect.stringMatching(/^wbc2\./),
  });
});

it("validates and narrates the current placement when invoked from an operations panel", async () => {
  mocks.validateCurrentPageContext.mockResolvedValue({ panelId: "builtin-product-ops-turn-evidence" });

  const prepared = runtimeStartRunRequestSchema.parse(await prepareOpsDiagnosisRun({
    a: agent,
    session,
    turn,
    message: "Diagnose selected turn",
    input: { role: "user", content: "Diagnose selected turn", timestamp: 1 },
    inputId: "44444444-4444-4444-8444-444444444444",
    ontologyContext: null,
    owner: { domainId: "domain-1", userId: "user-1" },
    credentials: { token: "secret-token", locale: "en" },
    executionUserId: null,
    executionCredentials: { token: "secret-token", locale: "en" },
    pageSkillContext: {
      applicationId: "operations", entryKey: "ops-turn-evidence", pageKey: "ops-turn-evidence",
      useId: "ops-turn-evidence", panelId: "builtin-product-ops-turn-evidence", path: "/operations/turn-evidence", memberPath: [],
    },
  }));

  expect(prepared.definition.systemPrompt).toContain("Page operations:");
  expect(prepared.definition.skills.map(({ skill }) => skill.name)).toContain("ontomato-page-operator");
  expect(prepared.definition.systemPrompt).toContain("builtin-product-ops-turn-evidence");
  expect(prepared.businessCallbacks?.panelOperations).toMatchObject({
    baseUrl: `http://workbench.test/api/assistant/executions/${runId}/panels`,
    credential: expect.stringMatching(/^wbc2\./),
  });
});
