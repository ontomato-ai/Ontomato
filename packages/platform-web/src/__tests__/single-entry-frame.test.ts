import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import type { DirectPanelRun, PlatformPreferences, PlatformShellLabels } from "@ontomato/platform-shell";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { appDeclarations } from "../partition";
import { catalogPartition } from "../native-layouts";
import { resetApplicationCatalog, useApplicationCatalog } from "../catalog";
import { closedAccess, generatedNavigation, catalogFixture } from "./fixtures";
import type { PlatformAppDeclaration } from "../apps";

const capturedMenus: Array<{ applicationId: string; singleEntry: boolean; title?: string }> = [];

vi.mock("@ontomato/platform-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/platform-shell")>();
  return {
    ...actual,
    PanelHost: defineComponent({
      name: "PanelHost",
      props: {
        port: { type: Object, required: true },
        currentEntry: { type: Object, default: null },
        label: { type: String, default: "" },
      },
      emits: ["display-address", "display-state", "display-loaded", "surface-ready"],
      setup(props, { emit }) {
        const entry = props.currentEntry as DirectPanelRun["currentEntry"] | null;
        if (entry) {
          capturedMenus.push({
            applicationId: entry.entry.value.applicationId,
            singleEntry: entry.menu.value.singleEntry,
            title: props.label,
          });
        }
        emit("surface-ready", true);
        return () => h("div", { class: "mock-frame-host" });
      },
    }),
  };
});

vi.mock("../panel-host", () => ({
  framePanelHost: (_appId: string, _use: unknown, framePanelId: string) => ({ kind: "frame", framePanelId }),
  builtinFramePanelHost: (_appId: string, framePanelId: string) => ({ kind: "frame", framePanelId }),
  cachedApplicationFrameManifest: () => null,
}));

const PlatformLayout = (await import("../PlatformLayout.vue")).default;

const labels: PlatformShellLabels = {
  applications: "Apps",
  brand: "Ontomato",
  pages: "Pages",
  expandRail: "Expand",
  collapseRail: "Collapse",
  account: "Account",
  signOut: "Sign out",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved",
  back: "Back",
  more: "More",
  copyExternalLink: "Copy link",
  externalLinkCopied: "Copied",
};

const preferences: PlatformPreferences = {
  locales: ["en"],
  locale: "en",
  setLocale() {},
  theme: "light",
  setTheme() {},
};

describe("singleEntry application frame behavior", () => {
  beforeEach(() => {
    capturedMenus.length = 0;
    resetApplicationCatalog();
    installAuthHost({
      getToken: () => null,
      getApiKey: () => null,
      getUserInfo: () => null,
      responseStatusError: () => null,
      verifySessionOnce: async () => "valid",
      handleAuthExpired: () => {},
    });
  });

  it("computes singleEntry from total declared pages in partition.ts, not filtered permissions", () => {
    const declarations = appDeclarations(
      generatedNavigation(),
      // Restricted account with only a single page in multi-page applications.
      closedAccess(["feedback"]),
      [
        {
          id: "operations",
          label: "Operations diagnosis",
          icon: "activity",
          category: "admin",
          prefix: "/ops",
          framePanelId: "builtin-product-platform-frame",
          sections: [
            {
              key: "ops:all",
              paths: ["/ops/turn", "/ops/test", "/ops/feedback"],
            },
          ],
        },
        {
          id: "dashboards",
          label: "Dashboards",
          icon: "layout-dashboard",
          category: "business",
          prefix: "/dashboards",
          framePanelId: "builtin-product-platform-frame",
          sections: [
            {
              key: "dashboards:all",
              paths: ["/dashboards"],
            },
          ],
        },
      ],
      (key) => key,
    );

    expect(declarations.find((app) => app.id === "operations")?.singleEntry).toBe(false);
    expect(declarations.find((app) => app.id === "dashboards")?.singleEntry).toBe(true);
  });

  it("forwards catalog singleEntry through catalogPartition and preserves it when user sees 1 entry", () => {
    const base = catalogFixture().find((app) => app.id === "operations")!;
    const restrictedCatalogApp: CatalogApplication = {
      ...base,
      singleEntry: false,
      panelUses: base.panelUses?.slice(0, 1) ?? [],
    };
    const partition = catalogPartition([restrictedCatalogApp], "en");
    expect(partition[0]?.singleEntry).toBe(false);
    const declarations = appDeclarations(generatedNavigation(), closedAccess([]), partition, (k) => k);
    expect(declarations[0]?.singleEntry).toBe(false);
  });

  it("keeps sub-page header title and entryMenu.singleEntry=false for multi-entry app with 1 visible entry, and uses app title when singleEntry=true", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/ops/feedback", component: { render: () => h("div", "feedback") } },
        { path: "/dashboards", component: { render: () => h("div", "dashboards") } },
      ],
    });
    const apps: PlatformAppDeclaration[] = [
      {
        id: "operations",
        label: "Operations diagnosis",
        icon: "activity",
        category: "admin",
        prefix: "/ops",
        framePanelId: "builtin-product-platform-frame",
        singleEntry: false,
        groups: [{ key: "ops", pages: [{ id: "/ops/feedback", label: "User feedback", icon: "message" }] }],
      },
      {
        id: "dashboards",
        label: "Dashboards",
        icon: "layout-dashboard",
        category: "business",
        prefix: "/dashboards",
        framePanelId: "builtin-product-platform-frame",
        singleEntry: true,
        groups: [{ key: "dash", pages: [{ id: "/dashboards", label: "Overview", icon: "layout-dashboard" }] }],
      },
    ];

    useApplicationCatalog().applications.value = catalogFixture().filter((app) => ["operations", "dashboards"].includes(app.id));

    await router.push("/ops/feedback");
    await router.isReady();
    const wrapper = mount(PlatformLayout, {
      props: {
        apps,
        shownPage: { title: "User feedback" },
        account: null,
        preferences,
        labels,
        pageActions: null,
      },
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(capturedMenus.at(-1)).toEqual({
      applicationId: "operations",
      singleEntry: false,
      title: "Operations diagnosis",
    });
    // Multi-entry frame shows sub-page title in the right-hand page header.
    expect(wrapper.find(".platform-page-header").text()).toContain("User feedback");

    await router.push("/dashboards");
    await wrapper.setProps({ shownPage: { title: "Overview" } });
    await flushPromises();
    expect(capturedMenus.at(-1)).toEqual({
      applicationId: "dashboards",
      singleEntry: true,
      title: "Dashboards",
    });
    // Inherently single-entry app has no left menu, so header displays the application's name.
    expect(wrapper.find(".platform-page-header").text()).toContain("Dashboards");
    wrapper.unmount();
  });
});
