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

  /** Lays the cards out in one row of 280px-wide cards with 20px gaps, as the grid does. */
  function layOut(wrapper: Awaited<ReturnType<typeof mountManager>>) {
    const cards = wrapper.findAll(".agent-card");
    cards.forEach((card, index) => {
      const left = index * 300;
      card.element.getBoundingClientRect = () =>
        ({ top: 0, bottom: 200, left, right: left + 280 }) as DOMRect;
    });
    return { cards, zone: wrapper.find(".agents-container") };
  }
  const titles = (wrapper: Awaited<ReturnType<typeof mountManager>>) =>
    wrapper.findAll(".agent-title").map((title) => title.text());

  it("drops anywhere in the card area at the indicated gap and saves one whole order", async () => {
    const wrapper = await mountManager();
    const { cards, zone } = layOut(wrapper);
    await cards[1].trigger("dragstart");
    await zone.trigger("dragover", { clientX: 50, clientY: 100 });
    expect(cards[0].classes()).toContain("insert-before");
    await zone.trigger("drop", { clientX: 50, clientY: 100 });
    await cards[1].trigger("dragend");
    await flushPromises();
    expect(mocks.saveAgentLineup).toHaveBeenCalledWith(["__qa__", "a", "b"]);
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(titles(wrapper)).toEqual(["Ask data", "Sales", "Finance"]);
    expect(wrapper.findAll(".insert-before, .insert-after, .dragging")).toHaveLength(0);
  });

  it("releasing in the blank space after the last card moves the card to the end", async () => {
    const wrapper = await mountManager();
    const { cards, zone } = layOut(wrapper);
    await cards[1].trigger("dragstart");
    await zone.trigger("dragover", { clientX: 900, clientY: 100 });
    expect(cards[2].classes()).toContain("insert-after");
    await zone.trigger("drop", { clientX: 900, clientY: 100 });
    await flushPromises();
    expect(mocks.saveAgentLineup).toHaveBeenCalledWith(["a", "b", "__qa__"]);
    expect(titles(wrapper)).toEqual(["Sales", "Finance", "Ask data"]);
  });

  it("releasing below the last row moves the card to the end even left of the last card", async () => {
    const wrapper = await mountManager();
    const { cards, zone } = layOut(wrapper);
    await cards[0].trigger("dragstart");
    await zone.trigger("dragover", { clientX: 450, clientY: 400 });
    expect(cards[2].classes()).toContain("insert-after");
    await zone.trigger("drop", { clientX: 450, clientY: 400 });
    await flushPromises();
    expect(mocks.saveAgentLineup).toHaveBeenCalledWith(["__qa__", "b", "a"]);
    expect(titles(wrapper)).toEqual(["Ask data", "Finance", "Sales"]);
  });

  it("in a wrapped grid it picks the row under the pointer before the column", async () => {
    const wrapper = await mountManager();
    const cards = wrapper.findAll(".agent-card");
    cards.forEach((card, index) => {
      const left = (index % 2) * 300;
      const top = Math.floor(index / 2) * 220;
      card.element.getBoundingClientRect = () =>
        ({ top, bottom: top + 200, left, right: left + 280 }) as DOMRect;
    });
    await cards[0].trigger("dragstart");
    await wrapper.find(".agents-container").trigger("drop", { clientX: 500, clientY: 300 });
    await flushPromises();
    expect(mocks.saveAgentLineup).toHaveBeenCalledWith(["__qa__", "b", "a"]);
  });

  it("a cancelled drag or an unchanged position keeps the order and sends nothing", async () => {
    const wrapper = await mountManager();
    const { cards, zone } = layOut(wrapper);
    await cards[1].trigger("dragstart");
    await zone.trigger("dragover", { clientX: 900, clientY: 100 });
    // Esc or releasing outside the card area: the browser ends the drag without a drop.
    await cards[1].trigger("dragend");
    expect(wrapper.findAll(".insert-before, .insert-after, .dragging")).toHaveLength(0);

    await cards[1].trigger("dragstart");
    await zone.trigger("dragover", { clientX: 320, clientY: 100 });
    expect(wrapper.findAll(".insert-before, .insert-after")).toHaveLength(0);
    await zone.trigger("drop", { clientX: 320, clientY: 100 });
    await flushPromises();
    expect(mocks.saveAgentLineup).not.toHaveBeenCalled();
    expect(titles(wrapper)).toEqual(["Sales", "Ask data", "Finance"]);
  });
});
