import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "" } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const panelId = "panel-customer-ontology";
const use = { kind: "registered", applicationId: "customer-ontology", useId: "facts" } as const;
const resourceIds = new Set<string>();
let server: Server;
let contentRoot: string;

/** The Java owner's catalog: attributes in their stored order, and the relationships touching each class. */
const attribute = (className: string, name: string, showName: string, flags: { primaryKey?: boolean; businessKey?: boolean } = {}) => ({
  className, name, showName, type: "varchar", attrDesc: "", enable: true,
  businessKey: flags.businessKey ?? false, primaryKey: flags.primaryKey ?? false,
});
const attributes: Record<string, ReturnType<typeof attribute>[]> = {
  person: [
    attribute("person", "id", "ID", { primaryKey: true }), attribute("person", "name", "Name", { businessKey: true }),
    attribute("person", "team", "Team", { businessKey: true }), attribute("person", "tags", "Tags"), attribute("person", "note", "Note"),
  ],
  org: [attribute("org", "id", "ID", { primaryKey: true }), attribute("org", "title", "Title", { businessKey: true })],
  audit: [attribute("audit", "id", "ID", { primaryKey: true })],
  secret: [attribute("secret", "id", "ID", { primaryKey: true })],
};
const relationship = (name: string, fromclass: string, toclass: string) =>
  ({ relationship: name, fromclass, toclass, desc: name, fromField: "id", toField: "id" });
const relationships = [relationship("person_to_org", "person", "org"), relationship("org_to_audit", "org", "audit")];
const objects: Record<string, Record<string, unknown>> = {
  "person:p1": { id: "p1", name: "Alice", team: "Ops", tags: ["lead", "oncall"], note: null },
  "org:o1": { id: "o1", title: "Acme" },
};
const ownerCalls: string[] = [];

function javaOwner(app: express.Express) {
  const reader = (req: express.Request) => {
    expect(req.header("tk")).toBe("fact-reader");
    expect(req.header("Accept-Language")).toBe("en");
  };
  app.get("/ontology/model/attributes", (req, res) => {
    reader(req);
    res.json(attributes[String(req.query.className)]);
  });
  app.get("/ontology/model/relationships", (req, res) => {
    reader(req);
    const className = String(req.query.className);
    res.json(relationships.filter(rel => rel.fromclass === className || rel.toclass === className));
  });
  app.post("/data/getWholeClassDataByPage", (req, res) => {
    reader(req);
    ownerCalls.push(`page ${JSON.stringify(req.body)}`);
    if (req.body.classname === "secret") {
      res.json({ success: false, code: "DATA_PERMISSION_DENIED", message: "No data permission for secret" });
      return;
    }
    res.json({ success: true, total_count: 7, data: [
      objects["person:p1"],
      // Columns the viewer may not read are absent from the row; an empty business key falls back to the key.
      { id: "p3", name: "", team: "" },
    ] });
  });
  app.post("/data/queryInfoByNode", (req, res) => {
    reader(req);
    const object = objects[req.body.id];
    if (object) { res.json({ success: true, data: { classDef: { className: req.body.class }, data: object } }); return; }
    res.json(req.body.id === "person:p2"
      ? { success: false, code: "DATA_PERMISSION_DENIED", message: "No data permission for p2" }
      : { success: false, code: "OBJECT_NOT_FOUND", message: `Object ${req.body.id} does not exist` });
  });
  app.post("/dsl/executeV1", (req, res) => {
    reader(req);
    const pattern = req.body.answer.steps[0].graph.patterns[0];
    const [{ type: [kind], from }] = pattern.relationship;
    ownerCalls.push(`dsl ${kind} from ${from} limit ${req.body.answer.steps[0].output.limit.count}`);
    if (kind === "org_to_audit") {
      res.status(403).json({ success: false, message: "Class audit is outside the authorized scope" });
      return;
    }
    // The anchor org sits at the relationship's target end, so its people come back from the incoming direction.
    expect(from).toBe(1);
    res.json({ data: [{ answer: [{ id: "p1", name: "Alice", team: "Ops" }, { id: "p3", name: "Bob", team: "" }] }] });
  });
}

