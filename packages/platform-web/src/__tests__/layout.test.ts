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

const rows = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll(".page-row").map((row) => row.find(".page-label").text());
const activeRow = (wrapper: ReturnType<typeof mount>) => wrapper.find(".page-row.active .page-label").text();

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

describe("the platform's application column", () => {
  it("lists the pages this account may open, grouping them as the application does", async () => {
    const { wrapper } = await mountLayout("/ontology/objects", ["ontology-modeling"]);
    expect(wrapper.find(".panel-title").text()).toBe("platform.ontologyManager");
    expect(rows(wrapper)).toEqual(["nav.objectTypes"]);
    // A group whose pages are all unavailable disappears with them.
    expect(wrapper.findAll(".group-heading").map((heading) => heading.text())).toEqual(["nav.groupOntology"]);
  });

  it("marks the current entry, keeping it marked on a detail address", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects/Order", ["ontology-modeling"]);
    expect(activeRow(wrapper)).toBe("nav.objectTypes");
    await router.push("/ontology/objects");
    await flushPromises();
    expect(activeRow(wrapper)).toBe("nav.objectTypes");
  });

  it("lists the same page once, under the one application that owns it", async () => {
    const { apps } = await mountLayout("/browser/data", ["data-browser", "ontology-modeling"]);
    // The object browser holds the graph and data browsing; the ontology manager does not list them again.
    const browser = apps.find((app) => app.id === "browser")!;
    const ontology = apps.find((app) => app.id === "ontology")!;
    expect(browser.groups?.flatMap((group) => group.pages.map((entry) => entry.id))).toEqual([
      "/ontology/playground",
      "/browser/data",
    ]);
    expect(ontology.groups?.flatMap((group) => group.pages.map((entry) => entry.id))).toEqual([
      "/ontology/objects",
    ]);
  });

  it("switches the column to the application that owns the address", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects", ["ontology-modeling", "data-browser"]);
    await router.push("/browser/data");
    await flushPromises();
    expect(wrapper.find(".panel-title").text()).toBe("platform.objectBrowser");
  });

  it("lists no page for an account that holds no code, while the rail still shows every application", async () => {
    const { wrapper, apps } = await mountLayout("/ontology/objects", []);
    expect(apps.every((app) => (app.groups ?? []).length === 0)).toBe(true);
    expect(wrapper.findAll(".page-row")).toHaveLength(0);
    // The platform rail is not filtered: the task requires every application to be listed.
    expect(wrapper.findAll(".rail-row")).toHaveLength(apps.length);
  });
});
