import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { GOVERNANCE_REPORT_PAGE_SKILL } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import GovernanceReportRoute from "../pages/GovernanceReportRoute.vue";

/*
 * A governance record's report opens at its own address with the platform's composer at its foot. The report has a page
 * skill of its own — the governance preset the platform maps to `governance-report` — so its composer offers the agents
 * carrying it and starts from the one the mapping names, not from every agent with the remembered one selected.
 *
 * The report's own drawing belongs to the governance line; this holds what its address hands the composer.
 */
vi.mock("@ontomato/ontology-manager", () => ({
  GovernancePage: defineComponent({
    name: "GovernancePageDouble",
    props: { recordId: String, issueId: String, paired: Boolean },
    setup: (props) => () => h("div", { class: "report-page" }, `${props.paired ? "beside" : "own"} ${props.recordId}`),
  }),
}));

const governanceAgent = {
  id: "11111111-1111-4111-8111-111111111111", name: "Knowledge governance", description: "", icon: null, enabled: true,
};
const composerQueries: unknown[] = [];
const pageAgents = vi.fn(async () => ({
  agents: [governanceAgent, { ...governanceAgent, id: "22222222-2222-4222-8222-222222222222", name: "Assistant" }],
  defaultAgentId: governanceAgent.id,
}));

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: {} }, elementLocale: () => elementEn,
  });
});

async function open() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ ...platformRoutes.governance, component: { template: "<div />" } }],
  });
  await router.push("/governance/reports/record-1");
  await router.isReady();
  const wrapper = mount(GovernanceReportRoute, {
    props: { recordId: "record-1" },
    global: {
      plugins: [workbenchI18n(), ElementPlus, router],
      provide: {
        [pageCounterKey as symbol]: {
          agents: async () => [],
          pageAgents: (page: unknown) => {
            composerQueries.push(page);
            return pageAgents();
          },
          preferredAgentId: ref<string | null>("remembered"),
          ask: () => {},
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("the report's own composer at its address", () => {
  it("reads the page's own skill, the same one the conversation beside it reads", async () => {
    const wrapper = await open();

    // The declaration is the page's feature's own: one place decides which agents a report is written with.
    expect(composerQueries).toEqual([GOVERNANCE_REPORT_PAGE_SKILL]);
    expect(GOVERNANCE_REPORT_PAGE_SKILL).toEqual({ pageKey: "governance-report", permissionCode: "business-knowledge" });
    wrapper.unmount();
  });

  it("offers only the agents carrying it, starting from the mapping's governance preset", async () => {
    const wrapper = await open();

    expect(pageAgents).toHaveBeenCalled();
    // The composer shows the page's default: the governance preset, not the remembered agent this tab last used.
    expect(wrapper.find(".switch-name").text()).toBe(governanceAgent.name);
    // Opening the choice lists exactly what the page's directory answered — the candidates, and nobody else.
    await wrapper.find(".switch-trigger").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".agent-menu .option-name").map((option) => option.text())).toEqual([
      governanceAgent.name, "Assistant",
    ]);
    expect(wrapper.find(".agent-menu .agent-option.current .option-name").text()).toBe(governanceAgent.name);
    wrapper.unmount();
  });
});
