import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { workbenchI18n } from "../../../i18n";
import { workbenchContent } from "../../../content";
import CapabilityLibrary from "../components/CapabilityLibrary.vue";

/*
 * The capability library is one table: skills and external MCP services together, each row saying which kind it is,
 * where it comes from, which agents use it and whether it is available; the filter switches between the two kinds.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const skills = [
  { id: "trend-analysis", type: "knowledge", category: "analysis", title: "Trend analysis", tags: [], enabled: true, version: "1", isPublic: false, path: "", skill: { namespace: { kind: "domain", domainId: "sales" }, name: "trend-analysis" } },
  { id: "bar-chart", type: "executable", category: "visualization", title: "Bar chart", tags: [], enabled: true, version: "1", isPublic: true, path: "", skill: { namespace: { kind: "provider", provider: "platform" }, name: "bar-chart" } },
];

const services = [
  { id: "service-1", name: "Orders", url: "https://orders.example.test/mcp", headers: {} },
];

const agents = [
  {
    id: "agent-1",
    name: "Sales analyst",
    skills: [skills[0]!.skill],
    enabledMcpServiceIds: ["service-1"],
  },
] as unknown as AssistantAgentDefinition[];

const api = vi.hoisted(() => ({
  fetchSkills: vi.fn(),
  listMcpServices: vi.fn(),
  listPublishedMcpServices: vi.fn(),
  listExternalMcpTools: vi.fn(),
  agentList: vi.fn(),
}));

vi.mock("../../skills/api", () => ({
  skillsApi: {
    fetchSkills: api.fetchSkills,
    toggleSkill: vi.fn(),
    deleteSkill: vi.fn(),
    getReferences: vi.fn(),
    exportUrl: () => "#",
    importSkill: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
  },
}));
vi.mock("../../mcp/api", () => ({
  listMcpServices: api.listMcpServices,
  listPublishedMcpServices: api.listPublishedMcpServices,
  listExternalMcpTools: api.listExternalMcpTools,
  deleteMcpService: vi.fn(),
  saveMcpService: vi.fn(),
}));
vi.mock("../../agents/api", () => ({ agentDefinitionsApi: { list: api.agentList } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchSkills.mockResolvedValue({ success: true, skills });
  api.listMcpServices.mockResolvedValue(services);
  api.listPublishedMcpServices.mockResolvedValue([]);
  api.agentList.mockResolvedValue(agents);
  api.listExternalMcpTools.mockResolvedValue([{ name: "submit", description: "Submit an order" }]);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mountLibrary() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  await router.push("/");
  const wrapper = mount(CapabilityLibrary, { attachTo: document.body, global: { plugins: [i18n, ElementPlus, router] } });
  await flushPromises();
  const names = () => wrapper.findAll(".row-name").map((item) => item.text());
  return { wrapper, names };
}

describe("capability library", () => {
  it("lists skills and external tools in one table with kind, source and the agents that use them", async () => {
    const { wrapper, names } = await mountLibrary();
    expect(names()).toEqual(["Trend analysis", "Bar chart", "Orders"]);
    const rows = wrapper.findAll(".el-table__row");
    expect(rows[0]!.text()).toContain(t("capabilities.kindKnowledgeSkill"));
    expect(rows[0]!.text()).toContain(t("capabilities.sourceDomain"));
    expect(rows[0]!.text()).toContain("Sales analyst");
    expect(rows[1]!.text()).toContain(t("capabilities.sourcePublic"));
    expect(rows[1]!.text()).toContain(t("capabilities.unused"));
    expect(rows[2]!.text()).toContain(t("capabilities.kindTool"));
    expect(rows[2]!.text()).toContain(t("capabilities.sourceService"));
    wrapper.unmount();
  });

  it("filters by kind: all, skills, external tools", async () => {
    const { wrapper, names } = await mountLibrary();
    const choose = async (label: string) => {
      const select = wrapper.findComponent({ name: "ElSelect" });
      const option = select.findAllComponents({ name: "ElOption" }).find(item => item.props("label") === label)!;
      select.vm.$emit("update:modelValue", option.props("value"));
      await flushPromises();
    };
    await choose(t("capabilities.skills"));
    expect(names()).toEqual(["Trend analysis", "Bar chart"]);
    await choose(t("capabilities.tools"));
    expect(names()).toEqual(["Orders"]);
    await choose(t("common.all"));
    expect(names()).toHaveLength(3);
    wrapper.unmount();
  });

  it("checks a tool's connection in place and keeps the discovered tools with that row", async () => {
    const { wrapper } = await mountLibrary();
    const button = wrapper.findAll("button").find((item) => item.text() === t("capabilities.check"))!;
    await button.trigger("click");
    await flushPromises();
    expect(api.listExternalMcpTools).toHaveBeenCalledWith("service-1");
    expect(wrapper.text()).toContain("Submit an order");
    wrapper.unmount();
  });

  it("shows the platform's published services read-only, with the localized title and the connection hint", async () => {
    api.listPublishedMcpServices.mockResolvedValue([
      { name: workbenchContent().analysisMcpServerName, mcpUrl: "http://localhost/mcp/analysis-agents", tools: [] },
      { name: workbenchContent().opsMcpServerName, title: "Ontomato Ops Agent MCP", mcpUrl: "http://localhost/mcp/ops-agent", tools: [{ name: "send", description: "Send a message" }] },
    ]);
    const { wrapper } = await mountLibrary();
    const cards = wrapper.findAll(".published-card");
    expect(cards.map((card) => card.find("h4").text())).toEqual([t("mcp.agentService"), t("mcp.opsAgentService")]);
    expect(cards[0]!.find(".published-address").text()).toBe("http://localhost/mcp/analysis-agents");
    expect(cards[0]!.find("summary").text()).toBe(`${t("mcp.availableTools")} · 0`);
    expect(cards[1]!.find("summary").text()).toBe(`${t("mcp.availableTools")} · 1`);
    // Published services are shown, not edited: their rows have no delete action.
    expect(cards[1]!.find("button").exists()).toBe(false);
    wrapper.unmount();
  });
});
