import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h } from "vue";
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
const EXISTING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EDITED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUERY = "draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json";

const server = vi.hoisted(() => ({
  agents: [] as AssistantAgentDefinition[], read: vi.fn(), record: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
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
    executionOptions: async () => ({ canSetExecutionUser: false, users: [] }),
    create: server.create,
    update: server.update,
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
const existing = { ...created, id: EXISTING, name: "Existing analyst" };
const edited = { ...created, id: EDITED, name: "Second analyst" };

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  server.read.mockReset();
  server.record.mockReset();
  server.create.mockReset();
  server.update.mockReset();
  document.body.innerHTML = "";
});

async function openAt(agents: AssistantAgentDefinition[], address: string, beside = false): Promise<{ wrapper: VueWrapper; router: Router }> {
  server.agents = agents;
  // The agents' list is one per page load; each case reads its own server's.
  await useAgentDefinitions().load();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.chat, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgents, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgentNew, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgent, component: { template: "<div />" } },
      { ...platformRoutes.agents, component: { template: "<div />" } },
      { ...platformRoutes.agentSettingsNew, component: { template: "<div />" } },
      { ...platformRoutes.agentSettings, component: { template: "<div />" } },
    ],
  });
  await router.push(beside ? { path: platformRoutes.chat.path, query: { page: address } } : address);
  await router.isReady();
  const navigate = (page: string) => { void router.replace({ query: { page } }); };
  const wrapper = mount(defineComponent({
    setup: () => () => h(AgentSettingsRoute, beside ? { address: router.currentRoute.value.query.page as string, navigate } : {}),
  }), {
    global: { plugins: [workbenchI18n(), ElementPlus, router], provide: { [platformPageAccessKey as symbol]: () => true } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

function openLink(agents: AssistantAgentDefinition[], draft: object, prefix: string) {
  server.read.mockResolvedValue(draft);
  return openAt(agents, `${prefix}/new?${QUERY}`);
}

async function save(wrapper: VueWrapper) {
  await wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!.trigger("click");
  await flushPromises();
}

function nameField(wrapper: VueWrapper) {
  return wrapper.get(".agent-editor input");
}

/*
 * One page under two prefixes: the agent platform's own (`/agents/settings`) and the ontology manager's
 * (`/ontology/agents`). Every move stays under the prefix the page was opened at.
 */
describe.each([platformRoutes.agents.path, platformRoutes.ontologyAgents.path])("the settings at %s", (prefix) => {
  describe("the agent settings page", () => {
    it("shows the missing-agent message at a deleted agent's address while other agents are listed", async () => {
      const { wrapper } = await openAt([existing], `${prefix}/` + CREATED);

      expect(wrapper.get(".agent-settings-page .empty").text()).toBe(t("agents.notFound"));
      expect(wrapper.find(".agent-editor").exists()).toBe(false);
      expect(wrapper.get(".agent-row").text()).toBe(existing.name);
    });

    it("shows the list's empty message when there is no agent and none is named", async () => {
      const { wrapper } = await openAt([], prefix);

      expect(wrapper.get(".agent-settings-page .empty").text()).toBe(t("agents.empty"));
      expect(wrapper.find(".agent-editor").exists()).toBe(false);
    });

    it.each([false, true])("opens the newly created agent after saving (beside a conversation: %s)", async (beside) => {
      server.create.mockResolvedValue(created);
      const { wrapper, router } = await openAt([existing], `${prefix}/new`, beside);

      await nameField(wrapper).setValue(created.name);
      await save(wrapper);

      const target = `${prefix}/` + CREATED;
      if (beside) {
        expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
        expect(router.currentRoute.value.query.page).toBe(target);
      } else {
        expect(router.currentRoute.value.fullPath).toBe(target);
      }
      expect((nameField(wrapper).element as HTMLInputElement).value).toBe(created.name);
      expect(wrapper.get(".agent-row[aria-current=page]").text()).toBe(created.name);
    });

    it("returns to the list after saving an existing agent", async () => {
      const renamed = { ...edited, name: "Renamed analyst" };
      server.update.mockResolvedValue(renamed);
      const { wrapper, router } = await openAt([existing, edited], `${prefix}/` + EDITED);

      await nameField(wrapper).setValue(renamed.name);
      await save(wrapper);

      expect(server.update).toHaveBeenCalledWith(EDITED, expect.objectContaining({ name: renamed.name }));
      expect(router.currentRoute.value.fullPath).toBe(prefix);
      expect((nameField(wrapper).element as HTMLInputElement).value).toBe(existing.name);
    });
  });

  describe("a create draft's link after its first save", () => {
    it("opens the created agent and records it once, after saving", async () => {
      server.create.mockImplementation(async (written: AssistantAgentInput) => ({ ...written, id: CREATED, executionUserId: null }));
      let agentWhenRecorded: AssistantAgentDefinition | null = null;
      server.record.mockImplementation(async () => { agentWhenRecorded = useAgentDefinitions().find(CREATED); });
      const { wrapper, router } = await openLink([existing], { pageKey: "agent-settings", operation: "agent.create", target: {}, form }, prefix);

      await save(wrapper);
      expect(server.create).toHaveBeenCalledTimes(1);
      expect(server.record.mock.calls).toEqual([["s", "r", "outputs/drafts/agent.page-draft.json", CREATED]]);
      expect(agentWhenRecorded).toMatchObject({ id: CREATED, name: created.name });
      expect(router.currentRoute.value.fullPath).toBe(`${prefix}/` + CREATED);
      expect((nameField(wrapper).element as HTMLInputElement).value).toBe(created.name);
    });

    it("opens the agent it created, as it is", async () => {
      const { wrapper, router } = await openLink([created], {
        pageKey: "agent-settings", operation: "agent.create", target: {}, form, created: { id: CREATED },
      }, prefix);

      // That agent's own page, the draft still named: compared there, it changes nothing, so nothing is drafted.
      expect(router.currentRoute.value.path).toBe(`${prefix}/${CREATED}`);
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
      const { wrapper, router } = await openLink([existing], {
        pageKey: "agent-settings", operation: "agent.create", target: {}, form, created: { id: CREATED },
      }, prefix);

      expect(router.currentRoute.value.path).toBe(`${prefix}/${CREATED}`);
      expect(router.currentRoute.value.query).toEqual(Object.fromEntries(new URLSearchParams(QUERY)));
      expect(wrapper.find(".agent-editor").exists()).toBe(false);
      expect(wrapper.get(".agent-settings-page .empty").text()).toBe(t("agents.notFound"));
      expect(server.create).not.toHaveBeenCalled();
    });
  });
});
