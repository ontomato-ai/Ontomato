import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ApplicationOpenResponse, ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { provideApplicationFrame, type PanelHostPort } from "@ontomato/platform-shell";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import PlatformLayout from "../PlatformLayout.vue";
import PanelApplicationRoute from "../pages/PanelApplicationRoute.vue";
import { resetApplicationCatalog, useApplicationCatalog } from "../catalog";
import { clearPanelDefinitionCache } from "../panel-definition-cache";
import { installCatalogueEntryGuard } from "../entry-access";
import { panelEntryGuard, unknownAddressRoute } from "../panel-entries";
import type { PlatformAppDeclaration } from "../apps";

interface MountedHostRecord {
  kind: "frame" | "content";
  panelId: string;
  label: string;
  useId: string;
  currentEntry?: { applicationId: string; useId: string; pageKey: string; kind?: string; path: string };
  reconciled: boolean;
  unmounted: boolean;
}

const mountedHosts: MountedHostRecord[] = [];
const visibilityListeners = new Set<(visible: boolean) => void>();

vi.mock("@ontomato/foundation-ui/visibility", () => ({
  documentVisible: () => true,
  onDocumentVisibility: (listener: (visible: boolean) => void) => {
    visibilityListeners.add(listener);
    return () => { visibilityListeners.delete(listener); };
  },
}));

vi.mock("@ontomato/workbench-ui/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ sessionRuns: { subscribe: vi.fn(), detach: vi.fn() } }),
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  PanelHost: defineComponent({
    name: "SourceCallingPanelHost",
    props: {
      port: { type: Object, required: true },
      address: { type: String, required: true },
      label: { type: String, default: "" },
      shown: { type: Boolean, default: true },
      currentEntry: { type: Object, default: undefined },
    },
    emits: ["surface-ready", "display-loaded", "display-address", "display-state", "display-dirty", "context", "reopened", "withdrawn"],
    setup(props, { emit }) {
      const loadedPanelId = ref("");
      const port = props.port as PanelHostPort;
      const currentEntry = props.currentEntry as { entry: { value: MountedHostRecord["currentEntry"] } } | undefined;
      const record: MountedHostRecord = {
        kind: props.currentEntry ? "frame" : "content",
        panelId: "",
        label: props.label,
        useId: port.use?.useId ?? "",
        currentEntry: currentEntry?.entry.value,
        reconciled: false,
        unmounted: false,
      };
      mountedHosts.push(record);
      void port.source().then((source) => {
        if (source.kind !== "registered") return;
        record.panelId = source.panel.id;
        record.currentEntry = currentEntry?.entry.value;
        record.reconciled = Boolean(port.sourceReconciled?.());
        loadedPanelId.value = source.panel.id;
        emit("display-loaded", { status: "ready" });
        emit("surface-ready", true);
      }, (error) => {
        emit("display-loaded", { status: "error", error: { message: String(error) } });
      });
      return () => h("div", {
        "data-host-kind": record.kind,
        "data-panel-id": loadedPanelId.value,
        "data-label": props.label,
      });
    },
  }),
}));

function makePanel(id: string, name: string): ProductPanel {
  const builtin = id.startsWith("builtin-product-");
  return {
    id,
    name,
    description: "",
    visibility: builtin ? "platform" : "domain",
    domainId: builtin ? null : "domain-1",
    ownerId: builtin ? null : "owner-1",
    editable: !builtin,
    revision: 1,
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
    content: { html: '<div id="app"></div>' },
    manifest: definePanel({ state: {}, members: {} }),
  } as ProductPanel;
}

const ontologyFrame = makePanel("builtin-product-ontology-frame", "Ontology frame");
const objectsPanel = makePanel("builtin-product-ontology-objects", "Object types");
const relationsPanel = makePanel("builtin-product-ontology-relations", "Relation types");
const opsFrame = makePanel("builtin-product-ops-frame", "Ops frame");

const objectsUse: ApplicationPanelUse = {
  id: "ontology-objects",
  pageKey: "ontology-objects",
  panelId: objectsPanel.id,
  path: "/ontology/objects",
  names: { en: "Object types" },
};
const relationsUse: ApplicationPanelUse = {
  id: "ontology-relations",
  pageKey: "ontology-relations",
  panelId: relationsPanel.id,
  path: "/ontology/relations",
  names: { en: "Relation types" },
};
const opsDiagnosisUse: ApplicationOpenResponse["use"] = {
  id: "ops-diagnosis",
  pageKey: "ops-diagnosis",
  kind: "frame-conversation",
  path: "/ops/diagnosis",
};
const opsTestNativeUse: ApplicationOpenResponse["use"] = {
  id: "ops-test-run",
  pageKey: "ops-test-run",
  kind: "native",
  path: "/ops/test",
  names: { en: "Test Execution" },
};