const person = { className: "person", primaryKey: "p1" };
const org = { className: "org", primaryKey: "o1" };
const recordOf = (literal: object) => ({
  componentId: "@ontomato/sdk:ObjectSummary", data: { record: { source: { object: { literal } }, read: "record", params: {} } },
});
const neighborsOf = (relationshipId: string, params: object) => ({
  componentId: "@ontomato/sdk:ObjectRelations",
  data: { neighbors: { source: { type: { kind: "Relationship", id: relationshipId } }, read: "neighbors", params } },
});
const projections: Record<string, object> = {
  people: { componentId: "@ontomato/sdk:ObjectList", data: { rows: {
    source: { type: { kind: "ObjectType", id: "person" } }, read: "query",
    params: { search: { literal: "a" }, page: { literal: { number: 1, size: 2 } } },
  } } },
  secrets: { componentId: "@ontomato/sdk:ObjectList", data: { rows: {
    source: { type: { kind: "ObjectType", id: "secret" } }, read: "query", params: {},
  } } },
  detail: recordOf(person),
  hidden: recordOf({ className: "person", primaryKey: "p2" }),
  missing: recordOf({ className: "person", primaryKey: "p9" }),
  staff: neighborsOf("person_to_org", { node: { literal: org }, limit: { literal: 1 } }),
  audits: neighborsOf("org_to_audit", { node: { literal: org } }),
  crossed: neighborsOf("person_to_org", { node: { literal: org }, relationKinds: { literal: ["org_to_audit"] } }),
};

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
  state.schema = `customer_ontology_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "customer-ontology-panel-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => { resourceIds.add(req.body.id); res.json({ success: true }); });
  app.post("/product-governance/check", (req, res) => res.json({ allowed: resourceIds.has(req.body.id) }));
  app.post("/product-governance/resources", (_req, res) => res.json({ ids: [...resourceIds] }));
  app.get(`/platform/applications/${use.applicationId}/panel-uses`, (req, res) => {
    expect(req.header("tk")).toBe("fact-reader");
    res.json({ success: true, data: {
      applicationId: use.applicationId, entry: { path: `/applications/${use.applicationId}`, renderer: "panels" },
      panelUses: [{ id: use.useId, pageKey: use.useId, path: `/applications/${use.applicationId}/${use.useId}`, panelId,
        access: { kind: "domain-member" } }],
    } });
  });
  javaOwner(app);
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: "facts", userId: "reader", userName: "Fact Reader", token: "fact-reader", locale: req.header("Accept-Language") });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [key, projection] of Object.entries(projections)) {
    const saved = await request("PUT", `product-projections/customer-ontology-${key}`, {
      name: key, description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {}, ...projection,
    });
    expect(saved.status, await saved.text()).toBe(200);
  }
  const html = Object.keys(projections).map(key => `<panel-member ref="${key}"></panel-member>`).join("");
  const saved = await request("PUT", `product-panels/${panelId}`, {
    name: "Customer ontology", description: "", visibility: "domain", revision: 0, content: { html: `<section>${html}</section>` },
    manifest: { state: {}, events: {}, members: Object.fromEntries(Object.keys(projections).map(key =>
      [key, { target: { projectionId: `customer-ontology-${key}` } }])) },
  });
  expect(saved.status, await saved.text()).toBe(200);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "Accept-Language": "en" }, body: JSON.stringify(body),
  });
}

async function read(member: string, dataName: string) {
  const response = await request("POST", "product-panels/read", { source: use, memberPath: [{ member }], dataName, inputs: {} });
  expect(response.status, member).toBe(200);
  return productPanelReadResponseSchema.parse(await response.json());
}

it("reads a customer class page and single objects with the owner's labels, totals and refusals", async () => {
  ownerCalls.length = 0;
  expect(await read("people", "rows")).toEqual({ status: "ready", value: {
    total: 7,
    rows: [
      {
        primaryKey: "p1", label: "Alice / Ops",
        fields: { id: "p1", name: "Alice", team: "Ops", tags: '["lead","oncall"]', note: "" },
        fieldLabels: { id: "ID", name: "Name", team: "Team", tags: "Tags", note: "Note" },
      },
      { primaryKey: "p3", label: "p3", fields: { id: "p3", name: "", team: "" }, fieldLabels: { id: "ID", name: "Name", team: "Team" } },
    ],
  } });
  expect(ownerCalls).toEqual([`page ${JSON.stringify({ classname: "person", pagenum: 1, pagecount: 2, search: "a" })}`]);
  expect(await read("secrets", "rows")).toEqual({ status: "forbidden" });

  expect(await read("detail", "record")).toMatchObject({ status: "ready", value: { primaryKey: "p1", label: "Alice / Ops" } });
  // The owner's code decides: no data permission is forbidden, a missing object keeps the owner's reason.
  expect(await read("hidden", "record")).toEqual({ status: "forbidden" });
  expect(await read("missing", "record")).toEqual({ status: "error", message: "Object person:p9 does not exist" });
});

it("reads a relationship's neighbors from the anchor's end, marking truncation and a refused relationship", async () => {
  ownerCalls.length = 0;
  expect(await read("staff", "neighbors")).toMatchObject({ status: "ready", value: {
    node: { className: "org", primaryKey: "o1", label: "Acme", layer: "fact" },
    neighbors: [{ className: "person", primaryKey: "p1", label: "Alice / Ops", layer: "fact" }],
    edges: [{
      relationKind: "person_to_org", direction: "incoming", derived: false,
      from: { className: "person", primaryKey: "p1" }, to: { className: "org", primaryKey: "o1" },
    }],
    relations: [{ relationKind: "person_to_org", status: "ok", edgeCount: 1, truncated: true }],
  } });
  expect(ownerCalls).toEqual(["dsl person_to_org from 1 limit 2"]);

  expect(await read("audits", "neighbors")).toMatchObject({ status: "ready", value: {
    node: { primaryKey: "o1" }, neighbors: [], edges: [],
    relations: [{ relationKind: "org_to_audit", status: "refused", edgeCount: 0, truncated: false }],
  } });
  expect(await read("crossed", "neighbors")).toEqual({ status: "error", message: "relationKinds can only name the source relationship" });
});
