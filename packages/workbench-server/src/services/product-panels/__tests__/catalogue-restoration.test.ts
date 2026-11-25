vi.mock("../../product-governance/authorization", async original => ({
  ...await original<typeof import("../../product-governance/authorization")>(),
  requireObject: vi.fn(),
}));
import { beforeAll, expect, it, vi } from "vitest";
import { applicationCatalogueRecordSchema } from "@ontomato/contracts/application-catalogue";
import { panelFormDescriptionSchema, panelRecordListSchema, panelRecordQuerySchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { backendGet } from "../../../utils/backend-client";
import { readProductGrantRecords } from "../../product-governance/grants";
import { createApplicationReadAdapter, toApplicationPanelRecord } from "../application-catalogue";
import { currentProductGrants, currentProductUsedBy, listCurrentProducts } from "../catalog";
import { createProductProjectionReadAdapter, toProductProjectionPanelRecord } from "../catalog-reads";
import { readCurrentProjection } from "../current";

vi.mock("../component-catalogue", () => ({
  readAuthorComponentCatalogue: async () => new Map([["@ontomato/sdk:Example", {
    label: "Example",
    declaration: {
      componentId: "Example",
      data: {},
      config: [
        { name: "showHeading", type: "boolean", required: false, description: "Show the heading." },
        { name: "pageSize", type: "number", required: false, description: "Rows per page." },
        { name: "layout", type: '"table" | "cards"', required: true, description: "Display style." },
      ],
    },
  }]]),
}));
vi.mock("../../product-governance/grants", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../product-governance/grants")>(),
  readProductGrantRecords: vi.fn(),
}));
vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../utils/backend-client")>(),
  backendGet: vi.fn(),
}));
vi.mock("../catalog", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog")>(),
  listCurrentProducts: vi.fn(),
  currentProductUsedBy: vi.fn(),
  currentProductGrants: vi.fn(),
}));
vi.mock("../current", async (importOriginal) => ({
  ...await importOriginal<typeof import("../current")>(),
  readCurrentProjection: vi.fn(),
}));

const owner = { domainId: "domain", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      fr: { ...enLocaleMeta, messages: {
        "panels.productCatalog.application.source": "Origine",
        "panels.productCatalog.application.builtin": "Intégrée",
        "panels.productCatalog.application.readOnly": "Lecture seule",
      } },
    },
  });
});

it("refreshes the projection form from the component's typed configuration and preserves existing custom values", async () => {
  const adapter = createProductProjectionReadAdapter(owner, viewer);
  const form = await adapter.createForm({
    values: { componentId: "@ontomato/sdk:Example", config: { custom: { untouched: true } } },
    changedField: "/componentId",
  });

  const checked = panelFormDescriptionSchema.parse(form);
  const field = (path: string) => checked.fields.find(item => item.path === path);
  expect(field("/componentId")).toMatchObject({ refreshOnChange: true });
  expect(field("/config/showHeading")).toMatchObject({ control: { kind: "switch" }, required: false });
  expect(field("/config/pageSize")).toMatchObject({ control: { kind: "number" } });
  expect(field("/config/layout")).toMatchObject({
    control: { kind: "select", options: [{ value: "table" }, { value: "cards" }] }, required: true,
  });
  expect(field("/config/custom")).toMatchObject({ control: { kind: "code" } });
  expect(checked.values.config).toEqual({ custom: { untouched: true } });
});

it("forwards application catalogue sorting and its opaque cursor to Java", async () => {
  vi.mocked(backendGet).mockResolvedValueOnce({
    text: JSON.stringify({ success: true, data: { rows: [] } }),
  } as Awaited<ReturnType<typeof backendGet>>);

  const adapter = createApplicationReadAdapter(owner, viewer);
  await adapter.query({ sort: "name", cursor: "name-en.app-example.QWxwaGE" });
  const request = new URL(vi.mocked(backendGet).mock.lastCall![1], "http://localhost");
  expect(request.pathname).toBe("/platform/applications/catalogue");
  expect(request.searchParams.get("sort")).toBe("name");
  expect(request.searchParams.get("cursor")).toBe("name-en.app-example.QWxwaGE");
});

