import type { ObjectDecisionRequest } from "../../services/product-governance/authorization";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  clearObjectDetailResponseSchema, objectDetailResponseSchema,
  objectDetailUsedByResponseSchema, setObjectDetailRequestSchema, setObjectDetailResponseSchema,
} from "@ontomato/contracts/object-detail";
import express from "express";
import pg from "pg";
import { errorHandler } from "../middleware/error-handler";
import { objectDetailsRouter } from "../routes/object-details";

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mountEntryDependencyOwner } from "../../__tests__/fixtures/entry-dependency-owner";
import { config } from "../../config/application";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { classesUsingDetailPanel, resolveObjectDetail } from "../../services/product-panels/object-detail";
import { clearObjectDetail, setObjectDetail } from "../../services/product-panels/object-detail-write";
import { compileRegisteredPanelRoots } from "../../services/product-panels/entry-dependency-store";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined,
  schema: "",
  assertPermission: vi.fn(),
  requireGrant: vi.fn<[id: string, verb: "use" | "edit"], Promise<void>>(),
}));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../services/product-governance/authorization", async original => {
  const actual = await original<typeof import("../../services/product-governance/authorization")>();
  const requireObject = async (request: ObjectDecisionRequest) => {
    if (!("target" in request) || request.target.domainId !== owner.domainId || request.target.kind !== "PANEL")
      throw new Error("Expected a current panel in the caller's domain");
    await state.requireGrant(request.target.id, request.verb === "EDIT" ? "edit" : "use");
  };
  return { ...actual, requireObject, decideObjects: async (requests: ObjectDecisionRequest[]) => Promise.all(requests.map(async request => {
    try { await requireObject(request); return { allowed: true }; }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 403) throw error;
      return { allowed: false, code: error.code, reason: error.message };
    }
  })) };
});

vi.mock("../../identity/installed", () => ({
  workbenchIdentity: () => ({ requireDomainId: (identity: { domainId: string }) => identity.domainId }),
}));
vi.mock("../../identity/management", () => ({ assertManagement: state.assertPermission }));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server;
let base: string;
const previousQueryUrl = config.dataQuery.baseUrl;
const owner = { domainId: "domain", userId: "editor" };
const credentials = { token: "caller" };
const panel = {
  name: "Details", description: "", visibility: "private",
  content: {
    html: '<div id="app"><section></section></div>',
    module: `import { mountPanel } from "@ontomato/sdk/panel";
await mountPanel({});`,
  },
  manifest: { state: {}, members: {} },
};

beforeAll(async () => {
  state.schema = `object_detail_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  const app = express();
  app.use(express.json());
  mountEntryDependencyOwner(app, { token: "fixture-service", entries: () => [] });
  app.use("/api/object-details", (req, _res, next) => {
    Object.assign(req, owner, credentials);
    next();
  }, objectDetailsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.dataQuery.baseUrl = base;
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "fixture-service");
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  vi.unstubAllEnvs();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

beforeEach(async () => {
  state.assertPermission.mockReset();
  state.requireGrant.mockReset();
  state.requireGrant.mockResolvedValue(undefined);
  await state.pool!.query(`TRUNCATE "${state.schema}".product_panels, "${state.schema}".product_object_details,
    "${state.schema}".product_panel_entry_dependencies, "${state.schema}".product_publication_outbox`);
});

async function addPanel(id: string, definition: object = panel) {
  await state.pool!.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
    VALUES ($1,$2,$3,$4)`, [owner.domainId, id, owner.userId, definition]);
}

async function mapClass(className: string, panelId: string, domainId = owner.domainId) {
  await state.pool!.query(`INSERT INTO "${state.schema}".product_object_details (domain_id,class_name,panel_id,updated_by)
    VALUES ($1,$2,$3,$4)`, [domainId, className, panelId, owner.userId]);
}

