import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  OBJECT_DETAIL_INTERNAL_PATH, clearObjectDetailResponseSchema, objectDetailResponseSchema,
  objectDetailUsedByResponseSchema, setObjectDetailRequestSchema, setObjectDetailResponseSchema,
} from "@ontomato/contracts/object-detail";
import express from "express";
import pg from "pg";
import { errorHandler } from "../middleware/error-handler";
import { objectDetailsInternalRouter, objectDetailsRouter } from "../routes/object-details";

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { HttpError } from "../../utils/errors";
import { classesUsingDetailPanel, resolveObjectDetail } from "../../services/product-panels/object-detail";
import { clearObjectDetail, setObjectDetail } from "../../services/product-panels/object-detail-write";

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
vi.mock("../../services/product-governance/grants", () => ({ requireProductGrant: state.requireGrant }));

vi.mock("../../identity/installed", () => ({
  assertPermission: state.assertPermission,
  workbenchIdentity: () => ({ requireDomainId: (identity: { domainId: string }) => identity.domainId }),
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server;
let base: string;
const platformToken = "test-platform-service";
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
  await ensureProductPanelsSchema(state.pool);

  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", platformToken);
  const app = express();
  app.use(express.json());
  app.use(objectDetailsInternalRouter);
  app.use("/api/object-details", (req, _res, next) => {
    Object.assign(req, owner, credentials);
    next();
  }, objectDetailsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

beforeEach(async () => {
  state.assertPermission.mockReset();
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

it("requires ontology-modeling and the new panel use grant for a first mapping", async () => {
  await addPanel("detail");
  state.assertPermission.mockRejectedValueOnce(new HttpError(403, "Denied", "PERMISSION_DENIED"));
  await expect(setObjectDetail(owner, credentials, "Customer", "detail")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(state.assertPermission).toHaveBeenCalledWith(credentials, ["ontology-modeling"]);
  state.requireGrant.mockRejectedValueOnce(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  await expect(setObjectDetail(owner, credentials, "Customer", "detail")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  await expect(resolveObjectDetail(owner, credentials, "Customer")).resolves.toEqual({ kind: "unconfigured" });

  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id !== "detail" || verb !== "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await setObjectDetail(owner, credentials, "Customer", "detail");
  await expect(classesUsingDetailPanel(owner.domainId, "detail")).resolves.toEqual(["Customer"]);
});

it("requires edit on the old panel to replace or clear a mapping and keeps one row per class", async () => {
  await addPanel("old");
  await addPanel("new");
  await mapClass("Customer", "old");
  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id === "old" && verb === "edit") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await expect(setObjectDetail(owner, credentials, "Customer", "new")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  await expect(clearObjectDetail(owner, credentials, "Customer")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  await expect(resolveObjectDetail(owner, credentials, "Customer")).resolves.toEqual({ kind: "configured", panelId: "old" });

  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id === "new" && verb === "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await expect(setObjectDetail(owner, credentials, "Customer", "new")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  state.requireGrant.mockResolvedValue(undefined);
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

it("requires a platform token for the Java read and distinguishes absent and broken mappings", async () => {
  await addPanel("private");
  await mapClass("Customer", "private");
  await mapClass("Issue", "missing");
  state.requireGrant.mockRejectedValue(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  const url = (className: string) => `${base}${OBJECT_DETAIL_INTERNAL_PATH}?domainId=domain&className=${className}`;
  const serviceRequest = { headers: { "X-Ontomato-Query-Service-Token": platformToken } };

  expect((await fetch(url("Customer"))).status).toBe(403);
  expect((await fetch(`${base}/api/object-details/Customer`)).status).toBe(403);
  const configured = await fetch(url("Customer"), serviceRequest);
  expect(configured.status).toBe(200);
  expect(objectDetailResponseSchema.parse(await configured.json()).panelId).toBe("private");
  const absent = await fetch(url("Invoice"), serviceRequest);
  expect(absent.status).toBe(200);
  expect(objectDetailResponseSchema.parse(await absent.json()).panelId).toBeNull();
  const broken = await fetch(url("Issue"), serviceRequest);
  expect(broken.status).toBe(404);
  expect(await broken.json()).toMatchObject({ error: { code: "PRODUCT_NOT_FOUND" } });
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
  await mapClass("Customer", "old");
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
