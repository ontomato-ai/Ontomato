import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import AgentsPage from "../components/AgentsPage.vue";

/*
 * The agents page is one entry with two tabs, each shown by its own capability codes: the agents list with
 * analysis-agent (the server guards the agent definitions with it), the capability library with skill-management or
 * mcp-service. A user with only one of them enters the single visible tab without a tab bar.
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

  it("lists only the business agents: the operations agent's model is the operations application's own page", async () => {
    const { wrapper } = await mountPage(["analysis-agent", "observer"]);
    // The list drew no row of its own: every row is an agent definition (the account has none here), and the built-in
    // operations agent has no row and no editor of its own any more — its model page belongs to operations.
    expect(wrapper.findAll(".agent-item")).toHaveLength(0);
    expect(wrapper.find(".system-avatar").exists()).toBe(false);
    expect(wrapper.find(".diagnosis-model").exists()).toBe(false);
  });

  it("opens the agents list when that is the only tab, and follows the address's tab", async () => {
    const { wrapper } = await mountPage(["analysis-agent"]);
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

    // A later address naming the other tab (an old link opened while the page is shown) switches to it.
    await requested.setProps({ initialTab: "agents" });
    await flushPromises();
    expect(requested.find(".el-tabs__item.is-active").text()).toBe(t("agents.agentsTab"));

    // An address naming no tab opens the first one.
    await requested.setProps({ initialTab: "capabilities" });
    await flushPromises();
    await requested.setProps({ initialTab: null });
    await flushPromises();
    expect(requested.find(".el-tabs__item.is-active").text()).toBe(t("agents.agentsTab"));
  });
});
