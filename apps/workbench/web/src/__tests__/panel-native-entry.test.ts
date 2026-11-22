import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel, panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import settingsHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.html?raw";
import settingsModule from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.mjs?raw";
import settingsSource from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.json";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { addressLandingGuard, panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { panelNavigator } from "../../../../../packages/platform-web/src/panel-navigate";
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

const panel = panelRecord("builtin-components", "Base components", definePanel({ state: {}, members: {}, commands: {} }));
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


it("hands a draft linked at a built-in entry's original address to its panel, past the state the host adds", async () => {
  // A panel with deep-linked state, as business knowledge has (`mode`): the host adds `state` to the address it opens.
  const stated = panelRecord("builtin-components", "Base components", definePanel({
    state: { mode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "view" } }, members: {}, commands: {},
  }));
  const sent = installPlatform((request) => {
    if (request.path === "/api/data-query/platform/applications/ontology/panel-uses")
      return Response.json({ data: { applicationId: "ontology", entry: { path: "/ontology", renderer: "ontology" }, panelUses: [components] } });
    if (request.path === `/api/product-panels/${stated.id}`) return panelAnswer(stated, request);
    if (request.path === `/api/product-panels/${stated.id}/snapshot`) return panelSnapshot(stated, {}, request);
    return nothingAt(request);
  });
  useApplicationCatalog().applications.value = catalogWith([components]);
  const link = { draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/component.page-draft.json" };
  const drafts = () => sent.filter((request) => request.path.endsWith("/page-draft"));

  // Opened with the link and a state, as an address the host has already written its state into.
  const { router, app, element } = await open(`/ontology/components?${new URLSearchParams({ ...link, state: JSON.stringify({ mode: "view" }) })}`);
  try {
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded")).not.toBeNull());
    await vi.waitFor(() => expect(drafts()).toHaveLength(1));
    expect(drafts()[0]!.path).toBe("/api/assistant/sessions/session-1/runs/run-1/page-draft");
    expect(new URLSearchParams(drafts()[0]!.search).get("path")).toBe(link.draftPath);
    // The link stays in the address beside the state.
    expect(router.currentRoute.value.query).toMatchObject(link);
  } finally {
    app.unmount();
  }

  // The same entry opened without a link reads no draft and says nothing about one.
  sent.length = 0;
  const plain = await open("/ontology/components");
  try {
    await vi.waitFor(() => expect(plain.element.querySelector(".panel-host-coded")).not.toBeNull());
    expect(drafts()).toEqual([]);
    expect(plain.element.querySelector(".panel-host-draft")).toBeNull();
  } finally {
    plain.app.unmount();
  }
});

it("reads the catalog once before calling an address a page's code asks for missing", async () => {
  // A page asks from a native start page: nothing has read the catalog yet, so no entry is known.
  installPlatform((request) => {
    if (request.path === "/api/data-query/platform/applications")
      return Response.json({ success: true, data: catalogWith([components]) });
    return answer(request);
  });
  const { router, app } = await open("/home");
  try {
    expect(useApplicationCatalog().applications.value).toEqual([]);
    await panelNavigator(router)("/ontology/components");
    expect(router.currentRoute.value.path).toBe("/ontology/components");
    // Read once for the ask that failed, not for every ask.
    await panelNavigator(router)("/home");
    expect(useApplicationCatalog().applications.value.map((application) => application.id)).toContain("ontology");
  } finally {
    app.unmount();
  }
});

it("lets a page open another page's entry before either has been visited", async () => {
  // The ontology graph's "go to modeling": a panel asks for the address of an entry the reader has not opened yet.
  installPlatform(answer);
  useApplicationCatalog().applications.value = catalogWith([components]);
  const { router, app } = await open("/home");
  try {
    await vi.waitFor(async () => {
      await panelNavigator(router)("/ontology/components");
      expect(router.currentRoute.value.path).toBe("/ontology/components");
    });
    // An address no entry serves is still refused, with the reader told.
    await expect(panelNavigator(router)("/ontology/nothing")).rejects.toThrow(/nothing/);
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
      members: {}, commands: {},
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
    const query = new URLSearchParams(sent.find(request => request.path === `/api/product-panels/${panel.id}/page-skill-context`)?.search);
    expect(query.get("applicationId")).toBe(applicationId);
    expect(query.get("useId")).toBe(use?.id);
  } finally {
    app.unmount();
  }
});


