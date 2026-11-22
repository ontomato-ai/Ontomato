import { expect, it, vi } from "vitest";
import { listDefaultAgentOptions, resolveDefaultAgent } from "../default-agents";
import type { AgentRow } from "../store";

const mocks = vi.hoisted(() => ({ agents: vi.fn(), translate: vi.fn() }));
vi.mock("../store", () => ({ assistantStore: { agents: mocks.agents } }));
vi.mock("../../../i18n", () => ({ tForLocale: mocks.translate }));

function agent(id: string, kind: string, name: string, enabled = true): AgentRow {
  return {
    id, kind, name, enabled, domain_id: "chosen-domain", description: "", icon: null, system_prompt: null,
    execution_user_id: null, model_selection: { modelId: null }, skills: [], class_names: [],
    enabled_mcp_service_ids: [], sort_order: 0,
  };
}

const regular = agent("assistant-id", "regular", "Assistant");
const preset = agent("analyst-id", "analysis", "Analyst");
const custom = agent("custom-id", "custom-id", "Triage");
const disabled = agent("disabled-id", "disabled-id", "Disabled", false);
const definitions = [regular, preset, custom, disabled];

it("lists only enabled choices for this domain, in submission form and with the reader's names", async () => {
  mocks.agents.mockResolvedValue(definitions);
  mocks.translate.mockReturnValue("分析助手");
  expect(await listDefaultAgentOptions("chosen-domain", "zh-CN")).toEqual([
    { value: { kind: "preset", agentKind: "analysis" }, label: "分析助手" },
    { value: { kind: "id", id: "custom-id" }, label: "Triage" },
  ]);
  expect(mocks.agents).toHaveBeenCalledWith("chosen-domain");
  expect(mocks.translate).toHaveBeenCalledWith("zh-CN", "assistant.default.analysis.name");
});

it("resolves enabled defaults by preset or ID and distinguishes missing and disabled definitions", () => {
  expect(resolveDefaultAgent(definitions, { kind: "preset", agentKind: "analysis" })).toEqual({ agent: preset });
  expect(resolveDefaultAgent(definitions, { kind: "id", id: custom.id })).toEqual({ agent: custom });
  expect(resolveDefaultAgent(definitions, { kind: "preset", agentKind: "regular" })).toEqual({ agent: regular });
  expect(resolveDefaultAgent(definitions, { kind: "id", id: disabled.id })).toEqual({ reason: "disabled" });
  expect(resolveDefaultAgent(definitions, { kind: "id", id: "another-domain-id" })).toEqual({ reason: "missing" });
});
