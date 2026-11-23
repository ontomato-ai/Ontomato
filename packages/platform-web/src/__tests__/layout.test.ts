import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { defineComponent, h } from "vue";
import type { PlatformShellLabels } from "@ontomato/platform-shell";
import PlatformLayout from "../PlatformLayout.vue";
import { appDeclarations } from "../partition";
import { catalogPartition } from "../native-layouts";
import { catalogFixture, closedAccess, generatedNavigation, partitionOf } from "./fixtures";

const labels: PlatformShellLabels = {
  expandRail: "Show application names",
  collapseRail: "Hide application names",
  back: "Back",
  applications: "Applications",
  brand: "Ontomato",
  account: "Account",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  signOut: "Log out",
  opensInNewTab: "Opens in a new tab",
  openStandalone: "Open standalone",
  pages: "Pages",
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
  more: "More",
  copyExternalLink: "Copy external link",
  externalLinkCopied: "External link copied",
};

/** The column's words are message keys here; the layout translates them in production, the test reads them raw. */
const t = (key: string) => key;

const page = (name: string) => defineComponent({ name, render: () => h("p", { class: "page-double" }, name) });
const routes: RouteRecordRaw[] = [
  { path: "/ontology/objects", component: page("objects"), meta: { page: "/ontology/objects" } },
  { path: "/ontology/objects/:className", component: page("object-detail"), meta: { page: "/ontology/objects" } },
  { path: "/ontology/playground", component: page("graph"), meta: { page: "/ontology/playground" } },
  { path: "/browser/data", component: page("data-browser"), meta: { page: "/browser/data" } },
];

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  // An external link's tab is remembered for the tab: each test starts in the platform.
  sessionStorage.clear();
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

/** A rail row's name: the visible label when the rail is expanded, its accessible name when it is collapsed. */
const rowName = (row: { text(): string; attributes(name: string): string | undefined }) =>
  (row.text().replace("Opens in a new tab", "").trim() || row.attributes("aria-label") || "").trim();

async function mountLayout(path: string, granted: string[]) {
  const navigation = generatedNavigation();
  const apps = appDeclarations(navigation, closedAccess(granted), partitionOf(), t);
  const router = createRouter({
    history: createMemoryHistory(),
    // The layout is mounted by the test with its props; the router only supplies the pages it shows.
    routes: [{ path: "/", component: { render: () => h(RouterView) }, children: routes }],
  });
  await router.push(path);
  const wrapper = mount(PlatformLayout, {
    props: {
      apps,
      shownPage: { title: "nav.ontologyManager" },
      account: { userName: "Ada", signOut: () => {} },
      preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
      labels,
      pageActions: null,
    },
    global: { plugins: [router] },
  });
  mounted.push(wrapper);
  await flushPromises();
  return { wrapper, router, apps };
}

