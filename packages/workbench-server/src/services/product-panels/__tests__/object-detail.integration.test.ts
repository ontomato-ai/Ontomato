import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ensureProductPanelsSchema } from "../../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { HttpError } from "../../../utils/errors";
import { classesUsingDetailPanel, resolveObjectDetail } from "../object-detail";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined,
  schema: "",
  requireGrant: vi.fn<[id: string, verb: "use" | "edit"], Promise<void>>(),
}));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: state.requireGrant }));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const owner = { domainId: "domain", userId: "editor" };
const credentials = { token: "caller" };
const panel = {
  name: "Details", description: "", visibility: "private",
  content: { html: "<section></section>" }, manifest: { state: {}, members: {}, events: {} },
};

beforeAll(async () => {
  state.schema = `object_detail_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductPanelsSchema(state.pool);
});

afterAll(async () => {
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

beforeEach(async () => {
  state.requireGrant.mockReset();
  state.requireGrant.mockResolvedValue(undefined);
  await state.pool!.query(`TRUNCATE "${state.schema}".product_panels, "${state.schema}".product_object_details`);
});

async function addPanel(id: string, definition: object = panel) {
  await state.pool!.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
    VALUES ($1,$2,$3,$4)`, [owner.domainId, id, owner.userId, definition]);
}

async function mapClass(className: string, panelId: string, domainId = owner.domainId) {
  await state.pool!.query(`INSERT INTO "${state.schema}".product_object_details (domain_id,class_name,panel_id,updated_by)
    VALUES ($1,$2,$3,$4)`, [domainId, className, panelId, owner.userId]);
}

it("resolves a usable current panel and distinguishes a class with no mapping", async () => {
  await addPanel("detail");
  await mapClass("Customer", "detail");
  await expect(resolveObjectDetail(owner, credentials, "Customer")).resolves.toEqual({ kind: "configured", panelId: "detail" });
  await expect(resolveObjectDetail(owner, credentials, "Invoice")).resolves.toEqual({ kind: "unconfigured" });
});

it("rejects an unavailable, invalid or forbidden mapped panel", async () => {
  await mapClass("Customer", "detail");
  await expect(resolveObjectDetail(owner, credentials, "Customer")).rejects.toMatchObject({ status: 404, code: "PRODUCT_NOT_FOUND" });
  await addPanel("detail", {});
  await expect(resolveObjectDetail(owner, credentials, "Customer")).rejects.toMatchObject({ status: 404, code: "PRODUCT_UNAVAILABLE" });
  await addPanel("private");
  await mapClass("Invoice", "private");
  state.requireGrant.mockRejectedValue(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  await expect(resolveObjectDetail(owner, credentials, "Invoice")).rejects.toMatchObject({ status: 403, code: "PRODUCT_FORBIDDEN" });
});

it("returns every class mapped to the panel in the requested domain", async () => {
  await mapClass("Invoice", "detail");
  await mapClass("Customer", "detail");
  await mapClass("Issue", "other");
  await mapClass("Supplier", "detail", "another-domain");
  const client = await state.pool!.connect();
  try {
    await expect(classesUsingDetailPanel(owner.domainId, "detail", client)).resolves.toEqual(["Customer", "Invoice"]);
  } finally {
    client.release();
  }
});
