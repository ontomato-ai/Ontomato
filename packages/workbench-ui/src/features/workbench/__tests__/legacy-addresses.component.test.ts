import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { legacyAdminRoutes } from "@ontomato/platform-web";

/*
 * The old console addresses open the place the page moved to: the agents page on its agents or capability-library tab,
 * operations diagnosis for the observation addresses, and the plain workbench for the pages that no longer exist
 * (system configuration, feedback records). This mounts the workbench itself, because the redirect only survives if the
 * shell then opens the named feature.
 */
const i18n = workbenchI18n();

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  // The settings editor reads the real agent avatars; the shell's own parts are doubled.
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: {
    name: "AgentShell",
    props: ["featureId"],
    emits: ["update:featureId"],
    template: '<div class="shell"><slot name="feature" :feature-id="featureId" /></div>',
  },
  // The shell draws the column and the conversation; this test only reads the page the workbench opens.
  ShellNavBody: { name: "ShellNavBody", template: "<div />" },
  ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
  useAgentNav: () => ({
    agents: { value: [] },
    sessions: { value: [] },
    sessionsState: { value: "ready" },
    nextCursor: { value: null },
    currentAgent: { value: null },
    loadAgents: async () => {},
    loadSessions: async () => {},
    startNew: () => {},
    selectSession: () => {},
    removeSession: async () => {},
    promoteSession: () => {},
    markRun: () => {},
    runStatus: () => null,
  }),
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../../dashboard", () => ({ DashboardHome: { template: '<div class="dashboards" />' } }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () => ({}),
  createAssistantFeedback: () => ({}),
}));
vi.mock("../components/ConversationActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../dashboard/stores/dashboard", () => ({ useDashboardStore: () => ({ selectDashboard: async () => {} }) }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function openAddress(
  path: string,
): Promise<{ router: Router; wrapper: ReturnType<typeof mount>; featureId: string | null; html: string }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      /*
       * Every address the settings have, with their real names: the workbench tells the editor from an agent's page by
       * the route it is on, so a route with a missing name would open the wrong screen.
       */
      ...[
        platformRoutes.chat,
        platformRoutes.agents,
        platformRoutes.agentSettingsNew,
        platformRoutes.agentSettingsCapabilities,
        platformRoutes.agentSettings,
      ].map((route) => ({ ...route, component: { render: () => null } })),
      ...Object.values(legacyAdminRoutes),
    ],
  });
  await router.push(path);
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: { [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess },
    },
  });
  wrappers.push(wrapper);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shell = wrapper.findComponent({ name: "AgentShell" });
  return { router, wrapper, featureId: (shell.props("featureId") as string | null) ?? null, html: wrapper.html() };
}

describe("the agent settings' addresses", () => {
  /*
   * `/agents/settings/new` is an address of its own, not an agent id: the editor must open the new-agent form. The
   * check runs through the real route table, because a branch that reads `route.params.agentId === "new"` is always
   * false here and would silently open the first agent instead.
   */
  it("opens the new-agent form at /agents/settings/new", async () => {
    const { router, wrapper } = await openAddress("/agents/settings/new");
    expect(router.currentRoute.value.path).toBe("/agents/settings/new");
    const page = wrapper.findComponent({ name: "AgentSettingsPage" });
    expect(page.props("creating")).toBe(true);
    expect(page.props("agentId")).toBeNull();
  });

  it("opens one agent's editor at /agents/settings/<id>", async () => {
    const { wrapper } = await openAddress("/agents/settings/agent-42");
    const page = wrapper.findComponent({ name: "AgentSettingsPage" });
    expect(page.props("creating")).toBe(false);
    expect(page.props("agentId")).toBe("agent-42");
  });
});

describe("old console addresses", () => {
  it("opens the agents tab for the business agents address", async () => {
    const { router, featureId } = await openAddress("/admin/analysis");
    expect(router.currentRoute.value.path).toBe("/agents/settings");
    expect(featureId).toBe("agents");
  });

  it("opens the agents tab for the system agents address", async () => {
    expect((await openAddress("/admin/system-agents")).featureId).toBe("agents");
  });

  it.each(["/admin/skills", "/admin/mcp-service"])("opens the capability library for %s", async (path) => {
    const { featureId } = await openAddress(path);
    expect(featureId).toBe("agents");
  });

  it.each(["/admin/system-config", "/admin/feedback-records"])(
    "opens the plain workbench for %s, which has no new place",
    async (path) => {
      const { router, featureId } = await openAddress(path);
      expect(router.currentRoute.value.path).toBe("/agents/chat");
      expect(featureId).toBeNull();
    },
  );

  it("closes an open page when a retired address is opened inside the running workbench", async () => {
    const { router, wrapper } = await openAddress("/admin/skills");
    const shell = wrapper.findComponent({ name: "AgentShell" });
    expect(shell.props("featureId")).toBe("agents");
    await router.push("/admin/system-config");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value.path).toBe("/agents/chat");
    expect(shell.props("featureId") ?? null).toBeNull();
  });
});