async function mapInstalledClass(className: string, panelId: string) {
  await transaction(client => compileRegisteredPanelRoots(client, owner.domainId, [panelId]));
  await mapClass(className, panelId);
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

it("requires the mapping management operation and the new panel use grant for a first mapping", async () => {
  await addPanel("detail");
  state.assertPermission.mockRejectedValueOnce(new HttpError(403, "Denied", "PERMISSION_DENIED"));
  await expect(setObjectDetail(owner, credentials, "Customer", "detail")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(state.assertPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "object-details.mapping.change" }), owner, credentials);
  state.requireGrant.mockRejectedValueOnce(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  await expect(setObjectDetail(owner, credentials, "Customer", "detail")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  await expect(resolveObjectDetail(owner, credentials, "Customer")).resolves.toEqual({ kind: "unconfigured" });

  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id !== "detail" || verb !== "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await setObjectDetail(owner, credentials, "Customer", "detail");
  await expect(classesUsingDetailPanel(owner.domainId, "detail")).resolves.toEqual(["Customer"]);
});

it("replaces and clears the mapping with modeling permission and only the new panel use grant", async () => {
  await addPanel("old");
  await addPanel("new");
  await mapInstalledClass("Customer", "old");
  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id === "new" && verb === "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await expect(setObjectDetail(owner, credentials, "Customer", "new")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id !== "new" || verb !== "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await setObjectDetail(owner, credentials, "Customer", "new");
  await expect(classesUsingDetailPanel(owner.domainId, "old")).resolves.toEqual([]);
  await expect(classesUsingDetailPanel(owner.domainId, "new")).resolves.toEqual(["Customer"]);

  state.assertPermission.mockRejectedValueOnce(new HttpError(403, "Denied", "PERMISSION_DENIED"));
  await expect(clearObjectDetail(owner, credentials, "Customer")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await clearObjectDetail(owner, credentials, "Customer");
  await expect(resolveObjectDetail(owner, credentials, "Customer")).resolves.toEqual({ kind: "unconfigured" });
});

it("serves public mapping operations over HTTP using the shared schemas and authenticated domain", async () => {
  await addPanel("detail");
  await mapClass("Supplier", "detail", "another-domain");
  const url = `${base}/api/object-details/Customer`;
  const initial = await fetch(url);
  expect(initial.status).toBe(200);
  expect(objectDetailResponseSchema.parse(await initial.json()).panelId).toBeNull();

  const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setObjectDetailRequestSchema.parse({ panelId: "detail" })) });
  expect(response.status).toBe(200);
  expect(setObjectDetailResponseSchema.parse(await response.json()).panelId).toBe("detail");

  const resolved = await fetch(url);
  expect(resolved.status).toBe(200);
  expect(objectDetailResponseSchema.parse(await resolved.json()).panelId).toBe("detail");
  const reverse = await fetch(`${base}/api/object-details/by-panel/detail`);
  expect(reverse.status).toBe(200);
  expect(objectDetailUsedByResponseSchema.parse(await reverse.json()).classNames).toEqual(["Customer"]);

  const cleared = await fetch(url, { method: "DELETE" });
  expect(cleared.status).toBe(200);
  expect(clearObjectDetailResponseSchema.parse(await cleared.json()).panelId).toBeNull();
});

it("rejects a remapping that closes a panel cycle without changing the old mapping", async () => {
  await addPanel("root", {
    ...panel,
    content: { ...panel.content, html: '<div id="app"><section><projection slot="detail"></projection></section></div>' },
    manifest: {
      state: { selected: { type: { kind: "object", objectType: "Customer" },
        deepLink: false, external: false, personal: false, default: null } },
      members: { detail: { target: { fromState: "selected", candidates: { rule: "objectDetail" } } } },
    },
  });
  await addPanel("loop", {
    ...panel,
    content: { ...panel.content, html: '<div id="app"><section><projection slot="back"></projection></section></div>' },
    manifest: { ...panel.manifest, members: { back: { target: { panelId: "root" } } } },
  });
  await addPanel("old");
  await addPanel("leaf");
  await mapInstalledClass("Customer", "old");
  const url = `${base}/api/object-details/Customer`;
  const set = (panelId: string) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setObjectDetailRequestSchema.parse({ panelId })) });

  const rejected = await set("loop");
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: { code: "PANEL_REFERENCE_CYCLE" } });
  expect(objectDetailResponseSchema.parse(await (await fetch(url)).json()).panelId).toBe("old");

  const accepted = await set("leaf");
  expect(accepted.status).toBe(200);
  expect(setObjectDetailResponseSchema.parse(await accepted.json()).panelId).toBe("leaf");
});