it("explains the missing owner permission to a reader admitted to the ontology settings entry", async () => {
  const catalog = catalogFixture();
  const application = catalog.find(app => app.id === "ontology")!;
  const use = application.panelUses!.find(entry => entry.path === "/ontology/agents")!;
  const { members, ...manifest } = settingsSource.manifest;
  const panel = {
    ...panelRecord(use.panelId, "Agent settings", panelManifestSchema.parse({
      ...manifest,
      members: Object.fromEntries(Object.entries(members).map(([key, { id }]) => [key, { target: { projectionId: id } }])),
    })),
    content: { html: settingsHtml, module: settingsModule, messages: settingsSource.content.messages },
    visibility: "platform" as const, domainId: null, ownerId: null, editable: false as const,
  };
  const list = {
    id: members.list.id, name: "Agent list", description: "", visibility: "platform", domainId: null, ownerId: null,
    editable: false, revision: 1, createdAt: panel.createdAt, updatedAt: panel.updatedAt,
    componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } }, read: "list", params: {} } },
  };
  const revisions = Object.fromEntries(Object.values(members).map(({ id }) => [id, { revision: 1 }]));
  const sent = installPlatform(request => {
    if (request.path === "/api/data-query/platform/applications/ontology/panel-uses")
      return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, revisions, request);
    if (request.path === `/api/product-projections/${list.id}`) return Response.json({ projection: list });
    if (request.path === "/api/product-panels/read") return Response.json({ status: "forbidden" });
    return nothingAt(request);
  });
  useApplicationCatalog().applications.value = catalog.map(app => app.id === "agents" ? { ...app, panelUses: [] } : app);
  const { router, app, element } = await open(use.path);
  try {
    expect(router.currentRoute.value.path).toBe("/ontology/agents");
    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toContain("analysis-agent"));
    expect(sent).toContainEqual(expect.objectContaining({
      path: "/api/product-panels/read", body: expect.objectContaining({
        source: { kind: "registered", applicationId: "ontology", useId: use.id },
        memberPath: [{ member: "list" }], dataName: "rows",
      }),
    }));
    expect(element.textContent).not.toContain("New agent");
  } finally {
    app.unmount();
  }
});

it("opens another built-in application's entry from an entry, and back, without the page being loaded again", { timeout: 20000 }, async () => {
  const catalog = catalogFixture();
  const ontology = catalog.find(app => app.id === "ontology")!;
  const agents = catalog.find(app => app.id === "agents")!;
  const ontologyUse = ontology.panelUses!.find(entry => entry.path === "/ontology/agents")!;
  const agentsUse = agents.panelUses!.find(entry => entry.path === "/agents/settings")!;
  const panel = {
    ...panelRecord(ontologyUse.panelId, "Agent settings", definePanel({ state: {}, members: {}, commands: {} })),
    visibility: "platform" as const, domainId: null, ownerId: null, editable: false as const,
  };
  installPlatform(request => {
    for (const [application, use] of [[ontology, ontologyUse], [agents, agentsUse]] as const)
      if (request.path === `/api/data-query/platform/applications/${application.id}/panel-uses`)
        return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
    return nothingAt(request);
  });
  useApplicationCatalog().applications.value = catalog;
  const { router, app, element } = await open("/ontology/agents");
  try {
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded")).not.toBeNull());
    // Another application's entry, by the address alone (a link, the address bar): its panel is drawn too.
    await router.push("/agents/settings");
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/agents/settings"));
    await vi.waitFor(() => expect(element.querySelectorAll(".panel-host-coded").length).toBe(1), { timeout: 5000 });
    // And back again.
    await router.push("/ontology/agents");
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/ontology/agents"));
    await vi.waitFor(() => expect(element.querySelectorAll(".panel-host-coded").length).toBe(1), { timeout: 5000 });
  } finally {
    app.unmount();
  }
});