it("gets application grants only for an application whose owner allows edit, with domain sharing from its use grant", async () => {
  const row = {
    id: "app-grants", names: { en: "Application" }, descriptions: { en: "" }, icon: "layout-grid",
    source: "domain", canMaintain: true, canGrant: false, canEditEntries: true, entryCount: 0,
    entry: { path: "/applications/app-grants" }, panelUses: [], groups: [],
  };
  const response = (canGrant: boolean) => ({
    text: JSON.stringify({ success: true, data: { ...row, canGrant } }),
  } as Awaited<ReturnType<typeof backendGet>>);
  vi.mocked(backendGet).mockResolvedValueOnce(response(false)).mockResolvedValueOnce(response(true));
  const grants = [
    { principalKind: "role", principalId: "reader", verb: "use" },
    { principalKind: "domain", principalId: "*", verb: "use" },
  ] as const;
  vi.mocked(readProductGrantRecords).mockResolvedValueOnce({ grants: [...grants] });

  const adapter = createApplicationReadAdapter(owner, viewer);
  await expect(adapter.grants(row.id)).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(readProductGrantRecords).not.toHaveBeenCalled();
  await expect(adapter.grants(row.id)).resolves.toEqual({ grants, shared: true });
  expect(readProductGrantRecords).toHaveBeenCalledWith(row.id, viewer);
});


const applicationSummary = {
  id: "app-public",
  names: { en: "Public app", fr: "Appli publique" },
  descriptions: { en: "Public description", fr: "Description publique" },
  icon: "layout-grid",
  source: "builtin" as const,
  canMaintain: false,
  canEditEntries: false,
  canGrant: false,
  entryCount: 3,
};

it("maps a Java catalogue row to typed fields with localized display values and stable capability facts", () => {
  const row = panelRecordSchema.parse(toApplicationPanelRecord(applicationSummary, "fr"));
  expect(row).toMatchObject({
    primaryKey: "app-public", className: "platform:Application",
    label: "Appli publique", subtitle: "Description publique",
    fields: {
      names: { kind: "localized", values: applicationSummary.names },
      descriptions: { kind: "localized", values: applicationSummary.descriptions },
      icon: "layout-grid", entryCount: 3, canMaintain: false, canEditEntries: false, canGrant: false,
      sourceKind: "builtin", source: "Intégrée", maintenance: "Lecture seule",
    },
    fieldLabels: { source: "Origine" },
    tones: { source: "info", maintenance: "info" },
  });
  expect(row.fields).not.toHaveProperty("path");
  expect(row.fieldLabels).not.toHaveProperty("canGrant");
});

it("omits unprovided detail fields and preserves a frame panel as a typed reference", () => {
  const legacy = applicationCatalogueRecordSchema.parse({
    ...applicationSummary,
    names: { en: "Legacy app" }, descriptions: { en: "" },
    entry: { path: "/applications/app-public" }, groups: [], panelUses: [],
  });
  const row = panelRecordSchema.parse(toApplicationPanelRecord(legacy, "fr"));
  expect(row.label).toBe("Legacy app");
  expect(row).not.toHaveProperty("subtitle");
  expect(row.fields).toMatchObject({ path: legacy.entry.path });
  expect(row.fields).not.toHaveProperty("home");
  expect(row.fields).not.toHaveProperty("renderer");
  expect(row.fields).not.toHaveProperty("framePanel");

  const panels = applicationCatalogueRecordSchema.parse({
    ...legacy, source: "domain", canMaintain: true, canEditEntries: true, canGrant: true,
    entry: { ...legacy.entry, renderer: "panels", home: "/applications/app-public/start", entryKey: "start" },
    framePanelId: "frame-panel",
  });
  expect(panelRecordSchema.parse(toApplicationPanelRecord(panels, "en"))).toMatchObject({
    fields: {
      home: "/applications/app-public/start", renderer: "panels",
      framePanel: { kind: "reference", className: "platform:ProductPanel", primaryKey: "frame-panel", label: "frame-panel" },
      canMaintain: true, canEditEntries: true, canGrant: true,
    },
    tones: { maintenance: "success" },
  });
});

