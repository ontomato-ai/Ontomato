import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import AgentsPage from "../components/AgentsPage.vue";

/*
 * The agents page is one entry with two tabs, each shown by its own capability codes: the agents list with
 * analysis-agent or observer, the capability library with skill-management or mcp-service. A user with only one of them
 * enters the single visible tab without a tab bar.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string) => string;

vi.mock("../api", () => ({
  agentDefinitionsApi: {
    list: async () => [],
    listMcpServiceOptions: async () => [],
  },
  loadModelOptions: async () => ({ models: [], defaultModelId: null }),
  loadOntologyScope: async () => ({ classes: [], relations: [] }),
}));
vi.mock("../../skills/api", () => ({ skillsApi: { fetchSkills: async () => ({ success: true, skills: [] }) } }));
vi.mock("../../mcp/api", () => ({
  listMcpServices: async () => [],
  listPublishedMcpServices: async () => [],
  listExternalMcpTools: async () => [],
}));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function mountPage(granted: string[]) {
  const wrapper = mount(AgentsPage, {
    props: { can: (permission: string) => granted.includes(permission) },
    global: { plugins: [i18n, ElementPlus] },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return {
    wrapper,
    tabs: wrapper.findAll(".el-tabs__item").map((item) => item.text()),
    active: wrapper.find(".el-tabs__item.is-active").exists() ? wrapper.find(".el-tabs__item.is-active").text() : "",
  };
}

describe("agents page tabs", () => {
  it("shows both tabs with the codes of both", async () => {
    const { tabs } = await mountPage(["analysis-agent", "skill-management"]);
    expect(tabs).toEqual([t("agents.agentsTab"), t("agents.capabilityLibrary")]);
  });

  it("opens the capability library when it is the only tab the user has", async () => {
    const { tabs, active, wrapper } = await mountPage(["mcp-service"]);
    expect(tabs).toEqual([]);
    expect(active).toBe("");
    expect(wrapper.find(".capability-library").exists()).toBe(true);
  });

  it("opens the agents list when only observer applies, and links it to the address's tab", async () => {
    const { wrapper } = await mountPage(["observer"]);
    expect(wrapper.find(".agent-settings").exists()).toBe(true);

    const requested = mount(AgentsPage, {
      props: {
        can: (permission: string) => ["analysis-agent", "skill-management"].includes(permission),
        initialTab: "capabilities",
      },
      global: { plugins: [i18n, ElementPlus] },
      attachTo: document.body,
    });
    wrappers.push(requested);
    await flushPromises();
    expect(requested.find(".el-tabs__item.is-active").text()).toBe(t("agents.capabilityLibrary"));
  });
});
