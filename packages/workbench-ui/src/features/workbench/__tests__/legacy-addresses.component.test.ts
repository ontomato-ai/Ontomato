import type { ConversationDisplay } from "@ontomato/agent-shell-ui";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { legacyAdminRoutes, workbenchPages } from "@ontomato/platform-web";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../platform-web/src/detail-selection";

/*
 * The old console addresses open the place the page moved to: the agents' settings are the agent platform's own page (and
 * the ontology manager's), the capability library and the external MCP services are the platform's, operations diagnosis is the operations
 * application's, and the pages that no longer exist open the conversation. This mounts the workbench itself, because a
 * redirect only survives if the platform's own route table then serves the address it names.
 */
const i18n = workbenchI18n();

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  // The settings editor reads the real agent avatars; the shell's own parts are doubled.
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: {
    name: "AgentShell",
    props: ["display"],
    template: '<div class="shell"><slot name="feature" :feature-id="display.page.value?.featureId ?? null" /></div>',
  },
  // The shell draws the column and the conversation; this test only reads the address the platform lands on.
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
  }),
  useSessionRunFeed: () => {},
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../../dashboard", () => ({ DashboardHome: { template: '<div class="dashboards" />' } }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () => ({}),
  createAssistantFeedback: () => ({}),
  createPanelOperationSettings: () => ({ read: async () => null }),
}));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

/** The platform's own route table, with the workbench on its own addresses and every page needing no real component. */
function platformRouter(): Router {
  const page = { render: () => null };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...workbenchPages(page, { component: page, props: { account: null } }),
      // Stand-ins for the canonical entries the reader's catalogue admits.
      ...["/agents/settings", "/ontology/agents", "/ontology/skills", "/:unknown(.*)*"].map((path) => ({
        path, component: page,
      })),
      ...Object.values(legacyAdminRoutes),
    ],
  });
  router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));
  return router;
}

async function openAddress(
  path: string,
): Promise<{ router: Router; wrapper: ReturnType<typeof mount>; featureId: string | null }> {
  const router = platformRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        // The platform answers which of its pages the account may open; here, every one.
        [platformPageAccessKey as symbol]: () => true,
      },
    },
  });
  wrappers.push(wrapper);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shell = wrapper.findComponent({ name: "AgentShell" });
  return { router, wrapper, featureId: (shell.props("display") as ConversationDisplay).page.value?.featureId ?? null };
}

describe("the agent platform's settings addresses", () => {
  const selected = { className: AGENT_DEFINITION, primaryKey: "agent-42" };

  it.each([
    ["/agent-builder/new", { mode: "create" }],
    ["/agent-builder/agent-42", { mode: "edit", selected }],
    ["/agents/settings/new", { mode: "create" }],
    ["/agents/settings/agent-42", { mode: "edit", selected }],
  ])("opens %s on the settings panel with its state and draft", async (path, state) => {
    const { router } = await openAddress(`${path}?draftSessionId=session`);
    expect(router.currentRoute.value.path).toBe("/agents/settings");
    expect(router.currentRoute.value.query.draftSessionId).toBe("session");
    expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual(state);
  });

  it("opens the settings' own address from the standalone builder", async () => {
    const { router } = await openAddress("/agent-builder");
    expect(router.currentRoute.value.path).toBe("/agents/settings");
  });
});

describe("old console addresses", () => {
  it.each(["/admin/analysis", "/admin/system-agents"])("opens the agents' settings for %s", async (path) => {
    const { router } = await openAddress(path);
    expect(router.currentRoute.value.path).toBe("/ontology/agents");
  });

  it.each(["/admin/skills", "/admin/mcp-service"])("opens the platform's own library for %s", async (path) => {
    const { router } = await openAddress(path);
    expect(router.currentRoute.value.path).not.toBe("/agents/settings");
    expect(router.currentRoute.value.path).not.toBe("/agents/settings/skills");
  });

  it.each(["/admin/system-config", "/admin/feedback-records"])(
    "opens the plain workbench for %s, which has no new place",
    async (path) => {
      const { router, featureId } = await openAddress(path);
      expect(router.currentRoute.value.path).toBe("/agents/chat");
      expect(featureId).toBeNull();
    },
  );
});
