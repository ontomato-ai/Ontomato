import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { pilotPageKey, platformPageAccessKey, type PilotPage } from "@ontomato/platform-shell";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { clearDashboardSelection, setDashboardSelection } from "../../dashboard";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";

/*
 * The board beside a conversation is a page, and what its reader chose in it rides on the message: the page context the
 * conversation sends carries the board and the chosen card. The dashboard reports that selection, so the page reads it
 * here; what the board draws is the dashboard's own tests.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [{ id: "11111111-1111-4111-8111-111111111111", name: "Sales", description: "", icon: null, enabled: true }]);

vi.mock("@ontomato/agent-shell-ui", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId", "featureId", "pageContext"],
      setup(_props, { expose }) {
        expose({ reloadAgents: async () => {}, send: async () => {} });
        return () => h("div");
      },
    }),
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
      selectSession: (id: string) => {
        options.setSessionId(id);
        options.onLeaveConversation();
      },
    }),
    useSessionRunFeed: () => {},
  };
});
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({ createAssistantClient: () => ({}), createAssistantFeedback: () => ({}) }));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));
// The board's own drawing is another line's: the page beside the chat receives it, and this reads what it reports.
vi.mock("../../dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../dashboard")>()),
  DashboardHome: { name: "DashboardHome", template: "<div />" },
}));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  clearDashboardSelection();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function openBoard() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ ...platformRoutes.chat, component: { render: () => null } }, { path: "/dashboards", component: { render: () => null } }],
  });
  await router.push({ path: platformRoutes.chat.path, query: { page: "/dashboards?dashboardId=board-a" } });
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        [platformPageAccessKey as symbol]: () => true,
        // The assembly's registry, as the dashboards application registers itself: one page, at its own address.
        [pilotPageKey as symbol]: () => (address: string): PilotPage | null =>
          address.startsWith("/dashboards") ? { id: "dashboards", component: { render: () => null } } : null,
      },
    },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return wrapper.findComponent({ name: "AgentShell" });
}

describe("the board's page context", () => {
  it("carries the board and the card chosen in it, so the message asks about that card", async () => {
    const shell = await openBoard();
    expect(shell.props("pageContext")).toMatchObject({ pageKey: "dashboard", url: "/dashboards?dashboardId=board-a", selection: [] });

    setDashboardSelection({ id: "board-a", name: "Sales" }, { id: "card-1", name: "Revenue by region", kind: "chart" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shell.props("pageContext")).toMatchObject({
      selection: [
        { kind: "dashboard", id: "board-a", label: "Sales" },
        { kind: "dashboard-card-chart", id: "card-1", label: "Revenue by region" },
      ],
    });
  });

  it("carries the board alone when no card is chosen", async () => {
    const shell = await openBoard();
    setDashboardSelection({ id: "board-a", name: "Sales" }, { id: "card-1", name: "Revenue by region", kind: "metric" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearDashboardSelection();
    setDashboardSelection({ id: "board-a", name: "Sales" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shell.props("pageContext")).toMatchObject({ selection: [{ kind: "dashboard", id: "board-a", label: "Sales" }] });
  });
});
