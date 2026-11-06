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
const railRows = (wrapper: ReturnType<typeof mount>) => wrapper.findAll(".rail-row").map(rowName);

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
  /*
   * The platform draws no second column: the rail and the application's own surface, nothing between them (DESIGN.md
   * "Applications and shells"). An application that wants a column draws it inside its own page.
   */
  it("draws the rail and the application's surface, with no shell-made column", async () => {
    const { wrapper } = await mountLayout("/ontology/objects", ["ontology-modeling"]);
    expect(wrapper.find(".platform-app").exists()).toBe(true);
    expect(wrapper.find(".app-panel").exists()).toBe(false);
    expect(wrapper.find(".panel-title").exists()).toBe(false);
    // The page is drawn into the surface beside the rail.
    expect(wrapper.find(".platform-app .page-double").exists()).toBe(true);
  });

  it("lists the applications in the sections they declare, whatever the account holds", async () => {
    const { wrapper } = await mountLayout("/ontology/objects", []);
    // In the order the partition declares, and both in the rail's first section.
    expect(railRows(wrapper)).toEqual(["platform.objectBrowser", "platform.ontologyManager"]);
    expect(wrapper.findAll(".rail-scroll > .rail-divider")).toHaveLength(0);
    // The rail is not filtered by permission: every application is listed (the task requires it).
    expect(wrapper.findAll(".rail-row")).toHaveLength(2);
  });

  it("marks the current application by the address, keeping it marked on a detail address", async () => {
    const { wrapper, router } = await mountLayout("/ontology/objects/Order", ["ontology-modeling"]);
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.ontologyManager");
    await router.push("/browser/data");
    await flushPromises();
    expect(rowName(wrapper.find(".rail-row.active"))).toBe("platform.objectBrowser");
  });
});
