import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h } from "vue";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { linkOf, openLink } from "./shell";

/*
 * An answer may link a page of the platform. The pages this assembly mounts beside a conversation open there; any other
 * page the router resolves opens at its real address, its query and draft handoff kept, so a link the agent wrote is
 * followed the way a reader would. An address the router does not resolve is not a page and stays text — the shell never
 * makes an arbitrary relative link clickable.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [{ id: "11111111-1111-4111-8111-111111111111", name: "Assistant", description: "", icon: null, enabled: true }]);
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

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

/**
 * The platform's routes with the shape the assembly gives them (`platformLayoutRoute`): every page sits under the layout,
 * whose own record redirects to the start page, and a catch-all answers any other address the same way. A page is the
 * deepest record an address matches — the layout above it redirecting says nothing about the page below it.
 */
async function openAt(): Promise<{ router: Router; wrapper: VueWrapper }> {
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
      // The assembly's own pages beside the conversation: dashboards, and no others.
      [pilotPageKey as symbol]: () => (address: string) =>
        address.startsWith("/dashboards")
          ? { id: "page", component: defineComponent({ render: () => h("div") }), props: {} }
          : null,
    } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, wrapper };
}

describe("the pages an answer links", () => {
  it("opens a page of the platform at its own address, with the draft handoff it names", async () => {
    const { router, wrapper } = await openAt();
    const href = "#/ontology/knowledge?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json";
    const open = linkOf(wrapper, href)!;
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
    const { router, wrapper } = await openAt();
    await openLink(wrapper, "#/dashboards?dashboardId=board-1");

    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-1");
  });

  it.each([
    ["an address no page has", "#/nowhere/at/all"],
    ["another host", "https://example.com/ontology/knowledge"],
    ["a mail address", "mailto:someone@example.com"],
    ["a relative path", "ontology/knowledge"],
  ])("leaves %s as text", async (_case, href) => {
    const { wrapper } = await openAt();
    expect(linkOf(wrapper, href)).toBeNull();
  });
});
