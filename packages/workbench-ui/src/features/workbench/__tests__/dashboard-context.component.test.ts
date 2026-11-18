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
  const { assistantHostDouble } = await import("./shell");
  return {
    createAssistantClient: () => assistantHostDouble({ agents }),
    createAssistantFeedback: () => undefined,
    createPanelOperationSettings: () => undefined,
  };
});
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
        // The assembly's registry, as the dashboards application registers itself: one page, at its own address.
        [pilotPageKey as symbol]: () => (address: string): PilotPage | null =>
          address.startsWith("/dashboards") ? { id: "dashboards", component: { render: () => null } } : null,
      },
    },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return displayOf(wrapper);
}

describe("the board's page context", () => {
  it("carries the board and the card chosen in it, each with the id the page's skill reads", async () => {
    // The address the conversation carries is the page's selection: the board, and the card chosen in it with its name.
    const page = "/dashboards?dashboardId=board-a&dashboardName=Sales&cardId=card-1&cardName=Revenue%20by%20region";
    const display = await openBoard(page);
    expect(display.pageContext.value).toMatchObject({
      url: page,
      label: "Dashboards",
      selection: [
        { kind: "dashboard", id: "board-a", label: "Sales (board-a)" },
        { kind: "dashboard-card", id: "card-1", label: "Revenue by region (card-1)" },
      ],
    });
  });

  it("carries the board alone when the address names no card", async () => {
    const display = await openBoard("/dashboards?dashboardId=board-a&dashboardName=Sales");
    expect(display.pageContext.value).toMatchObject({ selection: [{ kind: "dashboard", id: "board-a", label: "Sales (board-a)" }] });
  });
});
