import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { RouterView, type RouteRecordRaw } from "vue-router";
import { Database, Network, Sparkles } from "lucide-vue-next";
import { installPageGuard } from "../router";
import { createMemoryHistory, createRouter } from "vue-router";
import ServiceLayout from "../layout/ServiceLayout.vue";
import { providePlatformHost, type PlatformPageHost } from "../context";
import type { PlatformAccess, PlatformNavigation } from "../navigation";
import { ossPlatformPages, pageRoutes, platformGroups, platformPages } from "../pages";
import { testHost, testI18n } from "./host";

const count = ref<number | null>(null);
const navigation: PlatformNavigation = {
  groups: [{ key: "ontology", titleKey: "nav.ontology" }, platformGroups.platform],
  pages: [
    { path: "/playground", titleKey: "nav.graph", icon: Network, permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
    { path: "/objects", titleKey: "nav.objects", permissions: ["ontology-modeling"], group: "ontology", ownHeader: true, count: () => count.value },
    { path: "/data", titleKey: "nav.data", permissions: ["data-browser"], group: "ontology", ownHeader: true },
    platformPages.runRecords,
    platformPages.modelConfig,
  ],
};

const page = (name: string) => defineComponent({ name, render: () => h("p", { class: "page-double" }, name) });
const routes: RouteRecordRaw[] = [
  {
    path: "",
    component: defineComponent({ render: () => h(RouterView) }),
    children: [
      { path: "/playground", component: page("graph"), meta: { page: "/playground" } },
      { path: "/objects", component: page("objects"), meta: { page: "/objects" } },
      { path: "/objects/:className", component: page("object-detail"), meta: { page: "/objects" } },
      { path: "/data", component: page("data-browser"), meta: { page: "/data" } },
    ],
  },
  ...pageRoutes([platformPages.runRecords, platformPages.modelConfig], {
    [platformPages.runRecords.path]: async () => page("records"),
    [platformPages.modelConfig.path]: async () => page("models"),
  }),
];

function access(granted: string[]): PlatformAccess {
  return { ready: true, error: null, can: (code) => granted.includes(code), load: () => Promise.resolve() };
}

async function mountLayout(path: string, granted: string[], overrides: Partial<PlatformPageHost> = {}) {
  const host = testHost({}, { access: access(granted), navigation: computed(() => navigation), ...overrides });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: ServiceLayout, children: routes }] });
  installPageGuard(router, navigation, host.access, "/playground");
  await router.push(path);
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [testI18n(), ElementPlus, router], provide: providePlatformHost(host) },
  });
  await flushPromises();
  return { wrapper, router };
}

const rows = (wrapper: Awaited<ReturnType<typeof mountLayout>>["wrapper"]) =>
  wrapper.findAll(".nav-group .nav-row").map((row) => row.find(".nav-label").text());