it("maps projection summaries and details to standard PanelRecord records with outputs and sub-tables", async () => {
  const sampleProjection = {
    id: "proj-sample",
    domainId: "domain",
    ownerId: "user-1",
    name: "Orders list",
    description: "Lists customer orders",
    visibility: "domain" as const,
    revision: 3,
    createdAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T10:00:00.000Z",
    editable: true,
    componentId: "@ontomato/sdk:Example",
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType" as const, id: "platform:Application" } },
        read: "query",
        params: { scope: { input: "scope" }, size: { literal: 20 } },
      },
    },
    config: { layout: "table", pageSize: 20 },
    inputs: { scope: { kind: "scalar" as const, type: "string" as const } },
    outputs: { selected: { kind: "object" as const, objectType: "platform:Application" } },
    operations: {
      approve: {
        operation: { kind: "Action" as const, id: "approve-order" },
        target: { input: "selected" },
      },
    },
  };

  const summary = panelRecordSchema.parse(toProductProjectionPanelRecord({
    id: sampleProjection.id,
    ownerId: sampleProjection.ownerId,
    name: sampleProjection.name,
    description: sampleProjection.description,
    visibility: sampleProjection.visibility,
    revision: sampleProjection.revision,
    updatedAt: sampleProjection.updatedAt,
    editable: sampleProjection.editable,
    componentId: sampleProjection.componentId,
  }, "en", { ownerLabel: "Alice", componentLabel: "Example" }));
  expect(summary).toMatchObject({
    primaryKey: "proj-sample",
    className: "platform:ProductProjection",
    label: "Orders list",
    subtitle: "Lists customer orders",
    fields: {
      component: "Example",
      owner: "Alice",
      scope: "Domain shared",
      access: "Editable",
      revision: 3,
      updatedAt: "2026-11-23T10:00:00.000Z",
    },
    tones: { scope: "success", access: "success", projectionKind: "info" },
  });
  expect(summary.outputs).toBeUndefined();

  vi.mocked(listCurrentProducts).mockResolvedValueOnce({
    items: [{
      id: sampleProjection.id,
      ownerId: null,
      name: sampleProjection.name,
      description: sampleProjection.description,
      visibility: "platform",
      revision: 1,
      updatedAt: sampleProjection.updatedAt,
      editable: false,
      componentId: sampleProjection.componentId,
    }],
    nextCursor: "cursor-2",
    total: 5,
  });
  const adapter = createProductProjectionReadAdapter(owner, viewer);
  const queryResult = panelRecordQuerySchema.parse(await adapter.query({ search: "Orders", scope: "all", sort: "updated" }));
  expect(queryResult).toMatchObject({
    total: 5,
    nextCursor: "cursor-2",
    rows: [expect.objectContaining({
      primaryKey: "proj-sample",
      fields: expect.objectContaining({ owner: "Platform", scope: "Built in", access: "Read only" }),
    })],
  });

  vi.mocked(readCurrentProjection).mockResolvedValue(sampleProjection);
  vi.mocked(currentProductGrants).mockResolvedValue({
    grants: [{ policyId: "policy-edit", name: "Editors", verb: "EDIT" }],
    shared: true,
  });
  vi.mocked(currentProductUsedBy).mockResolvedValue({
    panels: [{ id: "panel-orders", name: "Orders page" }],
    hiddenCount: 2,
  });

  const detail = panelRecordSchema.parse(await adapter.record("proj-sample"));
  expect(detail).toMatchObject({
    primaryKey: "proj-sample",
    label: "Orders list",
    fields: {
      component: { kind: "reference", className: "platform:SDKComponent", primaryKey: "@ontomato/sdk:Example", label: "Example" },
      domainShared: true,
    },
    outputs: {
      canEdit: true,
      canGrant: true,
      canDelete: true,
      canCopy: true,
      isBuiltin: false,
      isChart: false,
      domainShared: true,
      revision: 3,
      usedByCount: 3,
      hiddenUsedByCount: 2,
    },
  });

  const usedByRows = panelRecordListSchema.parse(await adapter.usedByRows("proj-sample"));
  expect(usedByRows).toEqual([expect.objectContaining({
    primaryKey: "panel-orders",
    className: "platform:ProductPanel",
    label: "Orders page",
    fields: {
      id: "panel-orders",
      panel: { kind: "reference", className: "platform:ProductPanel", primaryKey: "panel-orders", label: "Orders page" },
    },
  })]);

  const grantRows = panelRecordListSchema.parse(await adapter.grantRows("proj-sample"));
  expect(grantRows).toHaveLength(2);
  expect(grantRows.find(row => row.primaryKey === "domain")).toMatchObject({ fields: { verb: "USE", revocable: false } });
  expect(grantRows.find(row => row.primaryKey === "policy-edit:EDIT")).toMatchObject({ label: "Editors", fields: { policyId: "policy-edit", verb: "EDIT", revocable: true } });

  const dataRows = panelRecordListSchema.parse(await adapter.dataRows("proj-sample"));
  expect(dataRows).toEqual([expect.objectContaining({
    primaryKey: "rows",
    fields: expect.objectContaining({
      source: { kind: "reference", className: "platform:OntologyType", primaryKey: "platform:Application", label: "Platform type · platform:Application" },
      read: "query",
    }),
  })]);

  const configRows = panelRecordListSchema.parse(await adapter.configRows("proj-sample"));
  expect(configRows.map(row => [row.primaryKey, row.fields.value])).toEqual([["layout", "table"], ["pageSize", "20"]]);

  const inputRows = panelRecordListSchema.parse(await adapter.inputRows("proj-sample"));
  expect(inputRows).toEqual([expect.objectContaining({ primaryKey: "scope", fields: { portType: "Scalar · string" } })]);

  const outputRows = panelRecordListSchema.parse(await adapter.outputRows("proj-sample"));
  expect(outputRows).toEqual([expect.objectContaining({ primaryKey: "selected", fields: { portType: "Object · platform:Application" } })]);

  const operationRows = panelRecordListSchema.parse(await adapter.operationRows("proj-sample"));
  expect(operationRows).toEqual([expect.objectContaining({
    primaryKey: "approve",
    fields: {
      operation: { kind: "reference", className: "platform:Action", primaryKey: "approve-order", label: "Action · approve-order" },
      target: "Input 'selected'",
    },
  })]);
});

