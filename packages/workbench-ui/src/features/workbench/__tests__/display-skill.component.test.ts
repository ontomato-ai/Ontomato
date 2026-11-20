import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { createAgentHostClient } from "@ontomato/agent-shell-ui";
import { assistantAgentsQuerySchema, type PageSkillContext } from "@ontomato/contracts/page-skills";
import { pilotPageKey, platformPageAccessKey, type PilotPage } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";
import { displayOf } from "./shell";

const i18n = workbenchI18n();
const assistant = { id: "11111111-1111-4111-8111-111111111111", name: "Assistant", description: "", icon: null, enabled: true, effectiveSkills: [] };
const specialist = { id: "22222222-2222-4222-8222-222222222222", name: "Order Specialist", description: "", icon: null, enabled: true, effectiveSkills: [] };

const hostState = vi.hoisted(() => ({
  requests: [] as string[],
  fetchMock: null as ((input: string) => Promise<Response>) | null,
}));

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  useSessionRunFeed: () => {},
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () =>
    createAgentHostClient({
      request: (path) => hostState.fetchMock!(path),
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
  hostState.requests.length = 0;
  hostState.fetchMock = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("BusinessWorkbench display-skill forwarding", () => {
  it("routes panel display-skill through the display controller and real host client across member switches, member: null, instance changes, and close", async () => {
    const emitSkillByInstance = new Map<string, (skill: PageSkillContext | null) => void>();
    const PanelDouble = defineComponent({
      props: { instanceId: { type: String, required: true } },
      emits: ["display-skill"],
      setup(props, { emit }) {
        emitSkillByInstance.set(props.instanceId, (skill) => emit("display-skill", skill));
        return () => h("div", { class: "panel-double" }, props.instanceId);
      },
    });

    hostState.fetchMock = async (input: string) => {
      hostState.requests.push(input);
      const url = new URL(input, "http://host.test");
      if (url.pathname.endsWith("/sessions")) {
        return new Response(JSON.stringify({ sessions: [], nextCursor: null }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const memberKey = (JSON.parse(url.searchParams.get("member") ?? "null") as { ref: { name: string } } | null)?.ref.name ?? null;
      if (memberKey === "pvt-home-panel") {
        return new Response(JSON.stringify({ agents: [assistant], defaultAgentId: assistant.id }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (memberKey === "pvt-order-detail") {
        return new Response(JSON.stringify({ agents: [specialist], defaultAgentId: specialist.id }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ agents: [assistant, specialist] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { ...platformRoutes.chat, component: { render: () => null } },
        { ...platformRoutes.agents, component: { render: () => null } },
        { ...platformRoutes.agentSettingsNew, component: { render: () => null } },
        { path: "/applications/:app/:page", component: { render: () => null } },
      ],
    });
    await router.push({ path: platformRoutes.chat.path, query: { page: "/applications/workspace/home" } });
    await router.isReady();

    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: {
        plugins: [i18n, ElementPlus, router],
        provide: {
          [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
          [platformPageAccessKey as symbol]: () => true,
          [pilotPageKey as symbol]: () => (address: string): PilotPage | null => {
            const path = address.split("?")[0]!;
            if (!path.startsWith("/applications/")) return null;
            return {
              id: "panel-application",
              component: PanelDouble,
              instance: path,
              props: { instanceId: path },
            };
          },
        },
      },
    });
    wrappers.push(wrapper);
    await settle();

    const display = displayOf(wrapper);
    const homeContext: PageSkillContext = {
      mode: "member",
      locator: { pageKey: "home", access: "domain-member" },
      member: { source: { kind: "home" }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-home-panel" } },
    };
    emitSkillByInstance.get("/applications/workspace/home")!(homeContext);
    await settle();

    const agentRequests = () => hostState.requests.filter((url) => url.startsWith("/agents"));
    expect(display.pageSkill.value).toEqual(homeContext);
    const homeQuery = Object.fromEntries(new URL(agentRequests().at(-1)!, "http://host.test").searchParams);
    expect(assistantAgentsQuerySchema.parse(homeQuery)).toEqual({ pageKey: "home", access: "domain-member", member: homeContext.member });

    // Re-emitting display-skill on the same instance (e.g. /home opening an object drawer) re-queries.
    const drawerContext: PageSkillContext = {
      mode: "member",
      locator: { pageKey: "home", access: "domain-member" },
      member: { source: { kind: "object-detail", useId: "use-order", object: { className: "Order", primaryKey: "ord-1" } }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-order-detail" } },
    };
    emitSkillByInstance.get("/applications/workspace/home")!(drawerContext);
    await settle();

    const drawerQuery = Object.fromEntries(new URL(agentRequests().at(-1)!, "http://host.test").searchParams);
    expect(assistantAgentsQuerySchema.parse(drawerQuery)).toEqual({ pageKey: "home", access: "domain-member", member: drawerContext.member });

    // Emitting member: null sends no /agents request and keeps the panel mounted.
    const countBeforeNull = agentRequests().length;
    emitSkillByInstance.get("/applications/workspace/home")!({
      mode: "member",
      locator: { pageKey: "home", access: "domain-member" },
      member: null,
    });
    await settle();

    expect(agentRequests().length).toBe(countBeforeNull);
    expect(display.page.value?.instance).toBe("/applications/workspace/home");

    // Switching to another instance clears display.pageSkill and re-queries.
    await display.navigate("/applications/workspace/orders", { view: "side", history: "push" });
    await settle();
    expect(display.pageSkill.value).toBeNull();
    expect(agentRequests().at(-1)).toBe("/agents");

    // Emitting a skill on the new instance and then closing clears display.pageSkill and restores all agents.
    emitSkillByInstance.get("/applications/workspace/orders")!(drawerContext);
    await settle();
    expect(display.pageSkill.value).toEqual(drawerContext);

    await display.close();
    await settle();
    expect(display.pageSkill.value).toBeNull();
    expect(agentRequests().at(-1)).toBe("/agents");
  });
});
