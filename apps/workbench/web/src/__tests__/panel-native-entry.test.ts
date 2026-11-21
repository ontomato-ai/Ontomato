import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { addressLandingGuard, panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import { startPage } from "../../../../../packages/platform-web/src/shell";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, type Sent } from "./panel-frame";

/*
 * A native built-in application's panel entry at its original address (big main's ruling, 2026-11-21: one panel route
 * serves every declared entry, whatever its prefix): `/ontology/components`, declared by the ontology manager with its
 * own permission code, opens its panel through the panel route, inside the platform's layout; a reader the catalog does
 * not list the entry for — it lacks the code — goes where any address no page serves goes.
 *
 * Real guard, route, panel host and SDK; the catalog and the network are stand-ins.
 *
 * What this rules out: a built-in application's entry that no route opens because only `/applications/…` addresses reach
 * the panel route, and an entry opened for a reader its access does not admit.
 */

const panel = panelRecord("builtin-components", "Base components", definePanel({ state: {}, members: {}, events: {} }));
const components: ApplicationPanelUse = {
  id: "use-components", pageKey: "ontology-components", panelId: panel.id, path: "/ontology/components",
  access: { permissionCode: "ontology-modeling" }, names: { en: "Base components" },
};

/** The ontology manager in the catalog, with the entries this reader may open. */
function catalogWith(panelUses: ApplicationPanelUse[]) {
  return catalogFixture().map((app) => app.id === "ontology" ? { ...app, panelUses } : app);
}

function answer(request: Sent) {
  if (request.path === "/api/data-query/platform/applications/ontology/panel-uses")
    return Response.json({ data: { applicationId: "ontology", entry: { path: "/ontology", renderer: "ontology" }, panelUses: [components] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  return nothingAt(request);
}

/** The platform's router as far as entries go: its layout, a page of its own, and the catch-all. */
async function open(address: string, landing = "/home") {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    // The root lands where the deployment's start page says, as the platform's layout route does.
    { ...platformRoutes.layout, component: RouterView, redirect: () => startPage(), children: [
      { path: "/home", component: { render: () => h("p", { class: "home" }, "Home") } },
      // Where the platform's page guard sends a reader whose landing they may not open: their first page, the home here.
      { ...platformRoutes.ontology, redirect: landing },
    ] },
    unknownAddressRoute,
  ] });
  router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));
  router.beforeEach(panelEntryGuard(router));
  router.beforeResolve(addressLandingGuard(router));
  await router.push(address);
  return { router, ...mountPlatformPage(() => h(RouterView), router) };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  window.__APP_CONFIG__ = {};
});

it("opens a built-in application's entry at its original address, through the panel route", async () => {
  installPlatform(answer);
  useApplicationCatalog().applications.value = catalogWith([components]);
  const { router, app, element } = await open("/ontology/components");
  try {
    expect(router.currentRoute.value.path).toBe("/ontology/components");
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded")).not.toBeNull());
  } finally {
    app.unmount();
  }
});

it("goes where an address no page serves goes for a reader the entry does not admit", async () => {
  installPlatform(answer);
  // The catalog lists only the entries the reader may open: without the code, this one is not there.
  useApplicationCatalog().applications.value = catalogWith([]);
  const { router, app, element } = await open("/ontology/components");
  try {
    expect(router.currentRoute.value.path).toBe("/home");
    expect(element.querySelector(".home")).not.toBeNull();
  } finally {
    app.unmount();
  }
});

it("lands at a start page a panel has taken over, and home for a reader that entry does not admit, never in a loop", async () => {
  installPlatform(answer);
  // A deployment whose start page is an address a panel now serves (an old Manager's default landing).
  window.__APP_CONFIG__ = { INITIAL_ROUTE: "/ontology/components" };
  useApplicationCatalog().applications.value = catalogWith([components]);
  const admitted = await open("/");
  try {
    expect(admitted.router.currentRoute.value.path).toBe("/ontology/components");
  } finally {
    admitted.app.unmount();
  }

  useApplicationCatalog().applications.value = catalogWith([]);
  const refused = await open("/");
  try {
    expect(refused.router.currentRoute.value.path).toBe("/home");
  } finally {
    refused.app.unmount();
  }
});

it("goes home when the landing picks back the very address nothing serves for this reader, never round again", async () => {
  installPlatform(answer);
  window.__APP_CONFIG__ = { INITIAL_ROUTE: "/ontology/components" };
  // The page guard's choice disagrees with the catalog: it lands the reader on the entry their catalog does not offer.
  useApplicationCatalog().applications.value = catalogWith([]);
  const { router, app } = await open("/ontology/components", "/ontology/components");
  try {
    expect(router.currentRoute.value.path).toBe("/home");
  } finally {
    app.unmount();
  }
});


it.each([
  ["ontology", "/ontology/agents", "ontology-modeling"],
  ["agents", "/agents/settings", "analysis-agent"],
])("mounts the shared settings panel at the original %s address", async (applicationId, path, permissionCode) => {
  const catalog = catalogFixture();
  const application = catalog.find(app => app.id === applicationId)!;
  const use = application.panelUses?.find(entry => entry.path === path);
  expect(use).toMatchObject({ panelId: "builtin-product-agent-settings", access: { permissionCode } });
  const panel = {
    ...panelRecord(use!.panelId, "Agent settings", definePanel({
      state: {
        selected: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true },
        mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
      },
      members: {}, events: {},
    })),
    visibility: "platform" as const, domainId: null, ownerId: null, editable: false as const,
  };
  const sent = installPlatform(request => {
    if (request.path === `/api/data-query/platform/applications/${applicationId}/panel-uses`)
      return Response.json({ data: { applicationId, entry: application.entry, panelUses: [use] } });
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
    return nothingAt(request);
  });
  useApplicationCatalog().applications.value = catalog;
  const { router, app, element } = await open(`${path}/new`);
  try {
    expect(router.currentRoute.value.path).toBe(path);
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded")).not.toBeNull());
    const query = new URLSearchParams(sent.find(request => request.path === `/api/product-panels/${panel.id}`)?.search);
    expect(query.get("applicationId")).toBe(applicationId);
    expect(query.get("useId")).toBe(use?.id);
  } finally {
    app.unmount();
  }
});
