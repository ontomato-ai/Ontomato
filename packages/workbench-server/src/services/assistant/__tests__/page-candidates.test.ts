import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { PAGE_OPERATOR_SKILL } from "../page-operator";
import type { AgentRow } from "../store";

const mocks = vi.hoisted(() => ({
  channelAgents: vi.fn(),
  allowedAgents: vi.fn(),
  requirePanelEntry: vi.fn(),
}));


vi.mock("../store", () => ({ assistantStore: { channelAgents: mocks.channelAgents } }));
vi.mock("../authorization", () => ({ allowedAgents: mocks.allowedAgents }));
vi.mock("../../product-panels/application-use", () => ({ requirePanelEntry: mocks.requirePanelEntry }));

installContentLayout({ runtimeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-candidates-runtime-")), prompts: [], publicSkillsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-candidates-public-")), runtimeResources: [] });
const { listAssistantAgents } = await import("../agents");

const owner = { domainId: "domain", userId: "user" };
const credentials = { token: "token", locale: "en" };
const skill = (name: string): RuntimeSkillRef => ({ namespace: { kind: "provider", provider: "workbench" }, name });
const row = (id: string, kind: string, skills: RuntimeSkillRef[], enabled = true): AgentRow => ({
  id,
  domain_id: owner.domainId,
  kind,
  name: id,
  description: "",
  icon: null,
  enabled,
  system_prompt: null,
  model_selection: { modelId: null },
  skills,
  class_names: [],
  enabled_mcp_service_ids: [],
  sort_order: 0,
  owner_id: null,
  engine: "pi",
  execution_user_id: null,
} as AgentRow);

const regular = row("11111111-1111-4111-8111-111111111111", "regular", [PAGE_OPERATOR_SKILL]);
const analysis = row("22222222-2222-4222-8222-222222222222", "analysis", [skill("ontomato-analyst-assistant")]);
const governance = row("33333333-3333-4333-8333-333333333333", "knowledge-governance", [PAGE_OPERATOR_SKILL]);
const custom = row("44444444-4444-4444-8444-444444444444", "custom", [PAGE_OPERATOR_SKILL]);
const disabled = row("55555555-5555-4555-8555-555555555555", "custom", [PAGE_OPERATOR_SKILL], false);
const withoutOperator = row("66666666-6666-4666-8666-666666666666", "custom", [skill("assistant-report")]);
const rows = [regular, analysis, governance, custom, disabled, withoutOperator];

function entry(defaultAgent?: unknown) {
  mocks.requirePanelEntry.mockResolvedValue({
    use: { id: "entry", pageKey: "page", ...(defaultAgent ? { defaultAgent } : {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.channelAgents.mockResolvedValue(rows);
  mocks.allowedAgents.mockImplementation(async agents => agents);
  entry();
});

it("offers only enabled agents that explicitly carry the page operator and falls back to regular", async () => {
  const result = await listAssistantAgents(owner, credentials, {
    applicationId: "app", entryKey: "entry", pageKey: "page",
  });

  expect(mocks.requirePanelEntry).toHaveBeenCalledWith(credentials, { applicationId: "app", useId: "entry" }, owner);
  expect(result.agents.map(agent => agent.id)).toEqual([regular.id, governance.id, custom.id]);
  expect(result.defaultAgentId).toBe(regular.id);
});

it("uses the entry's registered preset default when that preset is a valid candidate", async () => {
  entry({ kind: "preset", agentKind: "knowledge-governance" });

  const result = await listAssistantAgents(owner, credentials, {
    applicationId: "app", entryKey: "entry", pageKey: "page",
  });

  expect(result.defaultAgentId).toBe(governance.id);
});

it("uses the entry's registered concrete default when that agent is a valid candidate", async () => {
  entry({ kind: "id", id: custom.id });

  const result = await listAssistantAgents(owner, credentials, {
    applicationId: "app", entryKey: "entry", pageKey: "page",
  });

  expect(result.defaultAgentId).toBe(custom.id);
});

it("does not resurrect an invalid registered default as a page candidate", async () => {
  entry({ kind: "id", id: withoutOperator.id });

  const result = await listAssistantAgents(owner, credentials, {
    applicationId: "app", entryKey: "entry", pageKey: "page",
  });

  expect(result.defaultAgentId).toBeUndefined();
  expect(result.agents.map(agent => agent.id)).not.toContain(withoutOperator.id);
});