const layoutLabels = {
  back: "Back", more: "More", collapse: "Collapse",
  expandRail: "Expand", collapseRail: "Collapse",
  applications: "Apps", home: "Home", builtApplication: "Built", brand: "Ontomato",
  account: "Account", language: "Language", theme: { light: "Light", dark: "Dark" },
  signOut: "Sign out", opensInNewTab: "New tab", openStandalone: "Open standalone",
  pages: "Pages", save: "Save", discard: "Discard", unsavedChanges: "Unsaved",
  copyExternalLink: "Copy link", externalLinkCopied: "Copied",
};

function openResponse(
  applicationId: string,
  use: ApplicationOpenResponse["use"],
  options: {
    framePanelId?: string;
    frame?: ProductPanel | null;
    content?: ProductPanel | null;
    allowStandalone: boolean;
    names: Record<string, string>;
    panelUses: ApplicationOpenResponse["menu"]["panelUses"];
  },
): ApplicationOpenResponse {
  return {
    applicationId,
    use,
    ...(options.framePanelId ? { framePanelId: options.framePanelId } : {}),
    allowStandalone: options.allowStandalone,
    frame: options.frame ? { panel: options.frame, projections: {} } : null,
    content: options.content ? { panel: options.content, projections: {} } : null,
    menu: {
      singleEntry: false,
      names: options.names,
      groups: [],
      panelUses: options.panelUses,
    },
  };
}

beforeAll(() => {
  installAuthHost({
    getToken: () => "tok",
    getApiKey: () => null,
    responseStatusError: () => null,
    getUserInfo: () => ({ userId: "u-1", userName: "Ada", domainId: "domain-1", loginCode: "ada" }),
    verifySessionOnce: () => Promise.resolve("valid"),
    handleAuthExpired: () => {},
  });
  installWorkbenchI18n({
    supported: ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled: false,
    save: null,
    messages: { en: publicEn },
    elementLocale: () => en,
  });
});

beforeEach(() => {
  mountedHosts.length = 0;
  visibilityListeners.clear();
  resetApplicationCatalog();
  clearPanelDefinitionCache();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApplicationCatalog();
  clearPanelDefinitionCache();
  sessionStorage.clear();
});

