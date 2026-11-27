import { panelOperationImpactSchema } from "@ontomato/contracts/panel-operations";
import { PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import { panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import type { PanelReadBatchCache } from "../member-path";
import type { RegisteredDataReadContext } from "../registered-data-read";
import type { PanelOperationHost } from "../server-operations";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  ranges: vi.fn(),
  decide: vi.fn(),
  retire: vi.fn(),
  panelUsers: vi.fn(),
  panelsUsingProjection: vi.fn(),
  homePanelId: vi.fn(),
  readHomePanel: vi.fn(),
  saveHomePanel: vi.fn(),
}));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: { query: typeof mocks.query }) => unknown) => run({ query: mocks.query }),
}));
vi.mock("../../product-governance/authorization", async original => ({
  ...await original<typeof import("../../product-governance/authorization")>(),
  readObjectRanges: mocks.ranges,
  decideObjects: mocks.decide,
  requireObject: async (request: ObjectDecisionRequest, caller: unknown) => {
    const [decision] = await mocks.decide([request], caller);
    if (!decision.allowed) throw new HttpError(403, decision.reason, decision.code);
  },
  retireObject: mocks.retire,
}));
vi.mock("../used-by", () => ({ panelUsers: mocks.panelUsers, panelsUsingProjection: mocks.panelsUsingProjection }));
vi.mock("../../platform-home/store", () => ({
  platformHomeStore: { homePanelId: mocks.homePanelId },
}));
vi.mock("../../platform-home/service", () => ({
  readHomePanel: mocks.readHomePanel,
  saveHomePanel: mocks.saveHomePanel,
}));

import { listCurrentProducts, listProjectionFilterFacets } from "../catalog";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "../catalog-reads";

const owner = { domainId: "domain", userId: "author" };
const credentials = { token: "reader-token", locale: "en" };
const grantedIds = { use: ["reader-panel"], edit: ["editor-panel"] };
const adapter = createProductPanelReadAdapter(owner, credentials);
const actor = { owner, credentials };
const unusedRequest = async () => { throw new Error("Unexpected operation request"); };
const host: PanelOperationHost = { initiator: actor, executor: actor, request: unusedRequest, requestWorkbench: unusedRequest };

const healthyDefinition = {
  name: "Orders", description: "", visibility: "private",
  content: { html: "<main></main>" }, manifest: { state: {}, members: {} },
};
const brokenDefinition = { ...healthyDefinition, manifest: { state: {}, members: {}, events: {} } };
const storedPanel = (id: string, ownerId: string, definition = brokenDefinition): CurrentProductRow => ({
  id, ownerId, domainId: owner.domainId, definition, revision: 4,
  createdAt: new Date("2026-11-23"), updatedAt: new Date("2026-11-24"),
});

const stored = [
  storedPanel("author-panel", owner.userId),
  storedPanel("editor-panel", "another-user"),
  storedPanel("reader-panel", "another-user"),
  storedPanel("hidden-panel", "another-user"),
  { ...storedPanel("healthy-panel", owner.userId), definition: healthyDefinition },
  { ...storedPanel("nameless-panel", owner.userId), definition: {} },
];

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
});

beforeEach(() => {
  const rows = new Map(stored.map(panel => [panel.id, panel]));
  mocks.query.mockReset().mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith("SELECT id,domain_id")) {
      const row = rows.get(args[1] as string);
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("DELETE FROM product_panels")) rows.delete(args[1] as string);
    if (sql.startsWith("SELECT COUNT(")) return { rows: [{ total: 0 }] };
    return { rows: [] };
  });
  mocks.ranges.mockReset().mockResolvedValue({
    USE: { fixed: true, authorId: null, objectIds: grantedIds.use, all: false },
    EDIT: { fixed: false, authorId: owner.userId, objectIds: grantedIds.edit, all: false },
  });
  mocks.decide.mockReset().mockImplementation(async (requests: ObjectDecisionRequest[], caller) => {
    expect(caller).toEqual(credentials);
    return requests.map(request => {
      if (!("target" in request) || request.verb === "VIEW") throw new Error("Unexpected panel decision");
      const { target, ownerFacts, verb } = request;
      expect(target).toMatchObject({ domainId: owner.domainId, kind: "PANEL" });
      expect(ownerFacts).toEqual({ ownerId: rows.get(target.id)?.ownerId, state: "PUBLISHED" });
      const allowed = (verb === "EDIT" && ownerFacts.ownerId === owner.userId) ||
        grantedIds[verb === "USE" ? "use" : "edit"].includes(target.id);
      return allowed ? { allowed: true } : { allowed: false, code: "OBJECT_FORBIDDEN", reason: "Denied" };
    });
  });
  mocks.retire.mockReset();
  mocks.panelUsers.mockReset().mockResolvedValue({ panels: [], applicationEntries: [], classNames: [], hiddenCount: 0 });
  mocks.panelsUsingProjection.mockReset().mockResolvedValue({ panels: [], hiddenCount: 0 });
  mocks.homePanelId.mockReset().mockResolvedValue(null);
  mocks.readHomePanel.mockReset().mockResolvedValue(null);
  mocks.saveHomePanel.mockReset().mockResolvedValue(undefined);
});

