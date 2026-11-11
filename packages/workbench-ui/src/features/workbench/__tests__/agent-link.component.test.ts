import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";

/*
 * The platform home's agent cards open `/agents/chat?agentId=<id>`: that agent, on an empty new conversation, chosen over
 * the remembered one. The contract lives between two packages, so it is checked here, on the page that reads it.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [
  { id: "11111111-1111-4111-8111-111111111111", name: "Sales", description: "", icon: null, enabled: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "Retired", description: "", icon: null, enabled: false },
]);
const [sales, retired] = agents;

vi.mock("@ontomato/agent-shell-ui", () => ({
  AgentShell: { name: "AgentShell", props: ["agentId", "sessionId", "featureId"], template: "<div />" },
  ShellNavBody: { name: "ShellNavBody", template: "<div />" },
  ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
  useAgentNav: (options: { setSessionId(id: string | null): void; onLeaveConversation(): void }) => ({
    agents: { value: agents },
    loadAgents: async () => {},
    loadSessions: async () => {},
    startNew: () => {
      options.setSessionId(null);
      options.onLeaveConversation();
    },
  }),
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({ createAssistantClient: () => ({}), createAssistantFeedback: () => ({}) }));
vi.mock("../components/ConversationActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openChat(query: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ ...platformRoutes.chat, component: { render: () => null } }],
  });
  await router.push({ path: platformRoutes.chat.path, query });
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: { plugins: [i18n, ElementPlus, router], provide: { [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell: wrapper.findComponent({ name: "AgentShell" }) };
}

describe("a link to one agent", () => {
  it("selects that agent over the remembered one, on a new conversation, and leaves the address", async () => {
    localStorage.setItem("ontomato.workbench.agent", retired!.id);
    const { router, shell } = await openChat({ agentId: sales!.id, sessionId: "old-session" });
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reports an agent that is not available and does not choose another in its place", async () => {
    const error = vi.spyOn(ElMessage, "error");
    const { router, shell } = await openChat({ agentId: retired!.id });
    expect(error).toHaveBeenCalledWith(i18n.global.t("assistant.agentUnavailable"));
    expect(shell.props("agentId")).toBe(retired!.id);
    expect(router.currentRoute.value.query).toEqual({});
  });
});
