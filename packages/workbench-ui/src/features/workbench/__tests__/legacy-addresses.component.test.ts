import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { legacyAdminRoutes } from "../../../router/admin-routes";

/*
 * The old console addresses open the place the page moved to: the agents page on its agents or capability-library tab,
 * operations diagnosis for the observation addresses, and the plain workbench for the pages that no longer exist
 * (system configuration, feedback records). This mounts the workbench itself, because the redirect only survives if the
 * shell then opens the named feature.
 */
const i18n = workbenchI18n();

vi.mock("@ontomato/agent-shell-ui", () => ({
  AgentShell: {
    name: "AgentShell",
    props: ["featureId"],
    emits: ["update:featureId"],
    template: '<div class="shell"><slot name="feature" :feature-id="featureId" /></div>',
  },
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../../dashboard", () => ({ DashboardHome: { template: '<div class="dashboards" />' } }));
vi.mock("../../scheduled-tasks", () => ({ ScheduledTasksPage: { template: '<div class="scheduled" />' } }));
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
      { path: "/chat", component: { render: () => null } },
      ...Object.values(legacyAdminRoutes),
    ],
  });
  await router.push(path);
  const wrapper = mount(BusinessWorkbench, {
    props: {
      defaultLogo: "",
      defaultBrandName: "Ontomato",
      can: () => true,
    },
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

describe("old console addresses", () => {
  it("opens the agents tab for the business agents address", async () => {
    const { router, featureId } = await openAddress("/admin/analysis");
    expect(router.currentRoute.value.path).toBe("/chat");
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
      expect(router.currentRoute.value.path).toBe("/chat");
      expect(featureId).toBeNull();
    },
  );

  it("closes an open page when a retired address is opened inside the running workbench", async () => {
    const { router, wrapper } = await openAddress("/admin/skills");
    const shell = wrapper.findComponent({ name: "AgentShell" });
    expect(shell.props("featureId")).toBe("agents");
    await router.push("/admin/system-config");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(shell.props("featureId") ?? null).toBeNull();
  });
});