it("lists visible broken panels without search or pagination and exposes a revision only when removable", async () => {
  mocks.query.mockResolvedValueOnce({ rows: stored.filter(row => row.id !== "hidden-panel").map(row => ({
    ...row, editable: row.ownerId === owner.userId || row.id === "editor-panel",
  })) });
  const rows = panelRecordListSchema.parse(await adapter.unavailable());
  expect(mocks.ranges).toHaveBeenCalledWith("PANEL", ["USE", "EDIT"], credentials);
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(rows.map(row => row.primaryKey).sort()).toEqual(["author-panel", "editor-panel", "nameless-panel", "reader-panel"]);
  expect(rows.find(row => row.primaryKey === "author-panel")).toMatchObject({
    className: PRODUCT_PANEL,
    label: "author-panel",
    fields: { id: "author-panel", reason: expect.stringContaining("manifest.events"), revision: 4, canDelete: true },
    tones: { reason: "danger" },
  });
  const readOnly = rows.find(row => row.primaryKey === "reader-panel");
  expect(readOnly?.fields.canDelete).toBe(false);
  expect(readOnly?.fields).not.toHaveProperty("revision");
});

it("continues an updated catalogue page from the raw unreadable row's exact database key", async () => {
  const rawKey = "2026-11-24T00:00:00.123456+00:00";
  const summary = { name: "Orders", description: "", visibility: "private" };
  const unavailable = { ...stored[1], ...summary, sortKey: rawKey, editable: true };
  const healthy = { ...stored[4], ...summary, sortKey: "2026-11-23T00:00:00+00:00", editable: false };
  mocks.query.mockResolvedValueOnce({ rows: [unavailable, healthy] }).mockResolvedValueOnce({ rows: [{ total: 2 }] });
  const input = { q: "Orders", scope: "all", sort: "updated", limit: 1 } as const;
  const page = await listCurrentProducts(owner, credentials, "panel", input);
  expect(page).toMatchObject({ items: [], total: 2, unavailableItems: [{ id: unavailable.id, revision: 4 }] });
  expect(page.nextCursor).not.toBeNull();
  expect(mocks.ranges).toHaveBeenCalledTimes(1);
  expect(mocks.ranges).toHaveBeenCalledWith("PANEL", ["USE", "EDIT"], credentials);
  expect(mocks.decide).not.toHaveBeenCalled();
  // A list requires only the page and its exact total, not a candidate read before either one.
  expect(mocks.query).toHaveBeenCalledTimes(2);

  mocks.query.mockClear().mockResolvedValueOnce({ rows: [healthy] }).mockResolvedValueOnce({ rows: [{ total: 2 }] });
  const next = await listCurrentProducts(owner, credentials, "panel", { ...input, cursor: page.nextCursor! });
  expect(next).toMatchObject({ items: [{ id: healthy.id }], total: 2, nextCursor: null });
  const boundValues = mocks.query.mock.calls.map(([, values]) => values);
  expect(boundValues).toEqual(expect.arrayContaining([expect.arrayContaining([rawKey, unavailable.id, input.limit + 1])]));
  expect(boundValues.filter(values => values.includes(rawKey))).toHaveLength(1);
});

