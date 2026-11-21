import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AGENT_DEFINITION, DELETE_AGENT, PRODUCT_PANEL, PRODUCT_PROJECTION, SCHEDULED_TASK, SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import {
  PROJECTION_REUSE_PANEL_HEADER, productPanelInUseErrorSchema, productPanelResponseSchema, productPanelUsedBySchema,
  productProjectionInUseErrorSchema, productProjectionResponseSchema,
  productProjectionUsedBySchema, registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import {
  panelPersonalStateReadRequestSchema, panelPersonalStateResponseSchema, panelPersonalStateWriteRequestSchema,
  productPanelNestedReadResponseSchema,
} from "@ontomato/contracts/panel-host";
import { panelDefinitionSnapshotSchema } from "@ontomato/contracts/product-subscriptions";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { installContentLayout } from "../../content/layout";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensurePanelOperationsSchema } from "../../infrastructure/postgres-migrations/20261118-panel-operations/schema";
import { panelStateKey } from "../../services/product-panels/personal-state-key";
import { errorHandler } from "../middleware/error-handler";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: {
  agentRuntime: () => ({ queryServiceToken: "fixture-service", callbackUrl: state.base }),
  publicBasePath: () => "",
} }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const projectionId = "projection-referenced";
const panelId = "panel-referencing";
const personalPanelId = "panel-personal";
const personalChildId = "panel-personal-child";
const snapshotPanelId = "panel-snapshot-test";
const nestedRootId = "nested-root-fixture";
const nestedAgentId = "51e55fe0-352a-4958-87a2-2d348d470758";
const nestedDeletes: string[] = [];
const grants = new Map<string, string>();
const shared = new Set<string>();
const trialApplications = new Set<string>();
const editOnlyPanels = new Set<string>();
let server: Server | undefined;
let contentRoot: string;
let revision: number;
const portType = { kind: "scalar", type: "string" } as const;
const projectionInput = {
  name: "Referenced projection", description: "", visibility: "domain",
  componentId: "@ontomato/sdk:ObjectSummary",
  inputs: { caption: portType }, outputs: { selected: portType }, config: {},
  data: {
    record: {
      source: { object: { literal: { className: SCHEDULED_TASK, primaryKey: "00000000-0000-4000-8000-000000000001" } } },
      read: "record", params: {},
    },
  },
};

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } } });
  state.schema = `product_panel_references_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensurePanelOperationsSchema(state.pool);

  contentRoot = await mkdtemp(join(tmpdir(), "product-panel-references-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });
  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  const granted = (token: string | undefined, id: string, verb: "use" | "edit") => {
    const owner = grants.get(id);
    return owner !== undefined && ((owner === token && (verb === "edit" || !editOnlyPanels.has(id))) || (verb === "use" && (
      token === "author" || shared.has(id) || id === personalPanelId || id === personalChildId ||
      id === snapshotPanelId || id === "visible-projection" ||
      (token === "hidden-panel-owner" && id === "cascade-in-use")
    )));
  };
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.set(req.body.id, req.body.ownerId);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: granted(req.header("tk"), req.body.id, req.body.verb) });
  });
  app.post("/product-governance/resources", (req, res) => {
    res.json({ ids: [...grants.keys()].filter(id => granted(req.header("tk"), id, req.body.verb)) });
  });
  app.post("/product-governance/unregister", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.delete(req.body.id);
    shared.delete(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/share", (req, res) => {
    const { id, shared: enabled } = req.body;
    if (!granted(req.header("tk"), id, "edit")) {
      res.status(403).json({ code: "PRODUCT_FORBIDDEN" });
      return;
    }
    if (enabled) shared.add(id);
    else shared.delete(id);
    res.json({ success: true });
  });
  app.get("/platform/applications/panel-uses/by-panel", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    expect(req.query.domainId).toBe("test-domain");
    const id = String(req.query.panelId);
    const data = trialApplications.has(id) ? [{
      applicationId: id, names: { en: "Trial application" }, useId: "trial", path: `/applications/${id}/trial`,
    }] : [];
    res.json({ success: true, data });
  });
  app.delete("/platform/applications/:id", (req, res) => {
    expect(req.get("tk")).toBe("author");
    expect(trialApplications.delete(req.params.id)).toBe(true);
    // Enterprise application retirement removes the Java Grant indexed by this same domain and ID.
    grants.delete(req.params.id);
    shared.delete(req.params.id);
    res.sendStatus(204);
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    if (req.query.applicationId === "app-nested") {
      expect(req.query.useId).toBe("main");
      res.json({ success: true, data: {
        applicationId: "app-nested", menu: { groups: [], panelUses: [] },
        use: { id: "main", pageKey: "main", path: "/applications/app-nested/main",
          panelId: nestedRootId, access: { kind: "domain-member" } },
      } });
      return;
    }
    expect(req.query).toEqual({ applicationId: "app-personal", useId: "main" });
    res.json({ success: true, data: {
      applicationId: "app-personal", menu: { groups: [], panelUses: [] },
      use: { id: "main", pageKey: "main", path: "/applications/app-personal/main",
        panelId: personalPanelId, access: { kind: "domain-member" } },
    } });
  });
  app.use("/api", (req, _res, next) => {
    const userId = req.header("X-Test-User") ?? "author";
    Object.assign(req, { domainId: "test-domain", userId, token: userId, locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  app.get("/api/assistant/agent-definitions/:id", (req, res) => {
    expect(req.get("tk")).toBe("author");
    expect(req.params.id).toBe(nestedAgentId);
    res.json({ id: nestedAgentId, name: "Nested analyst", description: "", icon: null, enabled: true,
      executionUserId: null, modelSelection: { modelId: null }, skills: [], systemPrompt: "" });
  });
  app.delete("/api/assistant/agent-definitions/:id", (req, res) => {
    expect(req.get("tk")).toBe("author");
    nestedDeletes.push(req.params.id);
    res.sendStatus(204);
  });
  app.use(errorHandler);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const projection = registerProductProjectionRequestSchema.parse({
    ...projectionInput, revision: 0,
  });
  const createdProjection = await request("PUT", `product-projections/${projectionId}`, "projection-owner", projection);
  const payload = await createdProjection.json();
  expect(createdProjection.status, JSON.stringify(payload)).toBe(200);
  revision = productProjectionResponseSchema.parse(payload).projection.revision;
  const panel = registerProductPanelRequestSchema.parse({
    name: "Referencing panel", description: "", visibility: "private", revision: 0,
    content: vuePanelContent("summary"),
    manifest: {
      state: { caption: { type: portType }, selected: { type: portType } },
      members: { summary: { target: { projectionId }, inputs: { caption: { state: "caption" } },
        outputs: { selected: { state: "selected" } } } },
      commands: {},
    },
  });
  const createdPanel = await request("PUT", `product-panels/${panelId}`, "author", panel);
  const panelPayload = await createdPanel.json();
  expect(createdPanel.status, JSON.stringify(panelPayload)).toBe(200);
  expect(productPanelResponseSchema.parse(panelPayload).panel.id).toBe(panelId);
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, user: string, body?: object, headers?: Record<string, string>) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "X-Test-User": user, ...headers }, body: JSON.stringify(body),
  });
}

it("reads a selected nested panel or projection and freezes its actual publisher through confirmation", async () => {
  const child = "nested-child-fixture", alternate = "nested-alternate-fixture";
  const list = "nested-list-fixture", remove = "nested-remove-fixture";
  const record = { name: "Nested record", description: "", visibility: "domain" };
  const source = { kind: "registered", applicationId: "app-nested", useId: "main" };
  const use = { applicationId: source.applicationId, useId: source.useId };
  const save = async (resource: string, body: object, revision = 0) => {
    const response = await request("PUT", resource, "author", { ...record, ...body, revision });
    expect(response.status, await response.text()).toBe(200);
  };
  await save(`product-projections/${list}`, {
    componentId: "@ontomato/sdk:PanelData", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SDK_COMPONENT } }, read: "catalogue", params: {} } },
  });
  const agentPort = { kind: "object", objectType: AGENT_DEFINITION };
  await save(`product-projections/${remove}`, {
    componentId: "@ontomato/sdk:OperationButton", inputs: { agent: agentPort }, outputs: {}, config: { operation: "remove" },
    data: {}, operations: { remove: { operation: { kind: "PlatformOperation", id: DELETE_AGENT }, target: { input: "agent" } } },
  });
  const theme = { dark: { "--el-color-primary": "#3758ca" } };
  for (const id of [child, alternate]) {
    await save(`product-panels/${id}`, {
      ...(id === child && { theme }),
      content: vuePanelContent("components", "approve"), manifest: { state: { agent: { type: agentPort } }, members: {
        components: { target: { projectionId: list } },
        approve: { target: { projectionId: remove }, inputs: { agent: { state: "agent" } } },
      }, commands: {} },
    });
  }
  const root = {
    content: vuePanelContent("detail", "fixed", "choice", "objectDetail"),
    manifest: { state: {
      selectedPanel: { type: { kind: "object", objectType: PRODUCT_PANEL } },
      selectedProjection: { type: { kind: "object", objectType: PRODUCT_PROJECTION } },
      selectedAgent: { type: agentPort },
    }, members: {
      detail: { target: { fromState: "selectedPanel", candidates: { rule: "usable" } } },
      fixed: { target: { panelId: child } },
      objectDetail: { target: { fromState: "selectedAgent", candidates: { rule: "objectDetail" } } },
      choice: { target: { fromState: "selectedProjection", candidates: { projectionIds: [list] } } },
    }, commands: {} },
  };
  await save(`product-panels/${nestedRootId}`, root);
  for (const id of [nestedRootId, child, list, remove]) shared.add(id);

  const selectedPanel = (panelId: string) => ({ member: "detail", selection: {
    stateValue: { className: PRODUCT_PANEL, primaryKey: panelId }, target: { panelId },
  } });
  const detail = selectedPanel(child);
  const nested = await request("POST", "product-panels/nested", "nested-reader", { source, memberPath: [detail] });
  expect(nested.status).toBe(200);
  expect(productPanelNestedReadResponseSchema.parse(await nested.json()).panel).toMatchObject({ id: child, revision: 1, theme });
  expect((await request("POST", "product-panels/nested", "nested-reader",
    { source, memberPath: [selectedPanel(alternate)] })).status).toBe(403);

  const componentChoice = { member: "choice", selection: {
    stateValue: { className: PRODUCT_PROJECTION, primaryKey: list }, target: { projectionId: list },
  } };
  const detailSelection = { stateValue: { className: AGENT_DEFINITION, primaryKey: nestedAgentId } };
  const openDetail = { member: "objectDetail", selection: detailSelection };
  const findDetail = (memberPath: object[]) =>
    request("POST", "product-panels/nested", "nested-reader", { source, memberPath });
  expect((await findDetail([openDetail])).status).toBe(404);
  const setDetail = (panelId: string) => state.pool!.query(
    `INSERT INTO "${state.schema}".product_object_details (domain_id, class_name, panel_id, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (domain_id, class_name) DO UPDATE SET panel_id=EXCLUDED.panel_id`,
    ["test-domain", AGENT_DEFINITION, panelId, "author"],
  );
  await setDetail(alternate);
  expect((await findDetail([openDetail])).status).toBe(403);
  await setDetail(child);
  const discovered = await findDetail([openDetail]);
  expect(discovered.status).toBe(200);
  const found = productPanelNestedReadResponseSchema.parse(await discovered.json()).panel;
  expect(found).toMatchObject({ id: child, revision: 1 });

  expect((await findDetail([{ member: "detail", selection: { stateValue: detail.selection.stateValue } }])).status).toBe(403);
  expect((await findDetail([openDetail, { member: "components" }])).status).toBe(400);
  expect((await request("POST", "product-panels/read", "nested-reader",
    { source, memberPath: [openDetail, { member: "components" }], dataName: "rows", inputs: {} })).status).toBe(400);
  const resolvedDetail = { ...openDetail, selection: { ...detailSelection, target: { panelId: found.id } } };

  for (const memberPath of [[detail, { member: "components" }], [resolvedDetail, { member: "components" }], [componentChoice]]) {
    const datum = await request("POST", "product-panels/read", "nested-reader", { source, memberPath, dataName: "rows", inputs: {} });
    expect(await datum.json()).toMatchObject({ status: "ready", value: expect.arrayContaining([
      expect.objectContaining({ primaryKey: "@ontomato/sdk:ObjectList" }),
    ]) });
  }
  const unknownDatum = { source, memberPath: [detail, { member: "components" }], dataName: "components.rows", inputs: {} };
  const unknown = await request("POST", "product-panels/read", "nested-reader", unknownDatum);
  expect(await unknown.json()).toEqual({
    status: "error", message: 'Member "components" does not declare dataName "components.rows". Declared data names: ["rows"].',
  });

  const unreadable = await request("POST", "product-panels/read", "nested-reader", {
    ...unknownDatum, memberPath: [selectedPanel(alternate), { member: "components" }],
  });
  expect(await unreadable.json()).toEqual({ status: "forbidden" });

  await setDetail(alternate);
  const oldDetail = await request("POST", "product-panels/read", "nested-reader", {
    source, memberPath: [resolvedDetail, { member: "components" }], dataName: "rows", inputs: {},
  });
  expect(await oldDetail.json()).toEqual({ status: "forbidden" });

  const outside = await request("POST", "product-panels/read", "nested-reader", { source, memberPath: [{
    ...componentChoice, selection: { stateValue: { className: PRODUCT_PROJECTION, primaryKey: remove }, target: { projectionId: remove } },
  }], dataName: "rows", inputs: {} });
  expect(await outside.json()).toMatchObject({ status: "error", message: expect.stringContaining("outside this member's candidates") });

  const memberPath = [detail, { member: "approve" }];
  const query = new URLSearchParams({ ...use, operationId: "detail.approve.remove", memberPath: JSON.stringify(memberPath) });
  const descriptor = await request("GET", `panel-operations/descriptor?${query}`, "author");
  expect(await descriptor.json()).toMatchObject({ handlerRef: DELETE_AGENT, target: { source: "input", input: "agent" } });
  query.set("operationId", "fixed.approve.remove");
  const wrongPath = await request("GET", `panel-operations/descriptor?${query}`, "author");
  expect(wrongPath.status).toBe(422);
  expect(await wrongPath.json()).toMatchObject({ error: { code: "OPERATION_UNAVAILABLE" } });

  const call = { target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: nestedAgentId }, input: {} };
  async function prepare(operationId: string, path: object[]) {
    const response = await request("POST", "panel-operations/intents", "author", { ...use, operationId, memberPath: path, call });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.confirmation).toMatchObject({ kind: "impact", impact: { total: 1 } });
    return body.intentId as string;
  }
  const valid = await prepare("detail.approve.remove", memberPath);
  const stale = await prepare("fixed.approve.remove", [{ member: "fixed" }, { member: "approve" }]);
  expect(nestedDeletes).toEqual([]);
  await save(`product-panels/${nestedRootId}`, { ...root, manifest: { ...root.manifest, members: {
    ...root.manifest.members, fixed: { target: { panelId: alternate } },
  } } }, 1);
  const refused = await request("POST", `panel-operations/intents/${stale}/dispatch`, "author", {});
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: "INTENT_CHANGED" } });
  expect(nestedDeletes).toEqual([]);
  const dispatched = await request("POST", `panel-operations/intents/${valid}/dispatch`, "author", {});
  expect(await dispatched.json()).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
  expect(nestedDeletes).toEqual([nestedAgentId]);
});

it("counts a direct member in projection used-by and keeps the hidden panel's identity private", async () => {
  const resource = `product-projections/${projectionId}/used-by`;
  const visible = await request("GET", resource, "author");
  const hidden = await request("GET", resource, "projection-owner");
  expect(visible.status).toBe(200);
  expect(hidden.status).toBe(200);
  expect(productProjectionUsedBySchema.parse(await visible.json())).toEqual({
    panels: [{ id: panelId, name: "Referencing panel" }], hiddenCount: 0,
  });
  expect(productProjectionUsedBySchema.parse(await hidden.json())).toEqual({ panels: [], hiddenCount: 1 });
});

it("rejects deletion when a direct member references the projection, even for a hidden panel", async () => {
  const resource = `product-projections/${projectionId}`;
  const deletion = await request("DELETE", `${resource}?revision=${revision}`, "projection-owner");
  const payload = await deletion.json();
  expect(deletion.status, JSON.stringify(payload)).toBe(409);
  expect(productProjectionInUseErrorSchema.parse(payload).details).toEqual({ panels: [], hiddenCount: 1 });
  const current = await request("GET", resource, "projection-owner");
  expect(current.status).toBe(200);
  expect(productProjectionResponseSchema.parse(await current.json()).projection.revision).toBe(revision);
});

it("rejects deleting a panel that is the current detail for a class", async () => {
  await state.pool!.query(
    `INSERT INTO "${state.schema}".product_object_details (domain_id, class_name, panel_id, updated_by) VALUES ($1,$2,$3,$4)`,
    ["test-domain", "Teacher", panelId, "author"],
  );
  const resource = `product-panels/${panelId}`;
  const current = await request("GET", resource, "author");
  const panel = productPanelResponseSchema.parse(await current.json()).panel;
  const usedBy = await request("GET", `${resource}/used-by`, "author");
  expect(usedBy.status).toBe(200);
  const usage = productPanelUsedBySchema.parse(await usedBy.json());
  expect(usage.classNames).toEqual(["Teacher"]);
  const deletion = await request("DELETE", `${resource}?revision=${panel.revision}`, "author");
  const payload = await deletion.json();
  expect(deletion.status, JSON.stringify(payload)).toBe(409);
  expect(productPanelInUseErrorSchema.parse(payload).details).toEqual(usage);
  const retained = await request("GET", resource, "author");
  expect(retained.status).toBe(200);
  expect(productPanelResponseSchema.parse(await retained.json()).panel).toEqual(panel);
});

async function savePanel(id: string, manifest: object, revision: number = 0) {
  return request("PUT", `product-panels/${id}`, "author", registerProductPanelRequestSchema.parse({
    name: id, description: "", visibility: "domain", revision, content: vuePanelContent(), manifest,
  }));
}

it("includes the recorded template flag in panel catalog summaries", async () => {
  const id = "catalog-template";
  const saved = await request("PUT", `product-panels/${id}`, "author", {
    name: id, template: true, description: "", visibility: "private", revision: 0,
    content: vuePanelContent(), manifest: { state: {}, members: {}, commands: {} },
  });
  expect(saved.status, await saved.text()).toBe(200);
  const listed = await request("GET", `product-panels?q=${id}`, "author");
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({ items: [{ id, template: true }] });
});

async function saveProjection(id: string, user = "author") {
  const saved = await request("PUT", `product-projections/${id}`, user, {
    ...projectionInput, visibility: "private", revision: 0,
  });
  expect(saved.status, await saved.text()).toBe(200);
}

function projectionMembers(...ids: string[]) {
  return Object.fromEntries(ids.map((projectionId, index) => [`member${index}`, { target: { projectionId } }]));
}

it("lets the panel's registered owner clean it up after retiring a same-ID trial application", async () => {
  const id = "app-orphaned-panel", projections = ["orphan-summary-one", "orphan-summary-two"];
  for (const projection of projections) await saveProjection(projection);
  const manifest = { state: {}, commands: {}, members: projectionMembers(...projections) };
  expect((await savePanel(id, manifest)).status).toBe(200);
  trialApplications.add(id);
  const resource = `product-panels/${id}`;
  const inUse = await request("DELETE", `${resource}?revision=1`, "author");
  expect(inUse.status).toBe(409);
  expect(productPanelInUseErrorSchema.parse(await inUse.json()).details.applicationEntries)
    .toEqual([{ applicationId: id, applicationName: "Trial application", entryId: "trial", path: `/applications/${id}/trial` }]);

  const retired = await fetch(`${state.base}/platform/applications/${id}`, { method: "DELETE", headers: { tk: "author" } });
  expect(retired.status).toBe(204);
  const record = await request("GET", resource, "author");
  expect(record.status).toBe(200);
  expect(productPanelResponseSchema.parse(await record.json()).panel).toMatchObject({ id, ownerId: "author", revision: 1, editable: false });
  const rows = await request("GET", `product-panels?scope=mine&q=${id}`, "author");
  expect(await rows.json()).toMatchObject({ items: [{ id, revision: 1 }] });
  expect((await request("GET", resource, "unrelated-reader")).status).toBe(403);
  const entry = new URLSearchParams({ applicationId: id, useId: "trial", access: "domain-member", pageKey: "trial" });
  expect((await request("GET", `${resource}?${entry}`, "author")).status).toBe(403);
  expect((await request("DELETE", `${resource}?revision=1`, "unrelated-reader")).status).toBe(403);

  const deleted = await request("DELETE", `${resource}?revision=1`, "author");
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toMatchObject({ success: true, deletedProjectionIds: projections });
});

it("lets an owner delete an unreadable panel by ID once its real references are retired", async () => {
  const id = "legacy-events-panel", resource = `product-panels/${id}`;
  expect((await savePanel(id, { state: {}, members: {}, commands: {} })).status).toBe(200);
  await state.pool!.query(
    `UPDATE "${state.schema}".product_panels SET definition =
      jsonb_set(definition #- '{manifest,commands}', '{manifest,events}', '{}'::jsonb)
      WHERE id=$1`, [id],
  );
  trialApplications.add(id);
  expect((await request("DELETE", resource, "author")).status).toBe(409);
  const read = await request("GET", resource, "author");
  expect(read.status).toBe(422);
  expect(await read.json()).toMatchObject({ error: {
    code: "PRODUCT_DEFINITION_INVALID", message: expect.stringContaining(`Panel '${id}': Unrecognized field 'manifest.events'`),
  } });
  const listed = await request("GET", `product-panels?q=${id}`, "author");
  expect(await listed.json()).toMatchObject({ items: [], unavailableItems: [
    { id, revision: 1, reason: expect.stringContaining("manifest.events") },
  ] });
  const retired = await fetch(`${state.base}/platform/applications/${id}`, { method: "DELETE", headers: { tk: "author" } });
  expect(retired.status).toBe(204);
  expect((await request("DELETE", resource, "unrelated-reader")).status).toBe(403);
  expect((await request("DELETE", `${resource}?revision=2`, "author")).status).toBe(409);
  const removed = await request("DELETE", resource, "author");
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({ success: true });
  const stored = await state.pool!.query(`SELECT id FROM "${state.schema}".product_panels WHERE id=$1`, [id]);
  expect(stored.rows).toEqual([]);
});

it("exposes a panel to an editor without a use Grant for management", async () => {
  const id = "editor-without-use";
  expect((await savePanel(id, { state: {}, commands: {}, members: {} })).status).toBe(200);
  grants.set(id, "editor");
  editOnlyPanels.add(id);
  const resource = `product-panels/${id}`;
  const record = await request("GET", resource, "editor");
  expect(record.status).toBe(200);
  expect(productPanelResponseSchema.parse(await record.json()).panel).toMatchObject({ id, ownerId: "author", editable: true });
  expect(await (await request("GET", `product-panels?q=${id}`, "editor")).json()).toMatchObject({ items: [{ id, editable: true }] });
  const entry = new URLSearchParams({ applicationId: "editor-fixture", useId: "edit", access: "domain-member", pageKey: "edit" });
  expect((await request("GET", `${resource}?${entry}`, "editor")).status).toBe(403);
  expect((await request("DELETE", `${resource}?revision=1`, "editor")).status).toBe(200);
});

it("only accepts a recovered projection update while the original panel is its sole user", async () => {
  const id = "recovered-projection", originalPanel = "recovery-original", laterPanel = "recovery-later";
  const resource = `product-projections/${id}`;
  await saveProjection(id);
  const manifest = { state: {}, commands: {}, members: projectionMembers(id) };
  expect((await savePanel(originalPanel, manifest)).status).toBe(200);
  const usage = await request("GET", `${resource}/used-by`, "author");
  expect(productProjectionUsedBySchema.parse(await usage.json())).toEqual({
    panels: [{ id: originalPanel, name: originalPanel }], hiddenCount: 0,
  });
  const guarded = { [PROJECTION_REUSE_PANEL_HEADER]: originalPanel };
  const change = { ...projectionInput, name: "Updated", visibility: "private", revision: 1 };
  const soleUpdate = await request("PUT", resource, "author", change, guarded);
  expect(soleUpdate.status).toBe(200);
  expect(productProjectionResponseSchema.parse(await soleUpdate.json()).projection.revision).toBe(2);

  expect((await savePanel(laterPanel, manifest)).status).toBe(200);
  const sharedChange = { ...change, name: "Shared update", revision: 2 };
  const refused = await request("PUT", resource, "author", sharedChange, guarded);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: "PROJECTION_REUSE_CONFLICT" } });
  const current = await request("GET", resource, "author");
  expect(productProjectionResponseSchema.parse(await current.json()).projection).toMatchObject({ name: "Updated", revision: 2 });

  const explicitUpdate = await request("PUT", resource, "author", sharedChange);
  expect(explicitUpdate.status).toBe(200);
  expect(productProjectionResponseSchema.parse(await explicitUpdate.json()).projection).toMatchObject({
    name: "Shared update", revision: 3,
  });
});

it("shares editable member projections, reports skipped members once and does not revoke their sharing", async () => {
  const editable = "share-editable", restricted = "share-restricted", id = "share-panel";
  await saveProjection(editable);
  await saveProjection(restricted, "projection-owner");
  const saved = await savePanel(id, { state: {}, members: projectionMembers(editable, restricted, restricted), commands: {} });
  expect(saved.status, await saved.text()).toBe(200);
  const path = `product-panels/${id}/domain-grant`;
  const enabled = await request("POST", path, "author", { shared: true });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ success: true, skippedProjectionIds: [restricted] });
  const read = (kind: string, productId: string) => request("GET", `product-${kind}s/${productId}`, "reader");
  expect((await read("panel", id)).status).toBe(200);
  expect((await read("projection", editable)).status).toBe(200);
  expect((await read("projection", restricted)).status).toBe(403);

  const disabled = await request("POST", path, "author", { shared: false });
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({ success: true, skippedProjectionIds: [] });
  expect((await read("panel", id)).status).toBe(403);
  expect((await read("projection", editable)).status).toBe(200);
});

it("shares editable default placements and reports the defaults the caller cannot share", async () => {
  const editable = "share-default-editable", restricted = "share-default-restricted", id = "share-default-panel";
  await saveProjection(editable);
  await saveProjection(restricted, "projection-owner");
  const type = { kind: "placement", candidates: { rule: "usable" } };
  const field = (projectionId: string) => ({ type, default: { id: "placed", target: { projectionId } } });
  const saved = await savePanel(id, {
    state: { editable: field(editable), restricted: field(restricted) }, members: {}, commands: {},
  });
  expect(saved.status, await saved.text()).toBe(200);
  const enabled = await request("POST", `product-panels/${id}/domain-grant`, "author", { shared: true });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ success: true, skippedProjectionIds: [restricted] });
  expect((await request("GET", `product-projections/${editable}`, "reader")).status).toBe(200);
  expect((await request("GET", `product-projections/${restricted}`, "reader")).status).toBe(403);
});

it("deletes only editable orphan projections and honors hidden panel references", async () => {
  const orphan = "cascade-orphan", restricted = "cascade-restricted", inUse = "cascade-in-use", id = "cascade-panel";
  await saveProjection(orphan);
  await saveProjection(restricted, "projection-owner");
  await saveProjection(inUse);
  const hidden = await request("PUT", "product-panels/cascade-hidden-panel", "hidden-panel-owner", {
    name: "Hidden", description: "", visibility: "private", revision: 0, content: vuePanelContent(),
    manifest: { state: {}, members: projectionMembers(inUse), commands: {} },
  });
  expect(hidden.status, await hidden.text()).toBe(200);
  const saved = await savePanel(id, { state: {}, members: projectionMembers(orphan, restricted, inUse), commands: {} });
  expect(saved.status, await saved.text()).toBe(200);
  const deletion = await request("DELETE", `product-panels/${id}?revision=1`, "author");
  expect(deletion.status).toBe(200);
  expect(await deletion.json()).toEqual({
    success: true, deletedProjectionIds: [orphan], retainedProjectionIdsWithoutEdit: [restricted],
  });
  const { rows } = await state.pool!.query(
    `SELECT id FROM "${state.schema}".product_projections WHERE id=ANY($1::text[]) ORDER BY id`, [[orphan, restricted, inUse]],
  );
  expect(rows.map(row => row.id)).toEqual([inUse, restricted]);
  expect(grants.has(orphan)).toBe(false);
  expect(grants.has(id)).toBe(false);
  expect(grants.has(restricted)).toBe(true);
  expect(grants.has(inUse)).toBe(true);
});

it("cleans up a panel's default placement and preserves projections used by other placements", async () => {
  const defaultId = "cleanup-default", personalId = "cleanup-personal";
  const usedByDefault = "cleanup-used-by-default", usedPersonally = "cleanup-used-personally";
  const id = "cleanup-placement-panel", otherId = "cleanup-other-panel";
  for (const projectionId of [defaultId, personalId, usedByDefault, usedPersonally]) await saveProjection(projectionId);
  const type = { kind: "placement", candidates: { rule: "usable" } };
  const placement = (projectionId: string) => ({ id: "placed", target: { projectionId } });
  const saved = await savePanel(id, {
    state: { defaultSlot: { type, default: placement(defaultId) }, personalSlot: { type, personal: true } },
    members: projectionMembers(usedByDefault, usedPersonally), commands: {},
  });
  expect(saved.status, await saved.text()).toBe(200);
  const other = await savePanel(otherId, {
    state: { defaultSlot: { type, default: placement(usedByDefault) }, personalSlot: { type, personal: true } },
    members: {}, commands: {},
  });
  expect(other.status, await other.text()).toBe(200);
  await state.pool!.query(
    `INSERT INTO "${state.schema}".user_preferences (user_id, key, value) VALUES ('reader',$1,$2), ('reader',$3,$4)`,
    [panelStateKey("test-domain", id, [], id, "personalSlot"), placement(personalId),
      panelStateKey("test-domain", otherId, [], otherId, "personalSlot"), placement(usedPersonally)],
  );

  const removal = await request("DELETE", `product-panels/${id}?revision=1`, "author");
  expect(removal.status).toBe(200);
  expect(await removal.json()).toEqual({
    success: true, deletedProjectionIds: [defaultId], retainedProjectionIdsWithoutEdit: [],
  });
  const { rows } = await state.pool!.query(
    `SELECT id FROM "${state.schema}".product_projections WHERE id=ANY($1::text[]) ORDER BY id`,
    [[defaultId, personalId, usedByDefault, usedPersonally]],
  );
  expect(rows.map(row => row.id)).toEqual([personalId, usedByDefault, usedPersonally]);
});

it("rejects a reverse cycle and protects a nested panel referenced by its parent", async () => {
  const leafId = "panel-cycle-leaf", parentId = "panel-cycle-parent";
  const manifest = { state: {}, members: {}, commands: {} };
  const leafResponse = await savePanel(leafId, manifest);
  expect(leafResponse.status).toBe(200);
  const leaf = productPanelResponseSchema.parse(await leafResponse.json()).panel;
  const parentResponse = await savePanel(parentId, { ...manifest, members: { leaf: { target: { panelId: leafId } } } });
  expect(parentResponse.status).toBe(200);
  const update = await savePanel(leafId, { ...manifest, members: { parent: { target: { panelId: parentId } } } }, leaf.revision);
  const error = await update.text();
  expect(update.status, error).toBe(409);
  expect(error).toContain("PANEL_REFERENCE_CYCLE");
  expect(error).toContain("parent");
  expect(error).toContain("leaf");
  const deleted = await request("DELETE", `product-panels/${leafId}?revision=${leaf.revision}`, "author");
  expect(deleted.status).toBe(409);
  expect(productPanelInUseErrorSchema.parse(await deleted.json()).details.panels).toEqual([{ id: parentId, name: parentId }]);
});

it("writes declared personal state under the authenticated viewer and isolates it from another viewer", async () => {
  const child = await savePanel(personalChildId, {
    state: {
      chosen: { type: portType, personal: true }, transient: { type: portType },
      positions: { type: { kind: "node-positions" }, personal: true },
    },
    members: {}, commands: {},
  });
  expect(child.status, await child.text()).toBe(200);
  const target = { panelId: personalChildId };
  const defaultPlacement = { id: "preferred", target };
  const root = await savePanel(personalPanelId, {
    state: { destination: { type: { kind: "placement", candidates: { panelIds: [personalChildId] } }, default: defaultPlacement } },
    members: { left: { target }, right: { target } }, commands: {},
  });
  expect(root.status, await root.text()).toBe(200);
  const source = { kind: "registered", applicationId: "app-personal", useId: "main" };
  const write = (user: string, member: string, values: object) => request("PUT", "product-panels/personal-state", user,
    panelPersonalStateWriteRequestSchema.parse({ source, memberPath: [{ member }], values }));
  const read = (user: string, member: string) => request("POST", "product-panels/personal-state/read", user,
    panelPersonalStateReadRequestSchema.parse({ source, memberPath: [{ member }], fields: ["chosen", "positions"] }));
  const positions = { a: { x: -6.25, y: 14 }, b: { x: 0, y: 0 } };
  expect((await write("author", "left", { chosen: "left choice", positions })).status).toBe(200);
  const rejected = await write("author", "left", { chosen: "changed", positions: { a: { x: "bad", y: 0 } } });
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).toContain("PANEL_PERSONAL_VALUE_INVALID");
  expect((await write("author", "right", { chosen: "right choice" })).status).toBe(200);
  expect((await write("author", "left", { chosen: "changed", transient: "invalid" })).status).toBe(400);

  for (const [user, member, values] of [
    ["author", "left", { chosen: "left choice", positions }],
    ["author", "right", { chosen: "right choice" }],
    ["another-viewer", "left", {}],
  ] as const) {
    const response = await read(user, member);
    expect(response.status).toBe(200);
    expect(panelPersonalStateResponseSchema.parse(await response.json())).toEqual({ values });
  }
  expect((await write("author", "left", { positions: null })).status).toBe(200);
  expect(panelPersonalStateResponseSchema.parse(await (await read("author", "left")).json())).toEqual({
    values: { chosen: "left choice", positions: null },
  });
  expect((await read("author", "undeclared")).status).toBe(403);
  const placementRead = (placement: typeof defaultPlacement) => request(
    "POST", "product-panels/personal-state/read", "author", {
      source, memberPath: [{ member: "$state.destination", selection: { placement } }], fields: ["chosen", "positions"],
    });
  // The placement comes from saved/default state, even when the layout does not mention it.
  const admitted = await placementRead(defaultPlacement);
  expect(admitted.status).toBe(200);
  expect(panelPersonalStateResponseSchema.parse(await admitted.json())).toEqual({ values: {} });
  expect((await placementRead({ ...defaultPlacement, target: { panelId: panelId } })).status).toBe(403);
});

it.each([
  ["input", { inputs: { caption: { kind: "scalar", type: "number" } } }, "caption"],
  ["output", { outputs: {} }, "selected"],
] as const)("rejects breaking a private parent's connected %s", async (suffix, change, port) => {
  const id = `ports-${suffix}`, resource = `product-projections/${id}`;
  const beforeSave = await request("PUT", resource, "projection-owner",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, revision: 0 }));
  expect(beforeSave.status).toBe(200);
  const before = productProjectionResponseSchema.parse(await beforeSave.json()).projection;
  const parent = `panel-ports-${suffix}`;
  const attached = await savePanel(parent, {
    state: { caption: { type: portType }, selected: { type: portType } },
    members: { summary: { target: { projectionId: id }, inputs: { caption: { state: "caption" } },
      outputs: { selected: { state: "selected" } } } },
    commands: {},
  });
  expect(attached.status).toBe(200);
  const update = await request("PUT", resource, "projection-owner",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, ...change, revision: before.revision }));
  const payload = await update.text();
  expect(update.status, payload).toBe(409);
  expect(payload).toContain("PRODUCT_PORT_IN_USE");
  expect(payload).toContain(port);
  expect(payload).not.toContain(parent);
  const after = await request("GET", resource, "projection-owner");
  expect(productProjectionResponseSchema.parse(await after.json()).projection).toEqual(before);
});

it("returns a forbidden member in the snapshot alongside the authorized sibling", async () => {
  const id = "visible-projection";
  const visible = await request("PUT", `product-projections/${id}`, "author",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, revision: 0 }));
  expect(visible.status).toBe(200);
  const saved = await savePanel(snapshotPanelId, { state: {}, commands: {}, members: {
    shown: { target: { projectionId: id } }, hidden: { target: { projectionId } },
  } });
  expect(saved.status).toBe(200);
  const response = await request("GET", `product-panels/${snapshotPanelId}/snapshot`, "another-viewer");
  expect(response.status).toBe(200);
  const snapshot = panelDefinitionSnapshotSchema.parse(await response.json());
  expect(snapshot.members).toEqual(expect.arrayContaining([
    { status: "forbidden", memberPath: [{ member: "hidden" }] },
    { status: "ready", memberPath: [{ member: "shown" }], target: { kind: "projection", id }, revision: 1 },
  ]));
  expect(snapshot.projections).toEqual([{ id, revision: 1 }]);
});
