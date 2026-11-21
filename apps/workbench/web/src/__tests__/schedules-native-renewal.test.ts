import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import source from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.json";
import html from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.html?raw";
import module from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.mjs?raw";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot } from "./panel-frame";

const application = catalogFixture().find(app => app.id === "schedules")!;
const use = application.panelUses![0]!;
const id = "00000000-0000-4000-8000-000000000001";
const operationId = "renew.renewCredential";
const target = { kind: "object", objectType: "platform:Application", primaryKey: "schedules" };
const objectTypes = Object.fromEntries(Object.entries(platformObjectTypes).map(([type, entry]) => [
  type,
  platformTypeTableEntrySchema.parse({ ...entry, operations: entry.operations?.map(id => {
    const form = id === "platform:ScheduledTask.save" || id === "platform:ScheduledTask.create";
    return {
      id, kind: form ? "form.save" : "action", effect: "write", batch: false, inputSchema: {},
      target: form ? { source: "draft" } : { source: "input", input: type === "platform:Application" ? "application" : "task" },
    };
  }) }),
]));
const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map(component => ({ ...component, ports: { props: [], events: [], slots: [] } }));
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(Object.entries(authoring).map(([name, definition]) => {
  if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
  const { projection, placement } = expandPanelAuthoringMember(name, definition, { state: manifest.state, typeTable: { objectTypes }, components: catalogue });
  projections.set(definition.id!, {
    ...projection, id: definition.id!, name, description: name, visibility: "platform",
    domainId: null, ownerId: null, editable: false, revision: 1,
    createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z",
  });
  return [name, { ...placement, target: { projectionId: definition.id! } }];
}));
const panel = {
  ...panelRecord(use.panelId, "Scheduled tasks", definePanel({ ...manifest, members })),
  visibility: "platform" as const, domainId: null, ownerId: null, editable: false as const,
  content: { html, module, messages: source.content.messages },
};

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
});

it.each([false, true])("opens the native schedule panel when renewal fails: %s", async (refused) => {
  const sent = installPlatform(request => {
    const { path } = request;
    if (path === "/api/data-query/platform/applications/schedules/panel-uses")
      return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, Object.fromEntries(projections), request);
    if (path.startsWith("/api/product-projections/")) return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) return Response.json({ status: "ready", value: body.memberPath[0].member === "renew" ? {
        renewCredential: {
          kind: "action", label: "Renew background credential", handlerRef: "schedules.renewCredential",
          effect: "write", batch: false, target: { source: "input", input: "application" }, inputSchema: {}, resultSchema: {},
        },
      } : {} });
      return Response.json({ status: "empty" });
    }
    if (path === "/api/panel-operations/intents") {
      if (refused) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Credential service unavailable" } }, { status: 503 });
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    }
    if (path === `/api/panel-operation-intents/${id}`)
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    if (path === `/api/panel-operations/intents/${id}/dispatch`)
      return Response.json({ kind: "dispatched", intentId: id, outcome: { kind: "success", data: {} } });
    return nothingAt(request);
  });
  useApplicationCatalog().applications.value = catalogFixture();
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { ...platformRoutes.layout, component: RouterView, children: [] }, unknownAddressRoute,
  ] });
  router.beforeEach(panelEntryGuard(router));
  await router.push("/schedules");
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
      path: "/api/panel-operations/intents",
      body: { applicationId: "schedules", useId: use.id, operationId, call: { target, input: {} } },
    })), { timeout: 5000 });
    if (refused)
      await vi.waitFor(() => expect(element.querySelector(".schedules [role=alert]")?.textContent).toContain("Credential service unavailable"));
    else
      await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ path: `/api/panel-operations/intents/${id}/dispatch` })));
    expect(element.querySelector(".schedules .toolbar")).not.toBeNull();
  } finally {
    app.unmount();
  }
});