describe("the platform layout", () => {
  it("renders published product and panel applications under App Builder in the second rail group", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects", ["ontology-modeling"]);
    router.addRoute({ path: "/products/:productAssetId", component: page("product") });
    router.addRoute({ path: "/applications/:applicationId/:panelPath(.*)?", component: page("application") });
    router.addRoute({ path: "/home", component: page("home") });
    const catalog = catalogFixture();
    const product = {
      ...catalog[0]!, id: "app-report", names: { en: "Report" }, kind: "product" as const,
      category: "business" as const, releaseId: "release-1", entry: { path: "/products/app-report?applicationId=app-report" },
    };
    const panel = {
      ...product, id: "app-panel", names: { en: "Operations panel" }, releaseId: null,
      entry: { path: "/operations-panel", renderer: "panels" },
      panelUses: ["tasks", "summary"].map(id => ({ id, pageKey: id, panelId: id, path: `/applications/app-panel/${id}`, access: { kind: "domain-member" as const }, names: { en: id } })),
    };
    const applications = appDeclarations(generatedNavigation(), closedAccess([]), catalogPartition([...catalog, product, panel], "en"), t);
    await wrapper.setProps({ apps: applications, dynamicAppIds: [product.id, panel.id], pinnedAppIds: [] });

    const groups = wrapper.findAll(".rail-scroll .rail-section");
    expect(groups[0]!.text()).not.toContain("Report");
    const labels = groups[1]!.findAll(".rail-row").map(row => row.attributes("aria-label") ?? row.text().trim());
    expect(labels).toEqual([
      applications.find(app => app.id === "app-builder")!.label,
      "Report · App Builder",
      "Operations panel · App Builder",
    ]);
    // An application the reader opens from the rail opens in the platform (big main's ruling, 2026-11-21): no new tab.
    expect(groups[1]!.findAll("a[target='_blank']")).toHaveLength(0);

    // Its external link: the entry's address with the flag. Opened, the platform's rail is not drawn; the application's
    // menu and the page header are, and the header offers the entry's external link.
    await wrapper.setProps({ shownPage: { title: "tasks", named: true, externalLink: "/applications/app-panel/tasks" } });
    await router.push("/applications/app-panel/tasks?standalone=1");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(false);
    expect(wrapper.find(".platform-app-menu").exists()).toBe(true);
    expect(wrapper.get(".platform-page-header .page-title").text()).toBe("tasks");
    expect(wrapper.find(".platform-page-header .page-more").exists()).toBe(true);
    expect(wrapper.find(".standalone-header").exists()).toBe(false);
    expect(wrapper.find(".published-page-nav").exists()).toBe(false);
    // The tab stays an external link's as the reader goes on, with no flag in the address.
    await router.push("/applications/app-panel/summary");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(false);
    expect(wrapper.find(".platform-app-menu").exists()).toBe(true);
  });

  it('preserves the ontology menu for linked administration pages and restores native navigation on direct entry',async()=>{
    const {wrapper,router,apps}=await mountLayout('/ontology/objects',['ontology-modeling']);
    router.addRoute({path:'/permissions/members',component:page('members'),meta:{page:'/permissions/members'}});
    const ontology=apps.find(app=>app.id==='ontology')!;
    await wrapper.setProps({apps:apps.map(app=>app.id==='ontology'?{...ontology,frame:'menu' as const,groups:[...(ontology.groups??[]),{key:'governance',pages:[{id:'/permissions/members',label:'Members',icon:'pages'}]}]}:app)});
    await wrapper.findAll('.page-row').find(row=>row.text()==='Members')!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.navigationContext).toBe('ontology');
    expect(wrapper.find('.platform-app-menu').text()).toContain('Members');
    expect(wrapper.find('.platform-app-menu .page-row.active').text()).toBe('Members');
    await router.push('/permissions/members');await flushPromises();
    expect(wrapper.find('.platform-app-menu').exists()).toBe(false);
  });
  it("does not filter the rail by what the account may open", async () => {
    const none = (await mountLayout("/ontology/objects", [])).wrapper.findAll(".rail-row").length;
    const all = (await mountLayout("/ontology/objects", ["ontology-modeling", "business-knowledge"])).wrapper.findAll(".rail-row").length;
    expect(none).toBeGreaterThan(0);
    expect(none).toBe(all);
  });

  /*
   * Which application draws its own menu is known only when the catalog arrives, after the page is already drawn. The
   * menu is then inserted beside the page; the page is not mounted a second time (a second mount loses the clicks of
   * its first second and sends its first requests twice).
   */
  it("keeps the page mounted when the catalog later gives its application a menu", async () => {
    let mounts = 0;
    const counted = defineComponent({ name: "CountedPage", mounted: () => { mounts += 1; }, render: () => h("p", { class: "page-double" }, "counted") });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { render: () => h(RouterView) }, children: [{ path: "/ontology/objects", component: counted }] }],
    });
    await router.push("/ontology/objects");
    const wrapper = mount(PlatformLayout, {
      props: {
        apps: [],
        shownPage: { title: "nav.objectTypes", ownHeader: true },
        account: null,
        preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
        labels,
        pageActions: null,
      },
      global: { plugins: [router] },
    });
    mounted.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".platform-app-menu").exists()).toBe(false);

    const withMenu = partitionOf().map((app) => (app.id === "ontology" ? { ...app, frame: "menu" as const } : app));
    await wrapper.setProps({ apps: appDeclarations(generatedNavigation(), closedAccess(["ontology-modeling"]), withMenu, t) });
    await flushPromises();
    expect(wrapper.find(".platform-app-menu").exists()).toBe(true);
    expect(wrapper.find(".platform-page-body .page-double").exists()).toBe(true);
    expect(mounts).toBe(1);
  });

  it("heads a page that names itself with its own title, its description and its way back when it has them", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { render: () => h(RouterView) }, children: [{ path: "/applications/app-a/report", component: { render: () => h("p") } }] }],
    });
    await router.push("/applications/app-a/report");
    const back = vi.fn();
    const wrapper = mount(PlatformLayout, {
      props: {
        apps: [],
        shownPage: { title: "Governance report", named: true, back },
        account: null,
        preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
        labels,
        pageActions: null,
      },
      global: { plugins: [router] },
    });
    mounted.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".platform-page-header .page-title").text()).toBe("Governance report");
    await wrapper.find(".platform-page-header .page-back").trigger("click");
    expect(back).toHaveBeenCalledOnce();

    await wrapper.setProps({ shownPage: { title: "Business knowledge", named: true } });
    expect(wrapper.find(".platform-page-header .page-title").text()).toBe("Business knowledge");
    expect(wrapper.find(".platform-page-header .page-back").exists()).toBe(false);
    expect(wrapper.find(".platform-page-header .page-description").exists()).toBe(false);

    // Its entry's description stands under the title, where a native page's does.
    await wrapper.setProps({ shownPage: { title: "Business knowledge", named: true, description: "Review and maintain knowledge" } });
    expect(wrapper.find(".platform-page-header .page-description").text()).toBe("Review and maintain knowledge");
  });

  it("marks the current application by the address, keeping it marked on a detail address", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects/Order", ["ontology-modeling"]);
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.ontologyManager");
    await router.push("/browser/data");
    await flushPromises();
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.objectBrowser");
  });

  it("shows standalone open buttons in the expanded rail only for apps that allow it, and blocks ?standalone=1 when disabled", async () => {
    localStorage.setItem("ontomato.platform.railCollapsed", "false");
    const { wrapper, router } = await mountLayout("/ontology/objects", ["ontology-modeling"]);
    router.addRoute({ path: "/applications/:applicationId/:panelPath(.*)?", component: page("application") });
    const catalog = catalogFixture();
    const openPanel = {
      ...catalog[0]!, id: "app-open", names: { en: "Open panel" }, kind: "product" as const,
      category: "business" as const, releaseId: null, allowStandalone: true,
      entry: { path: "/applications/app-open", renderer: "panels" },
      panelUses: [{ id: "tasks", pageKey: "tasks", panelId: "tasks", path: "/applications/app-open/tasks", access: { kind: "domain-member" as const }, names: { en: "Tasks" } }],
    };
    const lockedPanel = {
      ...openPanel, id: "app-locked", names: { en: "Locked panel" }, allowStandalone: false,
      entry: { path: "/applications/app-locked", renderer: "panels" },
      panelUses: [{ id: "tasks", pageKey: "locked-tasks", panelId: "tasks", path: "/applications/app-locked/tasks", access: { kind: "domain-member" as const }, names: { en: "Tasks" } }],
    };
    const applications = appDeclarations(generatedNavigation(), closedAccess([]), catalogPartition([...catalog, openPanel, lockedPanel], "en"), t);
    await wrapper.setProps({ apps: applications, dynamicAppIds: [openPanel.id, lockedPanel.id], pinnedAppIds: [] });

    const standaloneHrefs = wrapper.findAll("a.rail-standalone").map(link => link.attributes("href"));
    expect(standaloneHrefs.some(href => href?.endsWith("#/applications/app-open?standalone=1"))).toBe(true);
    expect(standaloneHrefs.some(href => href?.includes("/applications/app-locked"))).toBe(false);

    // Clicking the application row itself still emits selectApp (in-platform navigation).
    const openRow = wrapper.findAll(".rail-row").find(row => row.text().includes("Open panel"))!;
    await openRow.trigger("click");
    expect(wrapper.emitted("selectApp")?.at(-1)).toEqual(["app-open"]);

    // Visiting a disabled app with ?standalone=1 keeps the rail visible, strips the flag, and leaves sessionStorage clean.
    await router.push("/applications/app-locked/tasks?standalone=1&state=%7B%22a%22%3A1%7D");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(true);
    expect(router.currentRoute.value.query.standalone).toBeUndefined();
    expect(router.currentRoute.value.query.state).toBe('{"a":1}');
    expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();

    // Even if this tab was previously standalone on an allowed app, navigating to a disabled app restores the platform rail.
    await router.push("/applications/app-open/tasks?standalone=1");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(false);
    expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBe("1");

    await router.push("/applications/app-locked/tasks");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(true);
    expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();
    localStorage.clear();
  });

  it("waits for the catalog before honoring ?standalone=1 so disabled apps never flash or persist standalone mode", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { render: () => h(RouterView) }, children: [{ path: "/applications/:applicationId/:panelPath(.*)?", component: page("application") }] }],
    });
    await router.push("/applications/app-locked/tasks?standalone=1");
    const wrapper = mount(PlatformLayout, {
      props: {
        apps: [],
        loading: true,
        shownPage: { title: "Tasks", named: true },
        account: null,
        preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
        labels,
        pageActions: null,
      },
      global: { plugins: [router] },
    });
    mounted.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(true);
    expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();

    await wrapper.setProps({
      loading: false,
      apps: [{ id: "app-locked", label: "Locked", icon: "pages", category: "business", prefix: "/applications/app-locked", home: "/applications/app-locked", allowStandalone: false }],
    });
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(true);
    expect(router.currentRoute.value.query.standalone).toBeUndefined();
    expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();
  });
});