it("accepts the raw NULL name key in a continuation without counting only the remaining rows", async () => {
  const { name: _name, ...definition } = healthyDefinition;
  const unnamed = (id: string) => ({ ...storedPanel(id, owner.userId), definition: { ...definition, description: "Orders" },
    name: null, description: "Orders", visibility: "private", sortKey: null, editable: true });
  const first = unnamed("unnamed-orders-a");
  const second = unnamed("unnamed-orders-b");
  mocks.query.mockResolvedValueOnce({ rows: [first, second] }).mockResolvedValueOnce({ rows: [{ total: 2 }] });
  const input = { q: "Orders", scope: "all", sort: "name", limit: 1 } as const;
  const page = await listCurrentProducts(owner, credentials, "panel", input);
  expect(page).toMatchObject({ unavailableItems: [{ id: first.id }], total: 2, nextCursor: expect.any(String) });

  mocks.query.mockClear().mockResolvedValueOnce({ rows: [second] }).mockResolvedValueOnce({ rows: [{ total: 2 }] });
  const next = await listCurrentProducts(owner, credentials, "panel", { ...input, cursor: page.nextCursor! });
  expect(next).toMatchObject({ unavailableItems: [{ id: second.id }], total: 2, nextCursor: null });
  const [[, pageValues], [, countValues]] = mocks.query.mock.calls;
  expect(pageValues).toContain(first.id);
  expect(countValues).not.toContain(first.id);
});

it("binds projection EDIT grants for page annotations, not for the total", async () => {
  const componentId = "@ontomato/sdk:ObjectList";
  const stored = { id: "visible-projection", ownerId: "another-user", editable: true, revision: 1,
    name: "Orders", description: "", visibility: "private", componentId, definition: {},
    updatedAt: new Date("2026-11-24"), sortKey: "orders" };
  const edit = [stored.id, "edit-only-projection"];
  mocks.ranges.mockResolvedValueOnce({
    USE: { fixed: true, authorId: null, objectIds: [stored.id], all: false },
    EDIT: { fixed: false, authorId: null, objectIds: edit, all: false },
  });
  mocks.query.mockResolvedValueOnce({ rows: [stored] }).mockResolvedValueOnce({ rows: [{ total: 1 }] });
  await expect(listCurrentProducts(owner, credentials, "projection", { q: "", scope: "all", sort: "name", limit: 20, componentId }))
    .resolves.toMatchObject({ items: [{ id: stored.id, componentId, editable: true }], total: 1 });
  expect(mocks.ranges).toHaveBeenCalledTimes(1);
  expect(mocks.ranges).toHaveBeenCalledWith("PROJECTION", ["USE", "EDIT"], credentials);
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(2);
  const [, [, countValues]] = mocks.query.mock.calls;
  expect(countValues).not.toContainEqual(edit);
});

it("requests only USE for panel picker options and projection facets", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
  await expect(adapter.options()).resolves.toEqual({ options: [], total: 0 });
  expect(mocks.ranges).toHaveBeenCalledWith("PANEL", ["USE"], credentials);

  mocks.query.mockResolvedValueOnce({ rows: [{ componentId: "@ontomato/sdk:ObjectList", definition: {} }] });
  await expect(listProjectionFilterFacets(owner, credentials)).resolves.toMatchObject({ componentIds: ["@ontomato/sdk:ObjectList"] });
  expect(mocks.ranges).toHaveBeenCalledWith("PROJECTION", ["USE"], credentials);
  expect(mocks.decide).not.toHaveBeenCalled();
});

it("preserves picker options and uses the admitted range without another authorization round", async () => {
  const { productCatalogueDataReadRegistrations } = await import("../catalog-reads");
  const registration = productCatalogueDataReadRegistrations.find(item =>
    item.typeId === PRODUCT_PANEL && item.method === "options")!;
  const keyword = "Orders";
  const page = { number: 2, size: 3 };
  const readContext: RegisteredDataReadContext = {
    owner, credentials,
    selection: { kind: "platform", typeId: PRODUCT_PANEL, method: "options" },
    params: { keyword, page }, inputs: {}, projection: {} as ProductProjection,
    cache: { read: (_key: string, read: () => Promise<unknown>) => read() } as PanelReadBatchCache,
  };
  const options = await registration.plan(readContext);
  const panel = {
    ...storedPanel("reader-panel", "another-user"), ...healthyDefinition, definition: healthyDefinition,
    sortKey: "orders", editable: false,
  };
  const seed = () => mocks.query.mockResolvedValueOnce({ rows: [panel] }).mockResolvedValueOnce({ rows: [{ total: 4 }] });
  seed();
  const legacy = await adapter.options(keyword, page);

  mocks.ranges.mockClear();
  seed();
  const ranges = {
    USE: { fixed: true, authorId: null, objectIds: grantedIds.use, all: false },
    EDIT: { fixed: false, authorId: owner.userId, objectIds: grantedIds.edit, all: false },
  };
  await expect(options.present([{ status: "ready", visibility: { PANEL: ranges } }], readContext))
    .resolves.toEqual(legacy);
  expect(legacy).toEqual({ options: [{ primaryKey: panel.id, value: panel.id, label: "Orders" }], total: 4 });
  expect(options.reads[0].visibleKinds).toEqual([{ kind: "PANEL", verbs: ["USE"] }]);
  expect(mocks.ranges).not.toHaveBeenCalled();
  expect(mocks.decide).not.toHaveBeenCalled();
});

