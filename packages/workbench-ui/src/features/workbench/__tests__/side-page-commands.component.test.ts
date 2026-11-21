import { defineComponent, h, markRaw } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { RefreshCw } from "lucide-vue-next";
import { createAgentHostClient } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey, providePageActions, usePageActions, type PilotPage } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { displayOf } from "./shell";

/*
 * A page's commands are drawn wherever its title is (big main's ruling, 2026-11-21). Beside the conversation the title is
 * the conversation's page pane, so the page's refresh and named shortcuts are there: the narrow strip keeps the icon tool
 * and puts the rest under "More"; shown full in the conversation application they stand in a row. They are the page's,
 * handed over as it hands them to the platform's header, and they never reach the header of the conversation's own page.
 */
const i18n = workbenchI18n();
const assistant = { id: "11111111-1111-4111-8111-111111111111", name: "Assistant", description: "", icon: null, enabled: true, effectiveSkills: [] };

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  useSessionRunFeed: () => {},
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () => createAgentHostClient({
    request: async (path) => new Response(JSON.stringify(path.includes("/sessions")
      ? { sessions: [], nextCursor: null }
      : { agents: [assistant] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  }),
  createAssistantFeedback: () => undefined,
  createPanelOperationSettings: () => undefined,
}));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("draws the page's refresh and named shortcuts where the conversation draws its title, and only there", async () => {
  const refresh = vi.fn();
  const approveAll = vi.fn();
  // A panel page as the host hands over its commands: the host's refresh, then the panel's named shortcut.
  const PanelDouble = defineComponent({
    setup() {
      usePageActions(() => ({
        actions: [
          { id: "refresh", label: "Refresh", icon: markRaw(RefreshCw), iconOnly: true, onClick: refresh },
          { id: "approveAll", label: "Approve all", onClick: approveAll },
        ],
      }));
      return () => h("div", { class: "panel-double" });
    },
  });
  // The platform's layout around the conversation: what reaches its header is the conversation page's own, not the page's.
  let platformHeader: ReturnType<typeof providePageActions> | undefined;
  const Layout = defineComponent({
    setup() {
      platformHeader = providePageActions();
      return () => h(BusinessWorkbench, { defaultLogo: "", defaultBrandName: "Ontomato" });
    },
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.chat, component: { render: () => null } },
      { path: "/applications/:app/:page", component: { render: () => null } },
    ],
  });
  await router.push({ path: platformRoutes.chat.path, query: { page: "/applications/knowledge/review" } });
  await router.isReady();
  const wrapper = mount(Layout, {
    attachTo: document.body,
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        [platformPageAccessKey as symbol]: () => true,
        [pilotPageKey as symbol]: () => (address: string): PilotPage | null =>
          address.startsWith("/applications/")
            ? { id: "panel-application", component: PanelDouble, instance: address.split("?")[0]!, props: {} }
            : null,
      },
    },
  });
  wrappers.push(wrapper);
  await settle();

  // Opened by its address with no conversation yet, the page is shown full: its commands stand in a row by its title.
  const header = () => wrapper.find(".page-pane .pane-header");
  expect(displayOf(wrapper).view.value).toBe("full");
  expect(header().find('button[aria-label="Refresh"]').exists()).toBe(true);
  expect(header().text()).toContain("Approve all");
  expect(header().find('button[aria-label="More"]').exists()).toBe(false);
  // They are the page's own: nothing reaches the header of the conversation's own page.
  expect(platformHeader!.value).toBeNull();

  // Beside the conversation the strip is narrow: the refresh tool stays, the shortcut is under "More", both still work.
  await displayOf(wrapper).setView("side");
  await settle();
  expect(header().find('button[aria-label="Refresh"]').exists()).toBe(true);
  expect(header().find(".page-commands").text()).not.toContain("Approve all");
  await header().find('button[aria-label="Refresh"]').trigger("click");
  expect(refresh).toHaveBeenCalledOnce();
  await header().find('button[aria-label="More"]').trigger("click");
  await settle();
  const item = [...document.querySelectorAll(".el-dropdown-menu__item")].find((node) => node.textContent?.trim() === "Approve all");
  expect(item).toBeDefined();
  (item as HTMLElement).click();
  expect(approveAll).toHaveBeenCalledOnce();
  expect(platformHeader!.value).toBeNull();

  // The page closed: its commands go with it.
  await displayOf(wrapper).close();
  await settle();
  expect(wrapper.find(".page-commands").exists()).toBe(false);
});
