import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";

/*
 * An answer may link a page of the platform. The pages this assembly mounts beside a conversation open there; any other
 * page the router resolves opens at its real address, its query and draft handoff kept, so a link the agent wrote is
 * followed the way a reader would. An address the router does not resolve is not a page and stays text — the shell never
 * makes an arbitrary relative link clickable.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [{ id: "11111111-1111-4111-8111-111111111111", name: "Assistant", description: "", icon: null, enabled: true }]);
const shellProps = ref<Record<string, unknown> | null>(null);

vi.mock("@ontomato/agent-shell-ui", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId", "featureId", "pageContext", "pageLinks"],
      setup(props) {
        shellProps.value = props as unknown as Record<string, unknown>;
        return () => h("div");
      },
    }),
    ShellNavBody: { name: "ShellNavBody", template: "<div />" },
    ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
    useAgentNav: () => ({
      agents: { value: agents },
      loadAgents: async () => {},
      loadSessions: async () => {},
      startNew: () => {},
      selectSession: () => {},
    }),
    useSessionRunFeed: () => {},
  };
});
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({ createAssistantClient: () => ({}), createAssistantFeedback: () => ({}) }));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  shellProps.value = null;
});

/**
 * The platform's routes with the shape the assembly gives them (`platformLayoutRoute`): every page sits under the layout,
 * whose own record redirects to the start page, and a catch-all answers any other address the same way. A page is the
 * deepest record an address matches — the layout above it redirecting says nothing about the page below it.
 */
async function openAt(): Promise<Router> {
  const start = () => platformRoutes.chat.path;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: platformRoutes.layout.name,
        redirect: start,
        component: { template: "<router-view />" },
        children: [
          { path: "", name: "PlatformHome", redirect: start },
          { ...platformRoutes.chat, component: { template: "<div />" } },
          { ...platformRoutes.knowledge, component: { template: "<div />" } },
          { ...platformRoutes.dashboards, component: { template: "<div />" } },
          { ...platformRoutes.governance, component: { template: "<div />" } },
        ],
      },
      // The platform answers any other address with its start page; that is no page of its own.
      { path: "/:unknown(.*)*", redirect: start },
    ],
  });
  await router.push({ path: platformRoutes.chat.path, query: { sessionId: "44444444-4444-4444-8444-444444444444" } });
  await router.isReady();
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: { plugins: [i18n, ElementPlus, router], provide: {
      [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
      [platformPageAccessKey as symbol]: () => true,
      // The assembly's own pages beside the conversation: a board and a governance report, and no others.
      [pilotPageKey as symbol]: (address: string) =>
        address.startsWith("/dashboards") || address.startsWith("/governance/reports/")
          ? { id: "page", component: defineComponent({ render: () => h("div") }), props: {} }
          : null,
    } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return router;
}

const pageLinks = () =>
  (shellProps.value as unknown as { pageLinks: (href: string) => (() => void) | null }).pageLinks;

describe("the pages an answer links", () => {
  it("opens a page of the platform at its own address, with the draft handoff it names", async () => {
    const router = await openAt();
    const href = "#/ontology/knowledge?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json";
    const open = pageLinks()(href)!;
    expect(open).toBeTypeOf("function");

    open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value.path).toBe(platformRoutes.knowledge.path);
    // The conversation the reader was in is left; the link's own parameters come with it, untouched.
    expect(router.currentRoute.value.query).toEqual({
      draftSessionId: "s", draftRunId: "r", draftPath: "outputs/drafts/a.page-draft.json",
    });
  });

  it("opens the pages beside the conversation there, and leaves the address's page parameter to carry them", async () => {
    const router = await openAt();
    const href = "#/governance/reports/record-1?issue=order-rule";
    pageLinks()(href)!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/governance/reports/record-1?issue=order-rule");
  });

  it.each([
    ["an address no page has", "#/nowhere/at/all"],
    ["another host", "https://example.com/ontology/knowledge"],
    ["a mail address", "mailto:someone@example.com"],
    ["a relative path", "ontology/knowledge"],
  ])("leaves %s as text", async (_case, href) => {
    await openAt();
    expect(pageLinks()(href)).toBeNull();
  });
});
