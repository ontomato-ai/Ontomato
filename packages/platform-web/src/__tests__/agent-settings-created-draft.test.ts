import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { AssistantAgentDefinition, AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";
import { useAgentDefinitions } from "@ontomato/workbench-ui/features/agents";
import AgentSettingsRoute from "../pages/AgentSettingsRoute.vue";

/*
 * A create draft's link once its first save created the agent: the real settings page at its own address, its list and
 * its editor, with only the server's answers doubled. The link names the new-agent page; the draft names the agent its
 * save created, so the page opens that agent and, unchanged, shows it as it is. An agent since deleted is the page's
 * missing agent, never a new agent's form filled again.
 */
const CREATED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const QUERY = "draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json";

const server = vi.hoisted(() => ({ agents: [] as AssistantAgentDefinition[], read: vi.fn(), record: vi.fn(), create: vi.fn() }));
vi.mock("../../../workbench-ui/src/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ readPageDraft: server.read, recordPageDraftCreated: server.record }),
}));
vi.mock("../../../workbench-ui/src/features/agents/components/SkillSelector.vue", () => ({
  default: defineComponent({ name: "SkillSelector", emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" }),
}));
vi.mock("@ontomato/foundation-ui/code", () => ({ CodeEditor: defineComponent({ name: "CodeEditor", template: "<div />" }) }));
vi.mock("../../../workbench-ui/src/features/agents/api", () => ({
  agentDefinitionsApi: {
    list: async () => server.agents,
    skills: async () => [],
    listMcpServiceOptions: async () => [],
    executionOptions: async () => ({ canSetExecutionUser: true, users: [] }),
    create: server.create,
  },
  loadModelOptions: async () => ({ models: [], defaultModelId: null, embeddingModelId: null }),
  loadOntologyScope: async () => ({ classes: [], relations: [] }),
}));

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en }, elementLocale: () => elementEn,
});
const t = workbenchI18n().global.t as (key: string) => string;

const form: AssistantAgentInput = {
  name: "New analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
  modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 0,
};
/** The agent the draft's first save created, as the owner stores it. */
const created: AssistantAgentDefinition = { ...form, skills: [], id: CREATED, executionUserId: null };

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  server.read.mockReset();
  server.record.mockReset();
  server.create.mockReset();
  document.body.innerHTML = "";
});

/** The settings page at its own address, the agents the server lists, and the draft the link names. */
async function openLink(agents: AssistantAgentDefinition[], draft: object): Promise<{ wrapper: VueWrapper; router: Router }> {
  server.agents = agents;
  server.read.mockResolvedValue(draft);
  // The agents' list is one per page load; each case reads its own server's.
  await useAgentDefinitions().load();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.ontologyAgents, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgentNew, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgent, component: { template: "<div />" } },
    ],
  });
  await router.push(`${platformRoutes.ontologyAgentNew.path}?${QUERY}`);
  await router.isReady();
  const wrapper = mount(AgentSettingsRoute, {
    global: { plugins: [workbenchI18n(), ElementPlus, router], provide: { [platformPageAccessKey as symbol]: () => true } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

describe("a create draft's link after its first save", () => {
  it("records the agent the first save created", async () => {
    server.create.mockImplementation(async (written: AssistantAgentInput) => ({ ...written, id: CREATED, executionUserId: null }));
    const { wrapper } = await openLink([], { pageKey: "agent-settings", operation: "agent.create", target: {}, form });

    await wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!.trigger("click");
    await flushPromises();
    expect(server.create).toHaveBeenCalledTimes(1);
    expect(server.record.mock.calls).toEqual([["s", "r", "outputs/drafts/agent.page-draft.json", CREATED]]);
  });

  it("opens the agent it created, as it is", async () => {
    const { wrapper, router } = await openLink([created], {
      pageKey: "agent-settings", operation: "agent.create", target: {}, form, created: { id: CREATED },
    });

    // That agent's own page, the draft still named: compared there, it changes nothing, so nothing is drafted.
    expect(router.currentRoute.value.path).toBe(`${platformRoutes.ontologyAgents.path}/${CREATED}`);
    expect(router.currentRoute.value.query).toEqual(Object.fromEntries(new URLSearchParams(QUERY)));
    expect((wrapper.find(".agent-editor input").element as HTMLInputElement).value).toBe("New analyst");
    expect(wrapper.find(".draft-changed").exists()).toBe(false);
    expect(wrapper.find(".platform-page-header .unsaved").exists()).toBe(false);
    // Read there as an update of the agent shown, the draft is this page's, not one for another agent.
    expect(server.read).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".el-message--error")).toBeNull();
    expect(server.create).not.toHaveBeenCalled();
    expect(server.record).not.toHaveBeenCalled();
  });

  it("reports an agent since deleted as missing, never a new agent's form again", async () => {
    const { wrapper, router } = await openLink([], {
      pageKey: "agent-settings", operation: "agent.create", target: {}, form, created: { id: CREATED },
    });

    expect(router.currentRoute.value.path).toBe(`${platformRoutes.ontologyAgents.path}/${CREATED}`);
    expect(router.currentRoute.value.query).toEqual(Object.fromEntries(new URLSearchParams(QUERY)));
    expect(wrapper.find(".agent-editor").exists()).toBe(false);
    expect(wrapper.find(".agent-settings-page .empty").text()).toBe(t("agents.empty"));
    expect(server.create).not.toHaveBeenCalled();
  });
});