it.each([["author-panel", true], ["editor-panel", true], ["reader-panel", false]] as const)(
  "returns a typed diagnostic with the right delete capability for %s", async (id, canDelete) => {
    const record = panelRecordSchema.parse(await adapter.record(id));
    const diagnostic = {
      unavailable: true, unavailableReason: expect.stringContaining("manifest.events"),
      canEdit: false, canGrant: false, canDelete, isTemplate: false, domainShared: false, hiddenUsedByCount: 0,
    };
    expect(record).toMatchObject({
      primaryKey: id, className: PRODUCT_PANEL, label: id, subtitle: expect.stringContaining("manifest.events"),
      fields: { id, ...diagnostic },
      outputs: diagnostic,
    });
    if (canDelete) {
      expect(record.fields.revision).toBe(4);
      expect(record.outputs?.revision).toBe(4);
    } else {
      expect(record.fields).not.toHaveProperty("revision");
      expect(record.outputs).not.toHaveProperty("revision");
    }
  },
);

it("preserves missing and forbidden errors for diagnostic detail reads", async () => {
  await expect(adapter.record("gone")).rejects.toMatchObject({ status: 404, code: "PRODUCT_UNAVAILABLE" });
  await expect(adapter.record("hidden-panel")).rejects.toMatchObject({ status: 403, code: "PRODUCT_FORBIDDEN" });
});

it("allows the author to confirm and delete a broken panel after its Grants are gone", async () => {
  const { productCatalogServerOperations } = await import("../catalog-operations");
  const operation = productCatalogServerOperations.find(op => op.handlerRef === "productPanels.delete");
  if (operation?.kind !== "action" || operation.targetInput === undefined) throw new Error("Missing targeted panel delete");
  const target = { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "author-panel" } as const;
  await expect(operation.unavailable!(host, target)).resolves.toBeUndefined();
  await expect(operation.unavailable!(host, { ...target, primaryKey: "reader-panel" })).resolves.toBeDefined();
  const impact = panelOperationImpactSchema.parse(await operation.inspectImpact!.inspect(host, [{ target, input: { revision: 4 } }]));
  expect(impact).toMatchObject({
    total: 1, objects: [{ target: { objectType: PRODUCT_PANEL, primaryKey: "author-panel" }, label: "Orders" }],
  });
  await expect(operation.execute(host, target, { revision: 4 }, "delete-author-panel")).resolves.toMatchObject({
    kind: "success", data: { success: true },
    affected: { objects: [{ objectType: PRODUCT_PANEL, primaryKey: "author-panel" }] },
  });
  expect(mocks.retire).toHaveBeenCalledWith({
    target: { domainId: owner.domainId, kind: "PANEL", id: "author-panel" },
    ownerFacts: { ownerId: owner.userId, state: "PUBLISHED" },
  }, credentials);
  await expect(adapter.record("author-panel")).rejects.toMatchObject({ status: 404 });
});

