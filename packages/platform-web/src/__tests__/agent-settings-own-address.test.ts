import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";
import AgentSettingsRoute from "../pages/AgentSettingsRoute.vue";

/*
 * The agents' settings at its own address, mounted the way the platform mounts it: the router's route, no page props.
 * The address says what the page is — `/ontology/agents/new` is a new agent's form, `/ontology/agents/<id>` that agent's,
 * the bare list neither — and it is the only thing that says it. Asking for it in props as well made `/new` show the
 * previous agent's form: Vue hands an unpassed boolean prop to the component as `false`, so the address never got a word.
 *
 * The editor and its list are the workbench's own and are covered there; what this holds is which of them the page asks
 * for at each of its addresses.
 */
const seen: { agentId: string | null | undefined; creating: boolean | undefined }[] = [];

vi.mock("@ontomato/workbench-ui/features/agents", () => ({
  useAgentDefinitions: () => ({ ensureLoaded: async () => {} }),
  agentSettingsAddressKey: Symbol("agent-settings-address"),
  AgentSettingsNav: defineComponent({
    name: "AgentSettingsNavDouble",
    props: ["agentId", "creating", "standalone", "models"],
    setup: () => () => h("div", { class: "nav-double" }),
  }),
  AgentSettingsPage: defineComponent({
    name: "AgentSettingsPageDouble",
    props: ["agentId", "creating"],
    emits: ["changed"],
    setup(props) {
      seen.push({ agentId: props.agentId, creating: props.creating });
      return () =>
        h("div", { class: "page-double" }, [
          h("span", { class: "creating" }, String(props.creating)),
          h("span", { class: "agent" }, String(props.agentId)),
        ]);
    },
  }),
}));

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en }, elementLocale: () => elementEn,
});

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  seen.length = 0;
});

/** The page at one of its own addresses, mounted by the router alone. */
async function at(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.ontologyAgents, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgentNew, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgent, component: { template: "<div />" } },
      { ...platformRoutes.agents, component: { template: "<div />" } },
      { ...platformRoutes.agentSettingsNew, component: { template: "<div />" } },
      { ...platformRoutes.agentSettings, component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AgentSettingsRoute, {
    global: {
      plugins: [workbenchI18n(), ElementPlus, router],
      // The platform answers which of its pages the account may open; here, every one.
      provide: { [platformPageAccessKey as symbol]: () => true },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

// The agent platform's prefix and the ontology manager's name the same screens.
describe.each([platformRoutes.agents.path, platformRoutes.ontologyAgents.path])("the agents' settings at %s", (prefix) => {
  it("opens a new agent's form at /new", async () => {
    const wrapper = await at(`${prefix}/new`);

    // A new agent: the editor is told so, and names no agent — nothing stored is shown, so nothing stored can be deleted.
    expect(wrapper.find(".page-double .creating").text()).toBe("true");
    expect(wrapper.find(".page-double .agent").text()).toBe("null");
  });

  it("opens one agent's own form at its address", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const wrapper = await at(`${prefix}/${id}`);

    expect(wrapper.find(".page-double .creating").text()).toBe("false");
    expect(wrapper.find(".page-double .agent").text()).toBe(id);
  });

  it("shows the list itself, with no agent, at the bare address", async () => {
    const wrapper = await at(prefix);

    expect(wrapper.find(".page-double .creating").text()).toBe("false");
    expect(wrapper.find(".page-double .agent").text()).toBe("null");
  });
});
