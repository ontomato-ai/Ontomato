import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { defineComponent, h } from "vue";
import type { PlatformShellLabels } from "@ontomato/platform-shell";
import PlatformLayout from "../PlatformLayout.vue";
import { appDeclarations } from "../partition";
import { closedAccess, generatedNavigation, partitionOf } from "./fixtures";

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
    const counted = defineComponent({ name: "counted", mounted: () => { mounts += 1; }, render: () => h("p", { class: "page-double" }, "counted") });
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