it("builds local referenceGraph payload for an application with its entry panels (AP-08)", async () => {
  const row = {
    id: "app-graph-demo",
    names: { en: "Graph Demo App" },
    descriptions: { en: "" },
    icon: "layout-grid",
    source: "domain" as const,
    canMaintain: true,
    canGrant: true,
    canEditEntries: true,
    entryCount: 1,
    entry: { path: "/applications/app-graph-demo" },
    framePanelId: "panel-frame",
    panelUses: [{
      id: "use-1",
      pageKey: "orders",
      panelId: "panel-orders",
      path: "/orders",
      access: { kind: "domain-member" as const },
      names: { en: "Orders" },
    }],
    groups: [],
  };
  vi.mocked(backendGet).mockResolvedValueOnce({
    text: JSON.stringify({ success: true, data: row }),
  } as Awaited<ReturnType<typeof backendGet>>);
  vi.mocked(listCurrentProducts)
    .mockResolvedValueOnce({ items: [{ id: "panel-frame", name: "Frame" }, { id: "panel-orders", name: "Orders page" }] } as never)
    .mockResolvedValueOnce({ items: [] } as never);
  const adapter = createApplicationReadAdapter(owner, viewer);
  const graphRecord = panelRecordSchema.parse(await adapter.referenceGraph(row.id));
  const graph = (graphRecord.fields.graph as { kind: "json"; value: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> } }).value;
  expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
    "asset:app-graph-demo",
    "asset:panel-frame",
    "asset:panel-orders",
  ]));
  expect(graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "asset:app-graph-demo", target: "asset:panel-frame" }),
    expect.objectContaining({ source: "asset:app-graph-demo", target: "asset:panel-orders" }),
  ]));
});
