import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import type { AgentLineupEntry, AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import AnalysisAgentManager from "../components/AnalysisAgentManager.vue";
import { workbenchI18n } from "../../../i18n";

const mocks = vi.hoisted(() => ({
  getAgentLineup: vi.fn(),
  saveAgentLineup: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getWorkbenchAppearance: vi.fn(),
}));

vi.mock("../../analysis/api", () => ({
  analysisAgentApi: {
    getAgentLineup: mocks.getAgentLineup,
    saveAgentLineup: mocks.saveAgentLineup,
    updateAgent: mocks.updateAgent,
    deleteAgent: mocks.deleteAgent,
  },
}));
vi.mock("../../skills/api", () => ({
  skillsApi: {
    listAnalysisSkills: async () => [],
    listVisualizationSkills: async () => [],
  },
}));
vi.mock("../../workbench/api", () => ({
  getWorkbenchAppearance: mocks.getWorkbenchAppearance,
}));

function agent(id: string, name: string, isEnabled = true): AnalysisAgent {
  return {
    id,
    name,
    description: "",
    executionMode: "loop",
    reportDeliverableEnabled: true,
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    graphScope: { mode: "panorama" },
    isEnabled,
    createdAt: 1,
    updatedAt: 1,
  };
}

const lineup: AgentLineupEntry[] = [
  { kind: "agent", agent: agent("a", "Sales") },
  { kind: "qa" },
  { kind: "agent", agent: agent("b", "Finance", false) },
];

const wrappers: ReturnType<typeof mount>[] = [];

async function mountManager() {
  mocks.getAgentLineup.mockResolvedValue(structuredClone(lineup));
  mocks.getWorkbenchAppearance.mockResolvedValue({
    brand: { name: "", subtitle: "", logo: "" },
    qa: { name: "Ask data", description: "", avatarKey: "", avatarColor: "" },
    addAgentLabel: "",
  });
  const wrapper = mount(AnalysisAgentManager, {
    global: { plugins: [workbenchI18n(), ElementPlus], stubs: { AgentCreateDialog: true } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllMocks();
});

describe("agent manager lineup", () => {
  it("shows the Q&A agent where the server lineup puts it, without edit, disable or delete", async () => {
    const wrapper = await mountManager();
    const cards = wrapper.findAll(".agent-card");
    expect(cards.map((card) => card.find(".agent-title").text())).toEqual([
      "Sales",
      "Ask data",
      "Finance",
    ]);
    expect(cards.map((card) => card.find(".more-btn").exists())).toEqual([true, false, true]);
  });

  it("saves one whole order with the Q&A entry, not per-agent sort orders", async () => {
    const wrapper = await mountManager();
    const cards = wrapper.findAll(".agent-card");
    await cards[1].trigger("dragstart");
    await cards[0].trigger("drop");
    await flushPromises();
    expect(mocks.saveAgentLineup).toHaveBeenCalledWith(["__qa__", "a", "b"]);
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(wrapper.findAll(".agent-title").map((title) => title.text())).toEqual([
      "Ask data",
      "Sales",
      "Finance",
    ]);
  });
});
