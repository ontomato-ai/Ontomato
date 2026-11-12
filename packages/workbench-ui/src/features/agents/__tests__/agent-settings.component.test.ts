import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { computed } from "vue";
import { agentModelLabelsKey, platformPageAccessKey, type AgentModelLabels } from "@ontomato/platform-shell";
import { workbenchI18n } from "../../../i18n";
import AgentSettingsNav from "../components/AgentSettingsNav.vue";
import AgentSettingsPage from "../components/AgentSettingsPage.vue";

/*
 * The agent settings have one list, in the application's column, and one editor, in the main area (DESIGN.md
 * "Applications and shells"). These mount the two halves apart from the shell that puts them side by side.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string) => string;

const AGENTS = [
  { id: "a1", name: "助理", description: "日常问数" },
  { id: "a2", name: "分析师", description: "调查分析" },
];

vi.mock("../api", () => ({
  agentDefinitionsApi: { list: async () => AGENTS },
  loadModelOptions: async () => ({ models: [], defaultModelId: null }),
  loadOntologyScope: async () => ({ classes: [], relations: [] }),
}));
// The editor has its own tests; here only the screen's shape matters.
vi.mock("../components/AgentEditor.vue", () => ({
  __esModule: true,
  default: {
    name: "AgentEditorDouble",
    props: { agent: Object },
    template: '<div class="editor-double">{{ agent ? agent.name : "new" }}</div>',
  },
}));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

type SettingsProps = { agentId: string | null; creating: boolean };

/** The platform's answers the column reads: which pages the account may open, and the model page's words. */
function platform(granted: readonly string[]) {
  return {
    [platformPageAccessKey as symbol]: (path: string) => granted.includes(path),
    [agentModelLabelsKey as symbol]: computed(() => ({ title: "Models" }) as AgentModelLabels),
  };
}

/** The agents' settings, which an account with the agents' permission may open. */
const AGENT_SETTINGS = "/agents/settings";

async function mountNav(props: SettingsProps, granted: readonly string[] = [AGENT_SETTINGS]) {
  const wrapper = mount(AgentSettingsNav, {
    props: { ...props, models: false },
    global: { plugins: [i18n, ElementPlus], provide: platform(granted) },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function mountPage(props: SettingsProps) {
  const wrapper = mount(AgentSettingsPage, { props, global: { plugins: [i18n, ElementPlus] }, attachTo: document.body });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const rowNames = (wrapper: ReturnType<typeof mount>) => wrapper.findAll(".agent-row .row-name").map((row) => row.text());

describe("the agent settings column", () => {
  it("holds the agents, the new-agent button and the way back", async () => {
    const wrapper = await mountNav({ agentId: "a2", creating: false });
    expect(wrapper.find(".back").text()).toBe(t("common.backToChat"));
    expect(rowNames(wrapper)).toEqual(["助理", "分析师"]);
    // Each agent carries its one-line description, and the open one is marked.
    expect(wrapper.findAll(".agent-row .row-note").map((row) => row.text())).toEqual(["日常问数", "调查分析"]);
    expect(wrapper.find(".agent-row.active .row-name").text()).toBe("分析师");
    expect(wrapper.find(".new-agent").exists()).toBe(true);
  });

  it("opens an agent, a new one, and goes back, all through the host", async () => {
    const wrapper = await mountNav({ agentId: "a1", creating: false });
    await wrapper.findAll(".agent-row")[1]!.trigger("click");
    await wrapper.find(".new-agent").trigger("click");
    await wrapper.find(".back").trigger("click");
    expect(wrapper.emitted("selectAgent")).toEqual([["a2"]]);
    expect(wrapper.emitted("createAgent")).toHaveLength(1);
    expect(wrapper.emitted("back")).toHaveLength(1);
  });

  it("lists the models at its foot only for an account that may open them", async () => {
    expect((await mountNav({ agentId: "a1", creating: false })).find(".nav-foot").exists()).toBe(false);
    const wrapper = await mountNav({ agentId: "a1", creating: false }, [AGENT_SETTINGS, "/agents/settings/models"]);
    await wrapper.find(".nav-foot .foot-row").trigger("click");
    expect(wrapper.find(".nav-foot").text()).toBe("Models");
    expect(wrapper.emitted("openModels")).toHaveLength(1);
  });

  it("lists neither the agents nor a new one to an account without the agents' permission", async () => {
    const wrapper = await mountNav({ agentId: null, creating: false }, ["/agents/settings/models"]);
    expect(wrapper.find(".agent-rows").exists()).toBe(false);
    expect(wrapper.find(".new-agent").exists()).toBe(false);
    expect(wrapper.find(".note").exists()).toBe(false);
    expect(wrapper.find(".nav-foot").text()).toBe("Models");
  });
});

describe("the agent settings page", () => {
  it("opens the agent the address names in the editor, with no list of its own", async () => {
    const wrapper = await mountPage({ agentId: "a2", creating: false });
    expect(wrapper.find(".editor-double").text()).toBe("分析师");
    // The list is the column's: nothing here repeats it.
    expect(wrapper.find(".agent-row").exists()).toBe(false);
  });

  it("opens the first agent when the address names none", async () => {
    const wrapper = await mountPage({ agentId: null, creating: false });
    expect(wrapper.find(".editor-double").text()).toBe("助理");
  });

  it("opens a new agent at its own address", async () => {
    const creating = await mountPage({ agentId: null, creating: true });
    expect(creating.find(".editor-double").text()).toBe("new");
  });
});