it("resolves ProductPanel.homePanel across default, usable custom, and unavailable custom states, and updates via setAsHome/resetHome", async () => {
  const defaultHome = panelRecordSchema.parse(await adapter.homePanel());
  expect(defaultHome).toMatchObject({
    primaryKey: "default",
    className: PRODUCT_PANEL,
    outputs: { isCustomHome: false, panelId: "", unavailable: false },
  });

  mocks.homePanelId.mockResolvedValueOnce("healthy-panel");
  mocks.readHomePanel.mockResolvedValueOnce({
    id: "healthy-panel",
    name: "Orders",
    description: "",
    revision: 4,
    editable: true,
    visibility: "private",
    content: healthyDefinition.content,
    manifest: healthyDefinition.manifest,
  });
  const customHome = panelRecordSchema.parse(await adapter.homePanel());
  expect(customHome).toMatchObject({
    primaryKey: "healthy-panel",
    label: "Orders",
    outputs: { isCustomHome: true, panelId: "healthy-panel", unavailable: false },
  });

  mocks.homePanelId.mockResolvedValueOnce("hidden-panel");
  mocks.readHomePanel.mockRejectedValueOnce(new HttpError(403, "Use Grant required", "PRODUCT_FORBIDDEN"));
  const forbiddenHome = panelRecordSchema.parse(await adapter.homePanel());
  expect(forbiddenHome).toMatchObject({
    primaryKey: "hidden-panel",
    outputs: { isCustomHome: true, panelId: "hidden-panel", unavailable: true },
  });
  expect(forbiddenHome.fields.unavailableReason).toBeTruthy();

  const { productCatalogServerOperations } = await import("../catalog-operations");
  const setAsHome = productCatalogServerOperations.find(op => op.handlerRef === "productPanels.setAsHome");
  const resetHome = productCatalogServerOperations.find(op => op.handlerRef === "productPanels.resetHome");
  if (setAsHome?.kind !== "action" || setAsHome.targetInput === undefined) throw new Error("Missing productPanels.setAsHome");
  if (resetHome?.kind !== "action" || resetHome.targetInput !== undefined) throw new Error("Missing productPanels.resetHome");

  await expect(setAsHome.execute(host, { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "healthy-panel" }, {}, "set-home")).resolves.toMatchObject({
    kind: "success",
    affected: { objectTypes: [PRODUCT_PANEL], objects: [{ objectType: PRODUCT_PANEL, primaryKey: "healthy-panel" }] },
  });
  expect(mocks.saveHomePanel).toHaveBeenCalledWith(owner, credentials, "healthy-panel");

  mocks.saveHomePanel.mockRejectedValueOnce(new HttpError(403, "Use Grant required", "PRODUCT_FORBIDDEN"));
  await expect(setAsHome.execute(host, { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "hidden-panel" }, {}, "set-hidden")).resolves.toMatchObject({
    kind: "refusal",
    code: "PRODUCT_FORBIDDEN",
  });

  await expect(resetHome.execute(host, null, {}, "reset-home")).resolves.toMatchObject({
    kind: "success",
    affected: { objectTypes: [PRODUCT_PANEL] },
  });
  expect(mocks.saveHomePanel).toHaveBeenCalledWith(owner, credentials, null);
});

it("builds local referenceGraph payloads for panels and projections (PN-03, PJ-06)", async () => {
  mocks.decide.mockImplementation(async (requests: ObjectDecisionRequest[]) => requests.map(() => ({ allowed: true })));
  mocks.panelUsers.mockResolvedValueOnce({
    panels: [{ id: "parent-panel", name: "Parent dashboard" }],
    applicationEntries: [{ applicationId: "app-ops", applicationName: "Operations", entryId: "main", path: "/operations" }],
    classNames: ["Order"],
    hiddenCount: 0,
  });
  const panelGraphRecord = panelRecordSchema.parse(await adapter.referenceGraph("healthy-panel"));
  const panelGraph = (panelGraphRecord.fields.graph as { kind: "json"; value: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> } }).value;
  expect(panelGraph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
    "asset:healthy-panel",
    "asset:parent-panel",
    "asset:app-ops",
    "object-type:Order",
  ]));
  expect(panelGraph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "asset:parent-panel", target: "asset:healthy-panel" }),
    expect.objectContaining({ source: "asset:app-ops", target: "asset:healthy-panel" }),
  ]));

  const projAdapter = createProductProjectionReadAdapter(owner, credentials);
  const projRow: CurrentProductRow = {
    id: "proj-orders",
    domainId: owner.domainId,
    ownerId: owner.userId,
    revision: 2,
    createdAt: new Date("2026-11-23"),
    updatedAt: new Date("2026-11-24"),
    definition: {
      name: "Orders list",
      description: "",
      visibility: "private",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      data: {
        rows: {
          source: { type: { kind: "ObjectType", id: "Order" } },
          read: "query",
          params: {},
        },
      },
      config: {},
    },
  };
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith("SELECT id,domain_id") && args[1] === "proj-orders") return { rows: [projRow] };
    if (sql.startsWith("SELECT COUNT(")) return { rows: [{ total: 0 }] };
    return { rows: [] };
  });
  mocks.panelsUsingProjection.mockResolvedValueOnce({
    panels: [{ id: "healthy-panel", name: "Orders" }],
    hiddenCount: 0,
  });
  const projGraphRecord = panelRecordSchema.parse(await projAdapter.referenceGraph("proj-orders"));
  const projGraph = (projGraphRecord.fields.graph as { kind: "json"; value: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> } }).value;
  expect(projGraph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
    "asset:proj-orders",
    "asset:healthy-panel",
    "object-type:Order",
  ]));
  expect(projGraph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "asset:healthy-panel", target: "asset:proj-orders" }),
    expect.objectContaining({ source: "asset:proj-orders", target: "object-type:Order" }),
  ]));
});
