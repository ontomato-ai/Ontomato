import { customerOwnerRead } from "../../__tests__/fixtures/workbench-panel-read-facts";
import { mountWorkbenchPanelReadsOwner } from "../../__tests__/fixtures/workbench-panel-reads-owner";
import { mountCurrentProductDecisions } from "../../__tests__/fixtures/product-grant-check";
import { mockApplicationEntry } from "../../__tests__/fixtures/application-entry";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
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
import { mountEntryDependencyOwner } from "../../__tests__/fixtures/entry-dependency-owner";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
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

/** The Java owner's attributes in their stored order. */
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
  app.post("/data/getWholeClassDataByPage", (req, res) => {
    reader(req);
    ownerCalls.push(`page ${JSON.stringify(req.body)}`);
    if (req.body.classname === "secret") {
      res.json({ success: false, code: "NO_VISIBLE_FIELDS", message: "No data permission for secret" });
      return;
    }
    res.json({ success: true, total_count: 7, readable_fields: ["id", "name", "team", "tags", "note"], data: [
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
}

const person = { className: "person", primaryKey: "p1" };
const org = { className: "org", primaryKey: "o1" };
const readCustomerFacts: typeof customerOwnerRead = (call, owner, viewer) => {
  if (call.type !== "customer:Relationship" || call.name !== "neighbors")
    return customerOwnerRead(call, owner, viewer);

  const { relationshipId, node, limit, offset } = call.parameters as {
    relationshipId: string; node: typeof org; limit: number; offset: number;
  };
  expect(owner.credential).toBe("fact-reader");
  expect(node).toEqual(org);
  ownerCalls.push(`neighbors ${relationshipId} limit ${limit} offset ${offset}`);
  const people = [{ id: "p1", name: "Alice", team: "Ops" }, { id: "p3", name: "Bob", team: "" }];
  const directions = relationshipId === "org_to_audit"
    ? [{ targetClass: "audit", direction: "outgoing", status: "refused", reason: "Class audit is outside the authorized scope" }]
    : [{ targetClass: "person", direction: "incoming", status: "ok", rows: people.slice(offset, offset + limit + 1) }];
  return {
    anchor: { attributes: attributes.org, answer: { success: true, data: { data: objects["org:o1"] } } },
    label: relationshipId, typeLabels: {}, targetAttributes: { person: attributes.person, audit: attributes.audit }, directions,
  };
};
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
  staff: {
    ...neighborsOf("person_to_org", { node: { literal: org }, limit: { literal: 1 } }),
    componentId: "@ontomato/sdk:InstanceGraph",
  },
  audits: neighborsOf("org_to_audit", { node: { literal: org } }),
  crossed: neighborsOf("person_to_org", { node: { literal: org }, relationKinds: { literal: ["org_to_audit"] } }),
};

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
  state.schema = `customer_ontology_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "customer-ontology-panel-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  mountEntryDependencyOwner(app, { token: "fixture-service", entries: domain => domain === "facts"
    ? [{ entryId: `${use.applicationId}/${use.useId}`, roots: { panelIds: [panelId], agentIds: [] } }] : [] });
  mountCurrentProductDecisions(app, {
    token: "fixture-service", domain: "facts",
    allow: (request, caller) => caller === "fact-reader" &&
      (request.ownerFacts.ownerId === "reader" || (request.verb === "USE" && request.ownerFacts.ownerId === null)),
  });
  app.post("/product-governance/register", (req, res) => { resourceIds.add(req.body.id); res.json({ success: true }); });
  app.post("/product-governance/check", (req, res) => res.json({ allowed: resourceIds.has(req.body.id) }));
  app.post("/product-governance/resources", (_req, res) => res.json({ ids: [...resourceIds] }));
  mockApplicationEntry(app, "/platform/applications", (req, res, next) => {
    if (req.query.applicationId !== use.applicationId) { next(); return; }
    expect(req.header("tk")).toBe("fact-reader");
    res.json({ success: true, data: {
      applicationId: use.applicationId, framePanelId: panelId, menu: { singleEntry: true, groups: [], panelUses: [] },
      use: { id: use.useId, pageKey: use.useId, path: `/applications/${use.applicationId}/${use.useId}`, panelId },
    } });
  });
  javaOwner(app);
  const authenticate: express.RequestHandler = (req, _res, next) => {
    Object.assign(req, { domainId: "facts", userId: "reader", userName: "Fact Reader", token: "fact-reader", locale: req.header("Accept-Language") });
    next();
  };
  mountWorkbenchPanelReadsOwner(app, { token: "fixture-service", viewer: () => ({ domainId: "facts", userId: "reader", userName: "Fact Reader" }), read: readCustomerFacts });
  const { createProductPanelReadRouter } = await import("../routes/product-panel-data");
  app.use("/api", createProductPanelReadRouter(authenticate));
  app.use("/api", authenticate);
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
  const saved = await request("PUT", `product-panels/${panelId}`, {
    name: "Customer ontology", description: "", visibility: "domain", revision: 0, content: vuePanelContent(...Object.keys(projections)),
    manifest: { state: {}, members: Object.fromEntries(Object.keys(projections).map(key =>
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
    method, headers: { tk: "fact-reader", "Content-Type": "application/json", "Accept-Language": "en" }, body: JSON.stringify(body),
  });
}

async function read(member: string, dataName: string, runtimeParams?: Record<string, number>) {
  const response = await request("POST", "product-panels/read", { source: use, memberPath: [{ member }], dataName, inputs: {}, runtimeParams });
  expect(response.status, member).toBe(200);
  return productPanelReadResponseSchema.parse(await response.json());
}

it("reads a customer class page and single objects with the owner's labels, totals and refusals", async () => {
  ownerCalls.length = 0;
  expect(await read("people", "rows")).toEqual({ status: "ready", value: {
    total: 7,
    fieldLabels: { id: "ID", name: "Name", team: "Team", tags: "Tags", note: "Note" },
    rows: [
      {
        className: "person", primaryKey: "p1", label: "Alice / Ops",
        fields: { id: "p1", name: "Alice", team: "Ops", tags: '["lead","oncall"]', note: "" },
        fieldLabels: { id: "ID", name: "Name", team: "Team", tags: "Tags", note: "Note" },
      },
      { className: "person", primaryKey: "p3", label: "p3", fields: { id: "p3", name: "", team: "" }, fieldLabels: { id: "ID", name: "Name", team: "Team", tags: "Tags", note: "Note" } },
    ],
  } });
  expect(ownerCalls).toEqual([`page ${JSON.stringify({ classname: "person", pagenum: 1, pagecount: 2, search: "a" })}`]);
  expect(await read("secrets", "rows")).toEqual({
    status: "error", code: "NO_VISIBLE_FIELDS", message: "No data permission for secret",
  });

  expect(await read("detail", "record")).toMatchObject({ status: "ready", value: { primaryKey: "p1", label: "Alice / Ops" } });
  // The owner's code decides: no data permission is forbidden, a missing object keeps the owner's reason.
  expect(await read("hidden", "record")).toEqual({ status: "forbidden", reason: "No data permission for p2" });
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
    nextOffset: 1, total: null,
  } });
  expect(await read("staff", "neighbors", { offset: 1 })).toMatchObject({ status: "ready", value: {
    neighbors: [{ primaryKey: "p3" }],
    relations: [{ relationKind: "person_to_org", status: "ok", edgeCount: 1, truncated: false }],
    nextOffset: null, total: 2,
  } });
  expect(ownerCalls).toEqual(["neighbors person_to_org limit 1 offset 0", "neighbors person_to_org limit 1 offset 1"]);

  expect(await read("audits", "neighbors")).toMatchObject({ status: "ready", value: {
    node: { primaryKey: "o1" }, neighbors: [], edges: [],
    relations: [{ relationKind: "org_to_audit", status: "refused", edgeCount: 0, truncated: false }],
  } });
  expect(await read("crossed", "neighbors")).toEqual({ status: "error", message: "relationKinds can only name the source relationship" });
});
