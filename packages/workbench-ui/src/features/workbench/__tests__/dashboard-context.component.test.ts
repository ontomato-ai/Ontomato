import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { pilotPageKey, platformPageAccessKey, type PilotPage } from "@ontomato/platform-shell";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";

import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { displayOf } from "./shell";

/*
 * The board beside a conversation is a page, and what its reader chose in it rides on the message: the page context the
 * conversation sends carries the board and the chosen card. The dashboard reports that selection, so the page reads it
 * here; what the board draws is the dashboard's own tests.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [{ id: "11111111-1111-4111-8111-111111111111", name: "Sales", description: "", icon: null, enabled: true }]);

// The shell is the real one; only the list notice stream, which needs a live host, stays out.
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  useSessionRunFeed: () => {},
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", async () => {
  const { assistantHostDouble } = await import("./host-double");
  return {
    createAssistantClient: () => assistantHostDouble({ agents }),
    createAssistantFeedback: () => undefined,
    createPanelOperationSettings: () => undefined,
  };
});
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));
// The board's own drawing is now the builtin dashboards panel; this test verifies panel-application context forwarding.
vi.mock("../../dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../dashboard")>()),
}));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function openBoard(page: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ ...platformRoutes.chat, component: { render: () => null } }, { path: "/dashboards", component: { render: () => null } }],
  });
  await router.push({ path: platformRoutes.chat.path, query: { page } });
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        [platformPageAccessKey as symbol]: () => true,
        // Dashboards are now resolved as a panel-application entry at `/dashboards`.
        [pilotPageKey as symbol]: () => (address: string): PilotPage | null =>
          address.startsWith("/dashboards") ? { id: "panel-application", component: { render: () => null } } : null,
      },
    },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return displayOf(wrapper);
}

describe("the board's page context", () => {
  it("forwards the panel-reported dashboard label and selection beside a conversation", async () => {
    const page = "/dashboards?dashboardId=board-a&cardId=card-1";
    const display = await openBoard(page);
    display.context({
      url: page,
      label: "Dashboards",
      selection: [
        { kind: "platform:Dashboard", id: "board-a", label: "Sales" },
        { kind: "platform:DashboardCard", id: "board-a/card-1", label: "Revenue by region" },
      ],
    });
    expect(display.pageContext.value).toMatchObject({
      url: page,
      label: "Dashboards",
      selection: [
        { kind: "platform:Dashboard", id: "board-a", label: "Sales" },
        { kind: "platform:DashboardCard", id: "board-a/card-1", label: "Revenue by region" },
      ],
    });
  });

  it("carries the board alone when the panel reports no card selection", async () => {
    const page = "/dashboards?dashboardId=board-a";
    const display = await openBoard(page);
    display.context({
      url: page,
      label: "Dashboards",
      selection: [{ kind: "platform:Dashboard", id: "board-a", label: "Sales" }],
    });
    expect(display.pageContext.value).toMatchObject({
      selection: [{ kind: "platform:Dashboard", id: "board-a", label: "Sales" }],
    });
  });
});
