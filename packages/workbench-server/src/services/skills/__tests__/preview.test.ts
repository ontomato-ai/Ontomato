import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  skill: vi.fn(), enabled: vi.fn(), prepare: vi.fn(), start: vi.fn(), wait: vi.fn(), text: vi.fn(),
}));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {
  forDomain: async () => ({ getSkillById: mocks.skill, isSkillEnabled: mocks.enabled }),
} }));
vi.mock("../../assistant/skills", () => ({ prepareAssistantSkills: mocks.prepare }));
vi.mock("../skill-manager", () => ({ skillReference: () => ({ name: "network-graph", namespace: { kind: "provider", provider: "workbench" } }) }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "Use the skill" }));
vi.mock("../../../platform/agent-runtime/runtime", () => ({
  startAuxiliary: mocks.start, waitForRun: mocks.wait, finalText: () => "Result", userSkillEnvironment: () => ({ values: {}, secrets: {} }),
}));
import { previewSkill } from "../preview";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.skill.mockReturnValue({ manifest: { type: "executable", category: "visualization" } });
  mocks.enabled.mockReturnValue(true);
  mocks.prepare.mockResolvedValue([]);
  mocks.start.mockResolvedValue({ client: { text: mocks.text }, runId: "run-a" });
});

it("delivers the runtime's HTML artifact to the debug preview", async () => {
  const artifact = { id: "artifact-a", mediaType: "text/html", path: "outputs/network-graph.html" };
  mocks.wait.mockResolvedValue({ run: { status: "stopped", stopReason: "stop", errorMessage: null, resolvedSkills: [] }, artifacts: [artifact] });
  mocks.text.mockResolvedValue("<html>Network</html>");
  const result = await previewSkill({ domainId: "domain-a", userId: "user-a" }, {}, "network-graph", {});
  expect(result.html).toBe("<html>Network</html>");
  expect(mocks.text).toHaveBeenCalledWith("/v1/artifacts/artifact-a/content");
  expect(result.json).toMatchObject({ artifacts: [artifact] });
  expect(result.text).toBe("Result");
});

it("retains the text result when the run produced no HTML", async () => {
  mocks.wait.mockResolvedValue({ run: { status: "stopped", stopReason: "stop", errorMessage: null, resolvedSkills: [] }, artifacts: [] });
  const result = await previewSkill({ domainId: "domain-a", userId: "user-a" }, {}, "network-graph", {});
  expect(result.html).toBeUndefined();
  expect(result.text).toBe("Result");
  expect(mocks.text).not.toHaveBeenCalled();
});
