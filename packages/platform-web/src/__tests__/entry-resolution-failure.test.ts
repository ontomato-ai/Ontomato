import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { ApiRequestError } from "@ontomato/workbench-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { resetEntryResolutionFailures, entryResolutionFailureFor } from "../entry-resolution-failure";

const resolveApplicationEntryMock = vi.fn();
const ensureCatalogMock = vi.fn(async () => {});
const ensureApplicationMock = vi.fn();
const catalogApplications = ref<Array<Record<string, unknown>>>([]);

vi.mock("../panel-host", () => ({
  resolveApplicationEntry: (query: { path?: string }) => resolveApplicationEntryMock(query),
}));
vi.mock("../catalog", () => ({
  useApplicationCatalog: () => ({
    ensureCatalog: ensureCatalogMock,
    ensureApplication: ensureApplicationMock,
    mergedApplications: catalogApplications,
  }),
}));
vi.mock("../shell", () => ({
  startPage: () => ({ path: platformRoutes.ontology.path }),
}));

const { panelEntryGuard, addressLandingGuard, unknownAddressRoute } = await import("../panel-entries");
const EntryResolutionFailure = (await import("../EntryResolutionFailure.vue")).default;

function routerWithGuards(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        ...platformRoutes.layout,
        component: { render: () => h(RouterView) },
        children: [
          { ...platformRoutes.ontology, component: { render: () => null } },
          unknownAddressRoute,
        ],
      },
    ],
  });
  router.beforeEach(panelEntryGuard(router));
  router.beforeResolve(addressLandingGuard(router));
  return router;
}

function resolution(path: string) {
  const use = { id: "use-a", pageKey: "page-a", path, panelId: "panel-a", names: { en: "Page A" } };
  return {
    applicationId: "app-a",
    use,
    allowStandalone: true,
    frame: null,
    content: null,
    menu: { singleEntry: true, groups: [], panelUses: [use] },
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetEntryResolutionFailures();
  resolveApplicationEntryMock.mockReset();
  ensureCatalogMock.mockClear();
  ensureApplicationMock.mockReset();
  catalogApplications.value = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEntryResolutionFailures();
});

describe("entry resolution failure handling", () => {
  it("keeps an unknown address in place on an entry read failure instead of redirecting to another application", async () => {
    resolveApplicationEntryMock.mockRejectedValue(new Error("entry service unavailable"));
    const router = routerWithGuards();

    await router.push("/broken-entry");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/broken-entry");
    expect(router.currentRoute.value.name).toBe(platformRoutes.unknown.name);
    expect(entryResolutionFailureFor("/broken-entry")).toContain("entry service unavailable");
    expect(console.error).toHaveBeenCalled();

    const view = mount(EntryResolutionFailure, {
      global: {
        plugins: [router, createI18n({
          legacy: false,
          locale: "en",
          messages: { en: { platform: { entryReadFailed: "The entry for this address could not be read" } } },
        })],
      },
    });
    expect(view.get("[role=alert]").text()).toContain("entry service unavailable");
    view.unmount();
  });

  it("keeps the old no-entry path for a 404", async () => {
    resolveApplicationEntryMock.mockRejectedValue(new ApiRequestError("not found", 404));
    const router = routerWithGuards();

    await router.push("/missing-entry");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe(platformRoutes.ontology.path);
    expect(entryResolutionFailureFor("/missing-entry")).toBeNull();
  });

  it("clears the scoped failure after the same address resolves successfully", async () => {
    resolveApplicationEntryMock.mockRejectedValueOnce(new Error("entry service unavailable"));
    const router = routerWithGuards();
    await router.push("/late-entry");
    await router.isReady();
    expect(entryResolutionFailureFor("/late-entry")).toContain("entry service unavailable");

    resolveApplicationEntryMock.mockResolvedValue(resolution("/late-entry"));
    await router.push(platformRoutes.ontology.path);
    await router.push("/late-entry");
    await router.isReady();

    expect(entryResolutionFailureFor("/late-entry")).toBeNull();
    expect(router.currentRoute.value.path).toBe("/late-entry");
    expect(router.currentRoute.value.name).not.toBe(platformRoutes.unknown.name);
  });

  it("stops trying later landing candidates when the first candidate's detail read fails", async () => {
    const ontology = { id: "ontology", ownerService: "data-engine", rail: "top", entry: { path: "/ontology", renderer: "ontology" } };
    const settings = { id: "settings", ownerService: "data-engine", rail: "top", entry: { path: "/settings", renderer: "settings" } };
    catalogApplications.value = [ontology, settings];
    ensureApplicationMock.mockImplementation(async (id: string) => {
      if (id === "ontology") throw new Error("detail service unavailable");
      return { ...settings, panelUses: [{ id: "use-settings", pageKey: "settings", path: "/settings/audit", panelId: "panel-settings" }] };
    });
    const router = routerWithGuards();

    await router.push(platformRoutes.ontology.path);
    await router.isReady();

    expect(router.currentRoute.value.path).toBe(platformRoutes.ontology.path);
    expect(ensureApplicationMock).toHaveBeenCalledTimes(1);
    expect(ensureApplicationMock).toHaveBeenCalledWith("ontology");
    expect(entryResolutionFailureFor(platformRoutes.ontology.path)).toContain("detail service unavailable");
  });
});