describe("Ontology Service sidebar", () => {
  it("shows the brand and only the pages and groups the account may open", async () => {
    const { wrapper } = await mountLayout("/data", ["data-browser", "audit-logs"]);
    expect(wrapper.find(".sidebar-brand").text()).toBe("Ontology Service");
    expect(wrapper.findAll(".nav-heading").map((heading) => heading.text())).toEqual([
      "nav.ontology",
      "Platform Management",
    ]);
    expect(rows(wrapper)).toEqual(["nav.data", "Run Records"]);
  });

  it("highlights the entry of the current page, detail pages included, and shows a count once known", async () => {
    const { wrapper, router } = await mountLayout("/objects/Order", ["ontology-modeling"]);
    const active = wrapper.find(".nav-row.active");
    expect(active.find(".nav-label").text()).toBe("nav.objects");
    expect(active.attributes("aria-current")).toBe("page");
    expect(active.find(".nav-count").exists()).toBe(false);
    count.value = 9;
    await nextTick();
    expect(wrapper.find(".nav-row.active .nav-count").text()).toBe("9");
    count.value = null;
    await router.push("/playground");
    await flushPromises();
    expect(wrapper.find(".nav-row.active .nav-label").text()).toBe("nav.graph");
  });

  it("opens the other applications in a new tab: a link with its address, or the host's signed jump", async () => {
    const open = vi.fn();
    const { wrapper } = await mountLayout("/playground", ["ontology-modeling"], {
      links: [
        { key: "agent-platform", titleKey: "platform.agentPlatform", icon: Sparkles, href: "/root/" },
        { key: "data-governance", titleKey: "nav.governance", icon: Database, open },
      ],
    });
    const [agentPlatform, governance] = wrapper.findAll(".nav-links .nav-row");
    expect(agentPlatform.element.tagName).toBe("A");
    expect(agentPlatform.attributes()).toMatchObject({ href: "/root/", target: "_blank" });
    expect(agentPlatform.attributes("rel")).toContain("noopener");
    expect(agentPlatform.find(".nav-external").attributes("aria-label")).toBe("Opens in a new tab");
    await governance.trigger("click");
    expect(open).toHaveBeenCalledOnce();
  });

  it("draws the 48px page header for platform pages and leaves it to pages that have their own", async () => {
    const { wrapper, router } = await mountLayout("/settings/records/audit-log", ["ontology-modeling", "audit-logs"]);
    expect(wrapper.find(".page-header .page-title").text()).toBe("Run Records");
    expect(wrapper.find(".page-header .page-description").text()).toBe(
      "Change history and the service status of the data engine"
    );
    expect(wrapper.find(".page-body.platform-page").exists()).toBe(true);
    // The page keeps the entry highlighted while a tab of it is shown.
    expect(wrapper.find(".nav-row.active .nav-label").text()).toBe("Run Records");
    await router.push("/playground");
    await flushPromises();
    expect(wrapper.find(".page-header").exists()).toBe(false);
    expect(wrapper.find(".page-body.platform-page").exists()).toBe(false);
  });

  it("lists a page under either of its tabs' codes, and one entry for all of them", async () => {
    const audit = await mountLayout("/settings/records/audit-log", ["audit-logs"]);
    expect(rows(audit.wrapper)).toEqual(["Run Records"]);
    const monitor = await mountLayout("/settings/records/system-monitor", ["system-monitoring"]);
    expect(rows(monitor.wrapper)).toEqual(["Run Records"]);
    // A tab route is the page it belongs to: the entry stays highlighted there and at the page's own address.
    expect(monitor.wrapper.find(".nav-row.active .nav-label").text()).toBe("Run Records");
    expect(audit.wrapper.find(".nav-row.active .nav-label").text()).toBe("Run Records");
  });

  it("the open-source system settings have no license tab (open source runs no licenses)", async () => {
    expect(ossPlatformPages.find(({ path }) => path === "/settings/system-config")?.tabs?.map(({ titleKey }) => titleKey)).toEqual([
      "nav.systemGeneralTab",
      "nav.systemDataAdaptersTab",
    ]);
  });

  it("a page with its own header is listed under the same entry as its tabs", async () => {
    const { wrapper } = await mountLayout("/settings/model-config/usage", ["system-config"]);
    expect(rows(wrapper)).toEqual(["Models"]);
    expect(wrapper.find(".nav-row.active .nav-label").text()).toBe("Models");
  });

  it("an account with no page sees the no-permission state; a reduced layout hides the navigation", async () => {
    expect((await mountLayout("/", [])).wrapper.find(".permission-empty").text()).toBe("No available menu permissions");
    const reduced = await mountLayout("/settings/records/audit-log", ["audit-logs"], {
      navigationHidden: computed(() => true),
    });
    expect(reduced.wrapper.find(".nav-row").exists()).toBe(false);
    expect(reduced.wrapper.find(".page-double").text()).toBe("records");
  });

  it("the footer switches the theme and shows the account with sign-out", async () => {
    const setTheme = vi.fn();
    const signOut = vi.fn();
    const host = testHost({});
    const { wrapper } = await mountLayout("/playground", ["ontology-modeling"], {
      preferences: { ...host.preferences, setTheme },
      account: { userName: "admin", signOut },
    });
    expect(wrapper.find(".user-avatar").text()).toBe("A");
    expect(wrapper.find(".user-name").text()).toBe("admin");
    expect(wrapper.find(".lang-button").exists()).toBe(false);
    await wrapper.find(".theme-button").trigger("click");
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(wrapper.find(".logout-button").attributes("aria-label")).toBe("Log Out");
  });
});
