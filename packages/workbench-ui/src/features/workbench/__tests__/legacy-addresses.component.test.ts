import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { legacyAdminRoutes, workbenchPages } from "@ontomato/platform-web";

/*
 * The old console addresses open the place the page moved to: the agents' settings are one page of the ontology manager
 * now, the capability library and the external MCP services are the platform's, operations diagnosis is the operations
 * application's, and the pages that no longer exist open the conversation. This mounts the workbench itself, because a
 * redirect only survives if the platform's own route table then serves the address it names.
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
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      ...workbenchPages(page, { component: page, props: { account: null } }),
      // The settings page and the pages the old addresses name, so a redirect is followed for real.
      ...["/ontology/agents", "/ontology/agents/new", "/ontology/agents/:agentId", "/ontology/skills"].map((path) => ({
        path, component: page,
      })),
      ...Object.values(legacyAdminRoutes),
    ],
  });
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
  return { router, wrapper, featureId: (shell.props("featureId") as string | null) ?? null };
}

describe("the agents' settings' old addresses", () => {
  /*
   * `/agents/settings/new` was an address of its own, not an agent id: it must land on the new-agent form, not on an
   * agent whose id happens to be "new". The check runs through the real route table, because a branch that reads
   * `route.params.agentId === "new"` would silently open the first agent instead.
   */
  it("turns the standalone builder's old addresses to the same settings page and keeps the object id", async () => {
    for (const [path, target] of [
      ["/agent-builder", "/ontology/agents"],
      ["/agent-builder/new", "/ontology/agents/new"],
      ["/agent-builder/agent-42", "/ontology/agents/agent-42"],
    ]) {
      const { router } = await openAddress(`${path}?draftSessionId=session`);
      expect(router.currentRoute.value.path).toBe(target);
      expect(router.currentRoute.value.query.draftSessionId).toBe("session");
      if (path.endsWith("agent-42")) expect(router.currentRoute.value.params.agentId).toBe("agent-42");
    }
  });

  it("turns the new-agent address to the one settings page's new agent", async () => {
    const { router } = await openAddress("/agents/settings/new");
    expect(router.currentRoute.value.name).toBe(platformRoutes.ontologyAgentNew.name);
    expect(router.currentRoute.value.path).toBe("/ontology/agents/new");
  });

  it("keeps the agent an old address named", async () => {
    const { router } = await openAddress("/agents/settings/agent-42");
    expect(router.currentRoute.value.name).toBe(platformRoutes.ontologyAgent.name);
    expect(router.currentRoute.value.params.agentId).toBe("agent-42");
  });

  it("turns the settings prefix to the settings page", async () => {
    const { router } = await openAddress("/agents/settings");
    expect(router.currentRoute.value.path).toBe("/ontology/agents");
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
