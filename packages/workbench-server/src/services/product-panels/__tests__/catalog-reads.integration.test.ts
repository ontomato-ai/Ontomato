import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { ensureProductAssetsSchema } from "../../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { productCatalogServerOperations } from "../catalog-operations";
import { createProductPanelReadAdapter } from "../catalog-reads";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined,
  schema: "",
  use: ["one", "two"],
}));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../product-governance/grants", async original => ({
  ...await original<typeof import("../../product-governance/grants")>(),
  grantedProductIds: async (verb: "use" | "edit") => verb === "use" ? state.use : ["one"],
  requireProductGrant: async (id: string, verb: "use" | "edit") => {
    if (!(verb === "use" ? state.use : ["one"]).includes(id))
      throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  },
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const owner = { domainId: "domain", userId: "viewer" };
const viewer = { token: "viewer-session" };
const content = {
  html: '<div id="app"><p>Test panel</p></div>',
  module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
};
const manifest = { state: {}, members: {}, events: {} };

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  state.schema = `m2_catalogue_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  for (const [id, name, ownerId] of [["one", "Alpha directory", "viewer"], ["two", "Beta directory", "author"], ["hidden", "Hidden directory", "author"]]) {
    await state.pool.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
      VALUES ($1,$2,$3,$4)`, [owner.domainId, id, ownerId, { name, content, manifest, description: "", visibility: "private" }]);
  }
});

afterAll(async () => {
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

it("maps catalogue filters and cursors into the current product listing", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const query = { search: "directory", sort: "name", size: 1 };
  const first = panelReadResultSchemas.productPanelList.parse(await adapter.query(query));
  expect(first.items.map(item => item.id)).toEqual(["one"]);
  expect(first.nextCursor).toBeTruthy();
  const next = panelReadResultSchemas.productPanelList.parse(await adapter.query({ ...query, cursor: first.nextCursor! }));
  expect(next.items.map(item => item.id)).toEqual(["two"]);
  const own = panelReadResultSchemas.productPanelList.parse(await adapter.query({ ...query, scope: "mine" }));
  expect(own.items.map(item => item.id)).toEqual(["one"]);
});

it("keeps members and editable form values with their current authorized panel", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const record = panelReadResultSchemas.productPanelRecord.parse(await adapter.record("one"));
  expect(record.content).toEqual(content);
  expect(panelReadResultSchemas.productPanelMembers.parse(await adapter.members("one"))).toEqual(record.manifest.members);
  const form = panelReadResultSchemas.panelFormDescription.parse(await adapter.form("one", {}));
  expect(form.values).toMatchObject({ name: "Alpha directory", content, manifest });
  expect(form.fields.find(field => field.path === "/content/module")?.readOnly).toBe(false);
  await expect(adapter.record("hidden")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
});

it("uses the registered save operation to write the current panel and refuses a stale revision", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const form = await adapter.form("one", {});
  const actor = { owner, credentials: viewer };
  const unusedRequest = async () => { throw new Error("The Node owner should write through its own store"); };
  const host = { initiator: actor, executor: actor, request: unusedRequest, requestWorkbench: unusedRequest };
  const save = productCatalogServerOperations.find(operation => operation.handlerRef === `${PRODUCT_PANEL}.save`)!;
  const target = { kind: "object" as const, objectType: PRODUCT_PANEL, primaryKey: "one" };
  const input = { values: { ...form.values, name: "Updated directory" }, revision: form.revision };

  expect(await save.execute(host, target, input, "first-save")).toMatchObject({
    kind: "success", data: { id: "one" }, affected: { objects: [{ objectType: PRODUCT_PANEL, primaryKey: "one" }] },
  });
  expect(await save.execute(host, target, { ...input, values: { ...input.values, name: "Stale edit" } }, "stale-save"))
    .toMatchObject({ kind: "refusal", code: "PRODUCT_CONFLICT" });
  expect(await adapter.record("one")).toMatchObject({ name: "Updated directory", revision: 2 });
});
