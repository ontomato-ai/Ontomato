import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import { pilotPageResolver } from "../pilot-pages";

/*
 * One governance record's report is the platform's page in two places: at its own address, and beside the conversation
 * that wrote it. These hold the two halves the report's own line owns here: the address `?page=/governance/reports/<id>`
 * resolves to the report with that record, and the conversation carries the page — with the finding selected in it —
 * to the message written at its foot.
 */

// The report's own drawing and reads belong to the governance line; these read where it is and what it is opened with.
vi.mock("../pages/GovernanceReportRoute.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "GovernanceReportDouble",
    props: { recordId: String, issueId: String, paired: Boolean },
    setup: (props) => () =>
      h("div", { class: "report-page" }, `${props.paired ? "beside" : "own"} ${props.recordId} ${props.issueId ?? ""}`),
  }),
}));

const shellProps = ref<Record<string, unknown> | null>(null);
const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Governance", description: "", icon: null, enabled: true };
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: defineComponent({
    name: "AgentShell",
    props: ["featureId", "pageContext", "pageLinks", "workbench"],
    emits: ["update:featureId"],
    setup(props, { slots, expose }) {
      shellProps.value = props as unknown as Record<string, unknown>;
      expose({ reloadAgents: () => {}, send: async () => {} });
      return () => h("div", { class: "shell" }, [slots.feature?.({ featureId: props.featureId })]);
    },
  }),
  useAgentNav: () => ({
    agents: ref([agent]),
    sessions: ref([]),
    sessionsState: ref("ready"),
    nextCursor: ref(null),
    currentAgent: ref(null),
    loadAgents: async () => {},
    loadSessions: async () => {},
    startNew: () => {},
    selectSession: () => {},
    removeSession: async () => {},
    promoteSession: () => {},
  }),
  useSessionRunFeed: () => {},
}));
vi.mock("../../workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../../workbench-ui/src/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ listAgents: async () => [] }),
  createAssistantFeedback: () => ({}),
}));

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: {} }, elementLocale: () => elementEn,
  });
});

async function routerAt(query: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.chat, component: { template: "<div />" } },
      { ...platformRoutes.agents, component: { template: "<div />" } },
      { ...platformRoutes.agentSettingsNew, component: { template: "<div />" } },
    ],
  });
  await router.push({ path: platformRoutes.chat.path, query });
  await router.isReady();
  return router;
}

const provide = () => ({
  [pilotPageKey as symbol]: pilotPageResolver,
  [platformPageAccessKey as symbol]: () => true,
  [pageCounterKey as symbol]: {
    agents: async () => [agent],
    preferredAgentId: ref<string | null>(agent.id),
    ask: () => {},
  },
});

describe("one governance record's report beside the conversation", () => {
  it("resolves the record's address to the report page with that record and its finding", () => {
    const setPage = vi.fn();
    const resolvePilotPage = pilotPageResolver(setPage);
    const page = resolvePilotPage("/governance/reports/record-1?issue=order-rule");
    expect(page?.component).toBeTruthy();
    expect(page?.props).toEqual({ paired: true, recordId: "record-1", issueId: "order-rule", navigate: expect.any(Function) });
    // Selecting another finding lands on the same page at its new address; the rest of the address stays as it was.
    (page!.props!.navigate as (next: { issue?: string }) => void)({ issue: "refund-rule" });
    expect(setPage).toHaveBeenLastCalledWith("/governance/reports/record-1?issue=refund-rule");
    (page!.props!.navigate as (next: { issue?: string }) => void)({});
    expect(setPage).toHaveBeenLastCalledWith("/governance/reports/record-1");
    expect(resolvePilotPage("/dashboards")?.props).toEqual({ paired: true, dashboardId: undefined, navigate: expect.any(Function) });
    expect(resolvePilotPage("/ontology/knowledge")).toBeNull();
  });

  it("draws the report beside the conversation, with the page and the finding selected in it on the message", async () => {
    const router = await routerAt({ page: "/governance/reports/record-1?issue=order-rule" });
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
    });
    await flushPromises();

    expect(wrapper.find(".report-page").text()).toBe("beside record-1 order-rule");
    const context = (shellProps.value as unknown as { pageContext: { url: string; label: string; selection: { kind: string; id: string }[] } }).pageContext;
    // The page is named by the reader's name for it and by its own address, which tells two reports apart.
    expect(context.url).toBe("/governance/reports/record-1?issue=order-rule");
    // The test installs no messages, so the name is the key the reader's language would answer with.
    expect(context.label).toBe("assistant.featureGovernanceReport");
    expect(context.selection).toEqual([expect.objectContaining({ kind: "issue", id: "order-rule" })]);
    // The page's own skill narrows the composer: an agent is a candidate when its effective skills carry the page's.
    const feature = (shellProps.value as unknown as { workbench: { features: { id: string; pageSkill?: unknown }[] } })
      .workbench.features.find((item) => item.id === "governance-report")!;
    expect(feature.pageSkill).toEqual({ pageKey: "governance-report", permissionCode: "business-knowledge" });
    wrapper.unmount();
  });

  it("carries no selection for a report opened without a finding", async () => {
    const router = await routerAt({ page: "/governance/reports/record-1" });
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
    });
    await flushPromises();

    const context = (shellProps.value as unknown as { pageContext: { selection: unknown[] } }).pageContext;
    expect(context.selection).toEqual([]);
    wrapper.unmount();
  });
});