describe("single application-entry open, cohort route sharing, and outer frame reuse", () => {
  it("cold-opens a framed panel route with one application-entry call, zero panel/snapshot fetches, localized title, and reuses the outer frame across same-app switches", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        const path = url.searchParams.get("path");
        if (path === "/ontology/objects") {
          return Response.json(openResponse("ontology", objectsUse, {
            framePanelId: ontologyFrame.id,
            frame: ontologyFrame,
            content: objectsPanel,
            allowStandalone: false,
            names: { en: "Ontology manager" },
            panelUses: [objectsUse, relationsUse],
          }));
        }
        if (path === "/ontology/relations") {
          return Response.json(openResponse("ontology", relationsUse, {
            framePanelId: ontologyFrame.id,
            frame: ontologyFrame,
            content: relationsPanel,
            allowStandalone: false,
            names: { en: "Ontology manager" },
            panelUses: [objectsUse, relationsUse],
          }));
        }
      }
      throw new Error(`Unexpected extra request: ${url.pathname}${url.search}`);
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { ...platformRoutes.layout, component: RouterView, children: [] },
        unknownAddressRoute,
      ],
    });
    router.beforeEach(panelEntryGuard(router));

    // Cold-open with standalone=1 on a standalone-disabled built-in application.
    await router.push("/ontology/objects?standalone=1");
    const wrapper = mount(defineComponent({
      setup() {
        const framed = provideApplicationFrame();
        return () => h(PlatformLayout, {
          apps: [],
          shownPage: null,
          account: null,
          preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
          labels: layoutLabels,
          pageActions: null,
          appFramed: framed.value,
        });
      },
    }), { global: { plugins: [router, workbenchI18n()] } });

    try {
      await flushPromises();

      // 1. Exactly one application-entry request, zero extra panel/snapshot/catalog requests.
      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fontology%2Fobjects"]);

      // 2. Standalone denied immediately -> normal rail shown, standalone param stripped.
      expect(wrapper.find(".platform-rail").exists()).toBe(true);
      expect(router.currentRoute.value.query.standalone).toBeUndefined();
      expect(sessionStorage.getItem("ontomato.externalLinkTab")).toBeNull();

      // 3. Localized title and both frame + content mounted from the single response with sourceReconciled=true.
      const frameHosts = mountedHosts.filter((item) => item.kind === "frame");
      const contentHosts = mountedHosts.filter((item) => item.kind === "content");
      expect(frameHosts).toHaveLength(1);
      expect(frameHosts[0]).toMatchObject({
        panelId: ontologyFrame.id,
        label: "Ontology manager",
        reconciled: true,
      });
      expect(contentHosts).toHaveLength(1);
      expect(contentHosts[0]).toMatchObject({
        panelId: objectsPanel.id,
        reconciled: true,
      });

      // 4. Same-application switch reuses the mounted outer frame instance and fetches only the next application-entry.
      await router.push("/ontology/relations");
      await flushPromises();

      expect(requests).toEqual([
        "/api/product-panels/application-entry?path=%2Fontology%2Fobjects",
        "/api/product-panels/application-entry?path=%2Fontology%2Frelations",
      ]);
      expect(mountedHosts.filter((item) => item.kind === "frame")).toHaveLength(1);
      expect(mountedHosts.filter((item) => item.kind === "content").map((item) => item.panelId)).toEqual([
        objectsPanel.id,
        relationsPanel.id,
      ]);

      // 5. Returning to foreground still triggers a fresh application-entry admission check (no cross-request cache).
      for (const listener of visibilityListeners) listener(true);
      await flushPromises();
      expect(requests).toHaveLength(3);
      expect(requests[2]).toBe("/api/product-panels/application-entry?path=%2Fontology%2Frelations");
    } finally {
      wrapper.unmount();
    }
  });

  it("shares the in-flight application-entry response between ApplicationFrameHost and PanelApplicationRoute on warm navigation", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        return Response.json(openResponse("ontology", objectsUse, {
          framePanelId: ontologyFrame.id,
          frame: ontologyFrame,
          content: objectsPanel,
          allowStandalone: false,
          names: { en: "Ontology manager" },
          panelUses: [objectsUse, relationsUse],
        }));
      }
      throw new Error(`Unexpected extra request: ${url.pathname}${url.search}`);
    });

    const apps: PlatformAppDeclaration[] = [{
      id: "ontology",
      label: "Ontology manager",
      icon: "ontology",
      category: "build",
      prefix: "/ontology",
      framePanelId: ontologyFrame.id,
      groups: [],
    }];
    useApplicationCatalog().applications.value = [{
      id: "ontology",
      kind: "native",
      rail: "apps",
      category: "build",
      sort: 10,
      names: { en: "Ontology manager" },
      descriptions: {},
      icon: "ontology",
      entry: { path: "/ontology", renderer: "ontology" },
      scheduleAdapter: null,
      releaseId: null,
      framePanelId: ontologyFrame.id,
      allowStandalone: false,
      panelUses: [objectsUse, relationsUse],
    }];

    // Route is already registered (warm navigation), so panelEntryGuard does not pre-open it.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        ...platformRoutes.layout,
        component: RouterView,
        children: [{
          path: "/ontology/objects",
          component: PanelApplicationRoute,
          props: { applicationId: "ontology" },
        }],
      }],
    });
    await router.push("/ontology/objects");
    const wrapper = mount(defineComponent({
      setup() {
        const framed = provideApplicationFrame();
        return () => h(PlatformLayout, {
          apps,
          shownPage: null,
          account: null,
          preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
          labels: layoutLabels,
          pageActions: null,
          appFramed: framed.value,
        });
      },
    }), { global: { plugins: [router, workbenchI18n()] } });

    try {
      await nextTick();
      await flushPromises();

      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fontology%2Fobjects"]);
      expect(mountedHosts.filter((item) => item.kind === "frame").map((item) => item.panelId)).toEqual([ontologyFrame.id]);
      expect(mountedHosts.filter((item) => item.kind === "content").map((item) => item.panelId)).toEqual([objectsPanel.id]);
    } finally {
      wrapper.unmount();
    }
  });

  it("shares the guarded native route opening response with PlatformLayout and ApplicationFrameHost using the real non-native anchor use", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        return Response.json(openResponse("operations", opsTestNativeUse, {
          framePanelId: opsFrame.id,
          frame: opsFrame,
          content: null,
          allowStandalone: false,
          names: { en: "Operations diagnosis" },
          panelUses: [opsDiagnosisUse, opsTestNativeUse],
        }));
      }
      throw new Error(`Unexpected extra request: ${url.pathname}${url.search}`);
    });

    const apps: PlatformAppDeclaration[] = [{
      id: "operations",
      label: "Operations diagnosis",
      icon: "diagnosis",
      category: "admin",
      prefix: "/ops",
      framePanelId: opsFrame.id,
      allowStandalone: false,
      groups: [],
    }];

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        ...platformRoutes.layout,
        component: RouterView,
        children: [{
          path: "/ops/test",
          meta: { ownHeader: true, entryPath: "/ops/test" },
          component: defineComponent({ render: () => h("div", { class: "native-autotest" }, "autotest") }),
        }],
      }],
    });
    installCatalogueEntryGuard(router);

    await router.push("/ops/test?standalone=1");
    const wrapper = mount(defineComponent({
      setup() {
        return () => h(PlatformLayout, {
          apps,
          shownPage: { title: "Test Execution", ownHeader: true },
          account: null,
          preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
          labels: layoutLabels,
          pageActions: null,
        });
      },
    }), { global: { plugins: [router, workbenchI18n()] } });

    try {
      await flushPromises();

      // Single application-entry call from guard; zero extra panel/snapshot/catalog fetches.
      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fops%2Ftest"]);
      expect(wrapper.find(".platform-rail").exists()).toBe(true);
      expect(router.currentRoute.value.query.standalone).toBeUndefined();
      expect(wrapper.find(".native-autotest").exists()).toBe(true);

      // Frame uses the real non-native entry from menu.panelUses (`ops-diagnosis`) and bundled frame definition.
      const frameHosts = mountedHosts.filter((item) => item.kind === "frame");
      expect(frameHosts).toHaveLength(1);
      expect(frameHosts[0]).toMatchObject({
        panelId: opsFrame.id,
        useId: opsDiagnosisUse.id,
        currentEntry: {
          applicationId: "operations",
          useId: opsTestNativeUse.id,
          pageKey: opsTestNativeUse.pageKey,
          kind: "native",
          path: "/ops/test",
        },
        reconciled: true,
      });
    } finally {
      wrapper.unmount();
    }
  });

  it("mounts a cold native detail route and a frame-conversation route directly from the single opening response without catalog fetches", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === "/api/product-panels/application-entry") {
        const path = url.searchParams.get("path");
        if (path === "/ops/test") {
          return Response.json(openResponse("operations", opsTestNativeUse, {
            framePanelId: opsFrame.id,
            frame: opsFrame,
            content: null,
            allowStandalone: true,
            names: { en: "Operations diagnosis" },
            panelUses: [opsTestNativeUse],
          }));
        }
        if (path === "/ops/diagnosis") {
          return Response.json(openResponse("operations", opsDiagnosisUse, {
            framePanelId: opsFrame.id,
            frame: opsFrame,
            content: null,
            allowStandalone: false,
            names: { en: "Operations diagnosis" },
            panelUses: [opsDiagnosisUse, opsTestNativeUse],
          }));
        }
      }
      throw new Error(`Unexpected extra request: ${url.pathname}${url.search}`);
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          ...platformRoutes.layout,
          component: RouterView,
          children: [{
            path: "/ops/test/:runId",
            meta: { ownHeader: true, page: "/ops/test", entryPath: "/ops/test" },
            component: defineComponent({ render: () => h("div", { class: "native-detail" }, "detail") }),
          }],
        },
        unknownAddressRoute,
      ],
    });
    installCatalogueEntryGuard(router);
    router.beforeEach(panelEntryGuard(router));

    // 1. Cold standalone native detail route with empty apps list mounts outer frame from routeOpened.
    await router.push("/ops/test/run-1?standalone=1");
    const wrapper = mount(defineComponent({
      setup() {
        const framed = provideApplicationFrame();
        return () => h(PlatformLayout, {
          apps: [],
          shownPage: { title: "Test Execution", ownHeader: true },
          account: null,
          preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
          labels: layoutLabels,
          pageActions: null,
          appFramed: framed.value,
        });
      },
    }), { global: { plugins: [router, workbenchI18n()] } });

    try {
      await flushPromises();
      expect(requests).toEqual(["/api/product-panels/application-entry?path=%2Fops%2Ftest"]);
      expect(wrapper.find(".platform-rail").exists()).toBe(false);
      expect(wrapper.find(".native-detail").exists()).toBe(true);
      expect(mountedHosts.filter((item) => item.kind === "frame")).toHaveLength(1);
      expect(mountedHosts[0]).toMatchObject({
        panelId: opsFrame.id,
        label: "Operations diagnosis",
        currentEntry: {
          applicationId: "operations",
          useId: opsTestNativeUse.id,
          pageKey: opsTestNativeUse.pageKey,
          kind: "native",
          path: "/ops/test",
        },
        reconciled: true,
      });

      // 2. Switching within the same app to a frame-conversation route reuses the outer frame and leaves standalone mode.
      await router.push("/ops/diagnosis");
      await flushPromises();
      expect(requests).toEqual([
        "/api/product-panels/application-entry?path=%2Fops%2Ftest",
        "/api/product-panels/application-entry?path=%2Fops%2Fdiagnosis",
      ]);
      expect(wrapper.find(".platform-rail").exists()).toBe(true);
      expect(mountedHosts.filter((item) => item.kind === "frame")).toHaveLength(1);
      expect(mountedHosts.filter((item) => item.kind === "content")).toHaveLength(0);
    } finally {
      wrapper.unmount();
    }
  });
});
