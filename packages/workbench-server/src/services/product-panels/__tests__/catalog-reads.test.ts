import { panelOperationImpactSchema } from "@ontomato/contracts/panel-operations";
import { PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import { panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import type { PanelOperationHost } from "../server-operations";

const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), panelUsers: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: { query: typeof mocks.query }) => unknown) => run({ query: mocks.query }),
}));
vi.mock("../../product-governance/grants", async importOriginal => ({
  ...await importOriginal<typeof import("../../product-governance/grants")>(),
  grantedProductIds: async (verb: string) => verb === "use" ? ["reader-panel"] : ["editor-panel"],
  requireProductGrant: mocks.grant,
  productGrantAllowed: async () => false,
}));
vi.mock("../used-by", () => ({ panelUsers: mocks.panelUsers, panelsUsingProjection: vi.fn() }));

import { createProductPanelReadAdapter } from "../catalog-reads";

const owner = { domainId: "domain", userId: "author" };
const credentials = { token: "reader-token", locale: "en" };
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
    if (sql.includes("UNION ALL")) {
      const [domainId, visible, ownerId] = args as [string, string[], string];
      return { rows: [...rows.values()].filter(row =>
        row.domainId === domainId && (row.ownerId === ownerId || visible.includes(row.id))) };
    }
    if (sql.startsWith("SELECT id,domain_id")) {
      const row = rows.get(args[1] as string);
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("DELETE FROM product_panels")) rows.delete(args[1] as string);
    return { rows: [] };
  });
  mocks.grant.mockReset().mockImplementation(async (id: string) => {
    if (id !== "reader-panel") throw new HttpError(403, "Use Grant required", "PRODUCT_FORBIDDEN");
  });
  mocks.panelUsers.mockReset().mockResolvedValue({ panels: [], applicationEntries: [], classNames: [], hiddenCount: 0 });
});

it("lists visible broken panels without search or pagination and exposes a revision only when removable", async () => {
  const rows = panelRecordListSchema.parse(await adapter.unavailable());
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
  await expect(adapter.record("author-panel")).rejects.toMatchObject({ status: 404 });
});
