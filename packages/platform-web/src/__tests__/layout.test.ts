import { afterEach, describe, expect, it } from "vitest";
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
  applications: "Applications",
  brand: "Ontomato",
  account: "Account",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  signOut: "Log out",
  opensInNewTab: "Opens in a new tab",
  pages: "Pages",
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
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
      "Report · App Builder · Opens in a new tab",
      "Operations panel · App Builder · Opens in a new tab",
    ]);
    const links = groups[1]!.findAll("a[target='_blank']");
    const [reportHref, panelHref] = links.map(link => link.attributes("href")!);
    expect(reportHref).toBe("/products/app-report?applicationId=app-report&standalone=1");
    expect(panelHref).toBe("/applications/app-panel?standalone=1");

    await router.push(reportHref!);
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(false);
    expect(wrapper.get("h1").text()).toBe("Report");
    expect(wrapper.get(".workspace-return").attributes("href")).toBe("/home");
    await router.push(panelHref!);
    await flushPromises();
    expect(wrapper.find(".platform-app-menu").exists()).toBe(false);
    expect(wrapper.get(".published-page-nav [aria-current=page]").text()).toBe("tasks");
    await router.push(wrapper.get('.published-page-nav a[href*="/summary"]').attributes("href")!);
    await flushPromises();
    expect(wrapper.get(".published-page-nav [aria-current=page]").text()).toBe("summary");
    expect(wrapper.find(".platform-rail").exists()).toBe(false);
    await router.push("/home");
    await flushPromises();
    expect(wrapper.find(".platform-rail").exists()).toBe(true);
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

  it("marks the current application by the address, keeping it marked on a detail address", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects/Order", ["ontology-modeling"]);
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.ontologyManager");
    await router.push("/browser/data");
    await flushPromises();
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.objectBrowser");
  });
});
