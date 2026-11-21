import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { appsSdkComponentCatalogSchema } from "@ontomato/contracts/apps-sdk";
import {
  APPLICATION_PANEL_REFERENCES_PATH, productPanelResponseSchema, productProjectionResponseSchema,
  registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { panelOperationDescriptorResponseSchema } from "@ontomato/contracts/panel-agent";
import { platformTypeTableResponseSchema } from "@ontomato/contracts/platform-type-table";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { panelManifestSchema, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import {
  panelDefinitionSnapshotSchema, productDefinitionStreamFrameSchema, productDefinitionStreamRequestSchema,
  type ProductDefinitionRevision,
} from "@ontomato/contracts/product-subscriptions";
import { protectedSkillRef } from "../../core/skills/providers";
import { installContentLayout } from "../../content/layout";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { readSseFrames } from "../../infrastructure/agent-runtime/client";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "", denyCustomerTypes: false }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "",
    queryBase: () => state.base, queryTimeout: () => 30000,
  },
}));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const trial = await import(fileURLToPath(new URL("../../../../apps-sdk/examples/panels/schedules-trial/definitions.mjs", import.meta.url))) as {
  panels: { id: string; directory: string; name: string; description: string; manifest: unknown }[];
  projections: { id: string; input: Record<string, unknown> & {
    data: Record<string, { source: { type: { kind: string; id: string } } | { operation: { kind: string; id: string } } | { object: { input: string } }; read: string; params: object }>;
  } }[];
  panelContent(directory: string): unknown;
};
let server: Server;
let contentRoot: string;
let cataloguePath: string;
const grants = new Set<string>();
const codePanelId = "panel-schedules-mixed";
const builtinPanelId = "builtin-product-host-fixture";
const builtinProjectionId = "builtin-product-components-fixture";
const builtinUse = {
  applicationId: "app-builtin-fixture", useId: "catalogue", panelId: builtinPanelId,
  path: "/applications/app-builtin-fixture/catalogue",
  entrance: { access: "domain-member" as const, pageKey: "catalogue" },
};
let builtinUses: (typeof builtinUse)[] = [];

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  state.schema = `direct_panel_host_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensureAssistantSchema(state.pool);
  await ensureAssistantDefaultPromptSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "direct-panel-host-"));
  cataloguePath = await writeBundledAppSdkFixture(contentRoot);
  const publicSkillsRoot = path.join(contentRoot, "public-skills");
  await mkdir(publicSkillsRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot, prompts: [], runtimeResources: [] });

  const { panelOperationsRouter, productPanelsInternalRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { appBuilderRouter } = await import("../routes/app-builder");
  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  registerPanelSkillProvider();
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    const token = req.header("tk");
    const allowed = isBuiltinProductId(req.body.id)
      ? (token === "host-reader" || token === "host-no-entry") && req.body.verb === "use"
      : token === "host-reader" && grants.has(req.body.id);
    res.json({ allowed });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    res.json({ ids: [...grants] });
  });
  app.get("/platform/applications", (req, res) => {
    expect(req.query.purpose).toBe("navigation");
    res.json({ success: true, data: req.header("tk") !== "host-reader" ? [] : [{
      id: "app-builder", kind: "native", names: { en: "App Builder" }, descriptions: {}, icon: "Hammer",
      rail: "apps", category: "build", sort: 1, entry: { path: "/app-builder" },
      entryAccess: ["app-builder"], scheduleAdapter: null, releaseId: null,
    }] });
  });
  app.get("/ontology/model/object-types", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    expect(req.header("Accept-Language")).toBe("en");
    if (state.denyCustomerTypes) {
      res.status(403).json({ success: false, code: "ONTOLOGY_FORBIDDEN", message: "The author may not read the domain's object types" });
      return;
    }
    res.json(["expense", "CostCenter"].map(className => ({
      className, showName: className, classDesc: "", attributeCount: 1,
      businessKeyCount: 0, relationshipCount: 0, primaryKey: { status: "ok", name: "id" },
    })));
  });
  app.post("/action/queryList", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    expect(req.body).toEqual({ status: "PUBLISHED" });
    res.json({ success: true, data: [
      ...["missing-function-one", "missing-function-two", "missing-function-three"].map(id => ({
        id, name: "author-private-name", codeHash: "author-private-hash", target: null, function: null,
      })),
      {
        id: "approve-expense", name: "Approve expense", codeHash: "author-private-hash",
        target: { className: "expense", keyParameter: "id" },
        function: { code: "author-private-source", parameters: [
          { name: "id", type: "TYPE_STRING" }, { name: "amount", type: "TYPE_NUMBER" },
        ] },
      },
    ] });
  });
  app.get("/platform/applications/panel-skill-sources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    res.json({ success: true, data: builtinUses });
  });
  app.get("/platform/page-skills", (req, res) => {
    const entrances = req.header("tk") === "host-reader" ? builtinUses.map(use => use.entrance) : [];
    res.json({ success: true, data: { pageSkills: entrances, admittedEntrances: entrances, registeredSkills: [] } });
  });
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId === "app-builtin-fixture") {
      if (req.header("tk") === "host-no-entry") { res.sendStatus(403); return; }
      expect(req.header("tk")).toBe("host-reader");
      res.json({ success: true, data: {
        applicationId: "app-builtin-fixture", menu: { groups: [], panelUses: [] },
        use: { id: "catalogue", pageKey: "catalogue", path: "/applications/app-builtin-fixture/catalogue",
          panelId: builtinPanelId, access: { kind: "domain-member" } },
      } });
      return;
    }
    if (req.query.applicationId !== "app-mixed") { next(); return; }
    expect(req.header("tk")).toBe("host-reader");
    res.json({ success: true, data: {
      applicationId: "app-mixed", menu: { groups: [], panelUses: [] },
      use: { id: "mixed", pageKey: "mixed", path: "/applications/app-mixed/mixed",
        panelId: codePanelId, access: { kind: "domain-member" } },
    } });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: req.header("X-Test-Domain") ?? "pilot", userId: "reader",
      token: req.header("X-Test-Token") ?? "host-reader", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  app.use("/api", appBuilderRouter);
  app.use("/internal/product-panels", productPanelsInternalRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

it("refuses a platform panel whose entry names an opening sentence one of its languages lacks", async () => {
  const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
  const bundle = path.join(contentRoot, "platform-panel-entry-key");
  const directory = path.join(bundle, "actions");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(bundle, "index.json"), JSON.stringify(["actions"]));
  await writeFile(path.join(directory, "registration.json"), JSON.stringify({
    panels: [{ id: "builtin-product-entry-key-panel", mode: "create", input: { name: "Actions", description: "", visibility: "domain" } }],
  }));
  const member = { id: "builtin-product-entry-key-entry", component: "ConversationEntry", agent: "page-default", prefillKey: "actions.newPrefill" };
  const descriptor = (messages: Record<string, Record<string, string>>) => JSON.stringify({
    manifest: { state: {}, members: { create: member }, commands: {} }, content: { messages },
  });
  const { html, module } = vuePanelContent("create");
  await writeFile(path.join(directory, "panel.html"), html);
  await writeFile(path.join(directory, "panel.mjs"), module);
  await writeFile(path.join(directory, "panel.json"), descriptor({ en: { "actions.newPrefill": "Help me create an action:" }, "zh-CN": {} }));
  await expect(registerBuiltinProducts(bundle)).rejects.toThrow("prefillKey 'actions.newPrefill' is not in content.messages (zh-CN)");
});

it("reconciles the released built-in authoring sources and exposes the same read-only product in each domain", async () => {
  const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
  const bundle = path.join(contentRoot, "platform-panel-test");
  const directory = path.join(bundle, "catalogue");
  await mkdir(directory, { recursive: true });
  const index = path.join(bundle, "index.json");
  const registration = path.join(directory, "registration.json");
  const writeIdentity = (name: string) => writeFile(registration, JSON.stringify({
    panels: [{ id: builtinPanelId, mode: "create", input: { name, description: "", visibility: "domain" } }],
  }));
  const member = { id: builtinProjectionId, component: "PanelData", type: "platform:SDKComponent", data: { rows: "catalogue" } };
  const manifest = { state: {}, members: { components: member }, commands: {} };
  const descriptor = path.join(directory, "panel.json");
  await writeFile(index, JSON.stringify(["catalogue"]));
  await writeIdentity("Components");
  await writeFile(descriptor, JSON.stringify({ manifest }));
  const { html, module } = vuePanelContent("components");
  await writeFile(path.join(directory, "panel.html"), html);
  await writeFile(path.join(directory, "panel.mjs"), module);

  await registerBuiltinProducts(bundle);
  await registerBuiltinProducts(bundle);
  builtinUses = [builtinUse];
  const { readSkillView } = await import("../../services/skills/view");
  const skill = protectedSkillRef("product-panels", null, builtinPanelId);
  const useQuery = new URLSearchParams({
    applicationId: builtinUse.applicationId, useId: builtinUse.useId, ...builtinUse.entrance,
  });
  const packages = [];
  for (const domainId of ["pilot", "another-domain"]) {
    const headers = { "X-Test-Domain": domainId };
    const read = (resource: string) => fetch(`${state.base}/api/${resource}`, { headers });
    const panelResponse = await read("product-panels/" + builtinPanelId);
    expect(panelResponse.status).toBe(200);
    expect(productPanelResponseSchema.parse(await panelResponse.json()).panel).toMatchObject({
      id: builtinPanelId, domainId: null, ownerId: null, editable: false, visibility: "platform", revision: 1,
      manifest: { members: { components: { target: { projectionId: builtinProjectionId } } } },
    });
    const projectionResponse = await read("product-projections/" + builtinProjectionId);
    expect(projectionResponse.status).toBe(200);
    expect(productProjectionResponseSchema.parse(await projectionResponse.json()).projection).toMatchObject({
      id: builtinProjectionId, domainId: null, ownerId: null, editable: false, visibility: "platform",
    });
    const list = await read("product-panels");
    expect(list.status).toBe(200);
    expect((await list.json()).items).toContainEqual(expect.objectContaining({ id: builtinPanelId, editable: false, visibility: "platform" }));
    const response = await fetch(state.base + "/api/product-panels/read", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ source: { kind: "registered", applicationId: "app-builtin-fixture", useId: "catalogue" },
        memberPath: [{ member: "components" }], dataName: "rows", inputs: {} }),
    });
    expect(await response.json()).toMatchObject({ status: "ready", value: expect.arrayContaining([
      expect.objectContaining({ primaryKey: "@ontomato/sdk:ObjectList" }),
    ]) });
    const context = await read(`product-panels/${builtinPanelId}/snapshot?${useQuery}`);
    expect(context.status).toBe(200);
    expect(panelDefinitionSnapshotSchema.parse(await context.json()).pageSkillContext).toMatchObject({
      mode: "member", member: { ref: skill },
    });
    const view = await readSkillView(domainId, { token: "host-reader" });
    const entry = view.requireSkillById(skill.name);
    expect(entry.skill).toEqual(skill);
    expect(entry.source.kind).toBe("provider");
    packages.push(await entry.provide());
  }
  expect(packages[0]).toEqual(packages[1]);
  expect(packages[0]?.files[0]?.content).toContain(builtinProjectionId);
  const { SkillRegistry } = await import("../../../../agent-runtime/src/skills");
  const { RuntimeStore } = await import("../../../../agent-runtime/src/store");
  const runtime = new RuntimeStore(database, state.schema);
  try {
    await runtime.initialize();
    const registry = new SkillRegistry(runtime, path.join(contentRoot, "published-skills"));
    const host = { id: "workbench", token: "fixture-runtime", providers: ["workbench", "ontology"],
      publishProviders: ["workbench"], domainSkills: true };
    const first = await registry.register(host, "pilot", packages[0]);
    const second = await registry.register(host, "another-domain", packages[1]);
    expect(first).toEqual(second);
    expect(first.skill.namespace).toEqual({ kind: "provider", provider: "workbench" });
    await expect(registry.resolve(host, "another-domain", first)).resolves.toMatchObject({ skill, digest: first.digest });
  } finally {
    await runtime.close();
  }
  const noEntry = await readSkillView("pilot", { token: "host-no-entry" });
  expect(noEntry.registry.getSkillByRef(skill)).toBeNull();
  const inaccessible = await fetch(`${state.base}/api/product-panels/${builtinPanelId}/snapshot?${useQuery}`, {
    headers: { "X-Test-Token": "host-no-entry" },
  });
  expect(inaccessible.status).toBe(200);
  expect(panelDefinitionSnapshotSchema.parse(await inaccessible.json()).pageSkillContext).toMatchObject({
    mode: "member", member: null,
  });
  builtinUses = [];
  const blockedSave = await request("PUT", "product-panels/" + builtinPanelId, {
    name: "Shadow", description: "", visibility: "domain", revision: 0, content: { html, module }, manifest,
  });
  expect(blockedSave.status).toBe(400);

  await writeIdentity("Components updated");
  await registerBuiltinProducts(bundle);
  await writeFile(descriptor, JSON.stringify({ manifest: { ...manifest, members: {
    components: { target: { projectionId: "builtin-product-not-in-release" } },
  } } }));
  await expect(registerBuiltinProducts(bundle)).rejects.toThrow("builtin-product-not-in-release");
  const snapshot = await request("GET", "product-panels/" + builtinPanelId + "/snapshot");
  expect(panelDefinitionSnapshotSchema.parse(await snapshot.json()).panel.revision).toBe(2);
  await writeFile(index, "[]");
  await registerBuiltinProducts(bundle);
  expect((await request("GET", "product-panels/" + builtinPanelId)).status).toBe(404);
  expect((await request("GET", "product-projections/" + builtinProjectionId)).status).toBe(404);
}, 20_000);

it("registers the shipped ontology catalogues with addressable creation, previews and application forms", async () => {
  const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
  const bundle = path.join(contentRoot, "ontology-catalogues");
  const catalogues = ["projections", "panels", "applications"];
  const shipped = [...catalogues, "agent-settings"];
  await mkdir(bundle);
  await writeFile(path.join(bundle, "index.json"), JSON.stringify(shipped));
  const sources = new URL("../../../../ontology-manager/resources/builtin-panels/", import.meta.url);
  for (const catalogue of shipped) {
    await symlink(fileURLToPath(new URL(catalogue, sources)), path.join(bundle, catalogue));
  }
  await registerBuiltinProducts(bundle);
  const settingsResponse = await request("GET", "product-panels/builtin-product-agent-settings");
  expect(settingsResponse.status).toBe(200);
  const { panel: settings } = productPanelResponseSchema.parse(await settingsResponse.json());
  expect(settings.manifest.commands.newAgent).toMatchObject({
    primary: true, do: { set: { fields: { selected: { literal: null }, mode: { literal: "create" } } } },
  });
  const formTarget = settings.manifest.members.form!.target;
  expect(formTarget).toHaveProperty("projectionId");
  if (!("projectionId" in formTarget)) throw new Error("Agent settings must publish its form projection");
  const formResponse = await request("GET", `product-projections/${formTarget.projectionId}`);
  expect(productProjectionResponseSchema.parse(await formResponse.json()).projection).toMatchObject({
    visibility: "platform", data: { form: { read: "form" }, createForm: { read: "createForm" } },
    operations: { save: { operation: { id: "platform:AgentDefinition.save" } } },
  });
  for (const [slot, field, ownerType] of [
    ["model", "/modelSelection/modelId", "platform:ModelOption"],
    ["skills", "/skills", "platform:Skill"],
    ["tools", "/enabledMcpServiceIds", "platform:McpServiceOption"],
    ["executor", "/executionUserId", "platform:User"],
  ]) {
    const member = settings.manifest.members[slot];
    expect(member).toMatchObject({ formField: { slot: "form", path: field } });
    if (!member || !("projectionId" in member.target)) throw new Error(`Expected a projection for ${slot}`);
    const response = await request("GET", `product-projections/${member.target.projectionId}`);
    expect(productProjectionResponseSchema.parse(await response.json()).projection).toMatchObject({
      componentId: "@ontomato/sdk:ReferencePicker",
      data: {
        options: { source: { type: { id: ownerType } }, read: "options" },
        selected: { source: { type: { id: ownerType } }, read: "resolve" },
      },
    });
  }
  const scope = settings.manifest.members.scope;
  expect(scope).toMatchObject({ formField: { slot: "form", path: "/classNames" } });
  if (!scope || !("projectionId" in scope.target)) throw new Error("Expected a data-scope projection");
  const scopeResponse = await request("GET", `product-projections/${scope.target.projectionId}`);
  expect(productProjectionResponseSchema.parse(await scopeResponse.json()).projection).toMatchObject({
    componentId: "@ontomato/sdk:ObjectGraph",
    data: {
      nodes: { source: { type: { id: "platform:ObjectType" } }, read: "list" },
      edges: { source: { type: { id: "platform:Relationship" } }, read: "list" },
    },
  });
  const definitions = new Map<string, PanelManifest["members"]>();
  for (const catalogue of catalogues) {
    const response = await request("GET", `product-panels/builtin-product-ontology-${catalogue}`);
    expect(response.status).toBe(200);
    const { panel } = productPanelResponseSchema.parse(await response.json());
    expect(panel).toMatchObject({ visibility: "platform", ownerId: null, editable: false });
    expect(panel.manifest.state.creating).toMatchObject({ type: { kind: "scalar", type: "boolean" }, deepLink: true });
    expect(panel.manifest.commands.create).toEqual({
      labelKey: "action.create", primary: true, do: { set: { fields: {
        selected: { literal: null }, creating: { literal: true },
      } } },
    });
    definitions.set(catalogue, panel.manifest.members);
  }
  for (const catalogue of ["projections", "panels"]) {
    expect(definitions.get(catalogue)?.preview?.target).toEqual({ fromState: "selected", candidates: { rule: "usable" } });
  }
  const application = definitions.get("applications")!;
  const readForm = async (member: string) => {
    const target = application[member]!.target;
    if (!("projectionId" in target)) throw new Error(`Expected a projection in slot '${member}'`);
    const response = await request("GET", `product-projections/${target.projectionId}`);
    expect(response.status).toBe(200);
    return productProjectionResponseSchema.parse(await response.json()).projection.data;
  };
  expect(await readForm("save")).toMatchObject({
    createForm: { read: "createForm" },
    form: { read: "form", params: { section: { literal: "identity" } } },
  });
  expect(await readForm("entriesForm")).toMatchObject({
    form: { read: "form", params: { section: { literal: "entries" } } },
  });
});

it("reads the authoritative operation type table while isolating stale published actions", async () => {
  const response = await request("GET", "app-builder/type-table");
  expect(response.status).toBe(200);
  const raw = await response.text();
  const table = platformTypeTableResponseSchema.parse(JSON.parse(raw));
  const { objectTypes } = table;
  expect(table).toMatchObject({
    unavailableActions: ["missing-function-one", "missing-function-two", "missing-function-three"].map(id => ({
      id, reason: "The stored function definition is missing.",
    })),
  });
  expect(objectTypes["platform:ScheduledTask"].operations).toContainEqual(expect.objectContaining({
    id: "schedules.runNow", target: { source: "input", input: "task" }, batch: false, effect: "write",
  }));
  const usedResults = new Set(Object.values(objectTypes).flatMap(entry => Object.values(entry.reads ?? {}).map(read => read.result)));
  expect(new Set(Object.keys(table.resultSchemas))).toEqual(usedResults);
  expect(table.resultSchemas.panelRecordQuery).toMatchObject({ properties: { rows: { type: "array" } } });
  expect(table.resultSchemas.panelRecord).toMatchObject({ properties: { primaryKey: { type: "string" } } });
  expect(table.resultSchemas.actionDefinition).toMatchObject({ properties: { effects: { type: "array" } } });
  expect(table.resultSchemas.actionExplanation).toMatchObject({ properties: { codeSegments: { type: "array" } } });
  expect(table.resultSchemas.sdkComponentDefinition).toMatchObject({ properties: { componentId: { type: "string" } } });
  expect(table.resultSchemas.panelOntologyObjects).toMatchObject({ properties: { items: { type: "array" } } });
  const customerReads = {
    query: { source: "type", parameterMode: "fixed", params: { search: "keyword", page: "page" }, result: "panelRecordQuery" },
    record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
  };
  expect(objectTypes.CostCenter).toEqual({ reads: customerReads });
  expect(objectTypes.expense.reads).toEqual(customerReads);
  expect(objectTypes.expense.operations).toEqual([expect.objectContaining({
    id: "approve-expense", target: { source: "input", input: "target" }, batch: false, effect: "write",
    inputSchema: expect.objectContaining({
      properties: { values: expect.objectContaining({ properties: {
        amount: { type: "string", title: "amount", contentMediaType: "application/json" },
      } }) },
    }),
  })]);
  expect(raw).not.toContain("author-private");
  const denied = await fetch(state.base + "/api/app-builder/type-table", { headers: { "X-Test-Token": "ordinary-reader" } });
  expect(denied.status).toBe(403);
});

it("keeps the author type table available when Java denies access to the customer type catalogue", async () => {
  state.denyCustomerTypes = true;
  try {
    const response = await request("GET", "app-builder/type-table");
    expect(response.status, await response.clone().text()).toBe(200);
    const table = platformTypeTableResponseSchema.parse(await response.json());
    expect(table).toMatchObject({
      customerTypesUnavailable: { reason: "The author may not read the domain's object types" },
    });
    expect(table.objectTypes["platform:ScheduledTask"].operations).toContainEqual(expect.objectContaining({ id: "schedules.runNow" }));
    expect(table.objectTypes.expense.operations).toContainEqual(expect.objectContaining({ id: "approve-expense" }));
    expect(table.objectTypes.expense.reads).toBeUndefined();
    expect(table.objectTypes.CostCenter).toBeUndefined();
  } finally {
    state.denyCustomerTypes = false;
  }
});

it("identifies malformed registrations and missing author references without bypassing use grants", async () => {
  const summary = trial.projections.find(projection => projection.id === "projection-schedules-summary")!;
  const { data: _data, ...input } = projectionRequest(summary.input, 0) as { data: unknown };
  const invalidProjection = await request("PUT", "product-projections/author-invalid", input);
  expect(invalidProjection.status).toBe(400);
  expect(await invalidProjection.json()).toMatchObject({ error: {
    code: "INVALID_REQUEST", message: "Projection 'author-invalid', field 'data' is required",
  } });

  const panel = {
    name: "Author panel", description: "", visibility: "private", revision: 0,
    content: vuePanelContent("summary"),
    manifest: { state: {}, members: { summary: { target: { projectionId: "author-missing" } } }, commands: {} },
  };
  const extraField = await request("PUT", "product-panels/author-panel", { ...panel, typo: true });
  expect(extraField.status).toBe(400);
  expect(await extraField.json()).toMatchObject({ error: {
    code: "INVALID_REQUEST", message: "Panel 'author-panel', field 'typo' is not allowed",
  } });
  const invalidReference = await request("PUT", "product-panels/author-panel", panel);
  expect(invalidReference.status).toBe(404);
  expect(await invalidReference.json()).toMatchObject({ error: {
    code: "PRODUCT_UNAVAILABLE", message: expect.stringContaining("Projection 'author-missing' does not exist"),
  } });
  expect(grants.has("author-panel")).toBe(false);

  for (const [collection, kind] of [["product-projections", "Projection"], ["product-panels", "Panel"]]) {
    const lookup = await request("GET", collection + "/author-missing");
    expect(lookup.status).toBe(404);
    expect(await lookup.json()).toMatchObject({ error: {
      code: "PRODUCT_UNAVAILABLE", message: `${kind} 'author-missing' does not exist`,
    } });
  }
  const readerLookup = await fetch(state.base + "/api/product-projections/author-missing", {
    headers: { "X-Test-Token": "ordinary-reader" },
  });
  expect(readerLookup.status).toBe(403);

  const saved = await request("PUT", "product-projections/author-protected", projectionRequest(summary.input, 0));
  expect(saved.status).toBe(200);
  grants.delete("author-protected");
  const forbidden = await request("GET", "product-projections/author-protected");
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toMatchObject({ error: { code: "PRODUCT_FORBIDDEN" } });
});

it("checks projection data against the current release before registering or changing a record", async () => {
  const trialSummary = trial.projections.find(projection => projection.id === "projection-schedules-summary")!;
  const summary = projectionRequest(trialSummary.input, 0);
  expect("data" in summary).toBe(true);
  if (!("data" in summary)) throw new Error("Expected an ordinary projection in the trial");
  const rows = { source: { type: { kind: "PlatformObjectType", id: "platform:ScheduledTask" } }, read: "list", params: {} };
  const rejects = async (id: string, body: object, code: string) => {
    const result = await request("PUT", "product-projections/" + id, body);
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code } });
  };

  await rejects("catalogue-wrong-result", { ...summary, data: { record: rows } }, "PANEL_COMPONENT_DATA_RESULT_MISMATCH");
  await rejects("catalogue-unknown-data", { ...summary, data: { ...summary.data, extra: rows } }, "PANEL_COMPONENT_DATA_UNKNOWN");
  await rejects("catalogue-missing-record", { ...summary, data: {} }, "PANEL_COMPONENT_DATA_REQUIRED");
  expect([...grants].some(id => id.startsWith("catalogue-"))).toBe(false);

  const optional = await request("PUT", "product-projections/catalogue-optional-data", {
    ...summary, componentId: "@ontomato/sdk:SegmentedControl", data: {}, inputs: {},
    config: { options: [{ value: "all", label: "All" }] },
  });
  expect(optional.status, await optional.text()).toBe(200);

  const id = "catalogue-existing";
  const saved = await request("PUT", "product-projections/" + id, summary);
  expect(saved.status).toBe(200);
  const before = productProjectionResponseSchema.parse(await saved.json());
  await rejects(id, { ...summary, revision: 1, data: { record: rows } }, "PANEL_COMPONENT_DATA_RESULT_MISMATCH");
  const stored = await request("GET", "product-projections/" + id);
  expect(productProjectionResponseSchema.parse(await stored.json())).toEqual(before);

  const entry = await request("PUT", "product-projections/catalogue-conversation", {
    ...summary, componentId: "@ontomato/sdk:ConversationEntry", data: {}, inputs: {}, config: {},
    conversationEntry: { target: { kind: "page-default" } },
  });
  expect(entry.status, await entry.text()).toBe(200);

  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
  const others = catalogue.components.filter(component => component.componentId !== "ObjectSummary");
  const declaredSummary = catalogue.components.find(component => component.componentId === "ObjectSummary")!;
  try {
    await writeFile(cataloguePath, JSON.stringify({ ...catalogue, components: others }));
    await rejects("catalogue-absent", summary, "PANEL_COMPONENT_UNAVAILABLE");
    const { data: _data, ...codeOnly } = declaredSummary;
    await writeFile(cataloguePath, JSON.stringify({ ...catalogue, components: [...others, codeOnly] }));
    await rejects("catalogue-code-only", summary, "PANEL_COMPONENT_NOT_PROJECTABLE");
    expect(grants.has("catalogue-absent") || grants.has("catalogue-code-only")).toBe(false);

    const component = {
      ...declaredSummary, module: "@fixture/widgets/base", componentId: "FixtureSummary", exportName: "FixtureSummary",
    };
    await writeFile(cataloguePath, JSON.stringify({ ...catalogue, components: [...others, component] }));
    const registered = await request("PUT", "product-projections/catalogue-new-component", {
      ...summary, componentId: "@fixture/widgets:FixtureSummary",
    });
    expect(registered.status).toBe(200);
    expect(productProjectionResponseSchema.parse(await registered.json()).projection.componentId).toBe("@fixture/widgets:FixtureSummary");
  } finally {
    await writeFile(cataloguePath, JSON.stringify(catalogue));
  }
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object, signal?: AbortSignal) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
}

function projectionRequest(input: (typeof trial.projections)[number]["input"], revision: number) {
  return registerProductProjectionRequestSchema.parse({ ...input, revision });
}

it("reads the registered trial and follows its directly placed projections through the host routes", async () => {
  const { id, directory, name, description, manifest } = trial.panels.find(entry => entry.id === "panel-schedules-trial")!;
  for (const projection of trial.projections) {
    const body = projectionRequest(projection.input, 0);
    const response = await request("PUT", `product-projections/${projection.id}`, body);
    expect(response.status, await response.text()).toBe(200);
  }
  const body = registerProductPanelRequestSchema.parse({
    name, description, manifest, visibility: "domain", content: trial.panelContent(directory), revision: 0,
  });
  const saved = await request("PUT", `product-panels/${id}`, body);
  expect(saved.status, await saved.text()).toBe(200);

  const panelResponse = await request("GET", `product-panels/${id}`);
  expect(panelResponse.status).toBe(200);
  const panelPayload = await panelResponse.json();
  const { panel } = productPanelResponseSchema.parse(panelPayload);
  const snapshotResponse = await request("GET", `product-panels/${id}/snapshot`);
  const snapshotPayload = await snapshotResponse.json();
  expect(snapshotResponse.status, JSON.stringify(snapshotPayload)).toBe(200);
  const snapshot = panelDefinitionSnapshotSchema.parse(snapshotPayload);
  expect(snapshot.panel).toEqual({ id, revision: panel.revision });
  expect(snapshot.projections.map(projection => projection.id)).toEqual(
    Object.values(panel.manifest.members).flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []),
  );

  const projectionPayloads: Record<string, unknown> = {};
  const projectionDefinitions: ProductDefinitionRevision[] = [];
  for (const reference of snapshot.projections) {
    const response = await request("GET", `product-projections/${reference.id}`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(productProjectionResponseSchema.parse(payload).projection).toMatchObject({
      ...reference, data: expect.any(Object),
    });
    projectionPayloads[reference.id] = payload;
    projectionDefinitions.push({ kind: "projection" as const, ...reference });
  }
  const expected = [{ kind: "panel" as const, ...snapshot.panel }, ...projectionDefinitions];
  const { targets } = productDefinitionStreamRequestSchema.parse({ targets: expected.map(({ kind, id }) => ({ kind, id })) });
  const controller = new AbortController();
  const frames: string[] = [];
  try {
    const stream = await request("POST", "product-panels/definition-stream", { targets }, controller.signal);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await readSseFrames(stream, productDefinitionStreamFrameSchema.parse, async frame => {
      frames.push(frame.kind);
      if (frame.kind === "snapshot") {
        expect(frame.definitions).toEqual(expected);
        const projectionId = projectionDefinitions[0]!.id;
        const projection = trial.projections.find(item => item.id === projectionId)!;
        const update = await request("PUT", `product-projections/${projectionId}`, {
          ...projectionRequest(projection.input, projectionDefinitions[0]!.revision), name: "Updated summary",
        });
        expect(update.status, await update.text()).toBe(200);
      } else {
        expect(frame.definition).toEqual({ ...projectionDefinitions[0], revision: projectionDefinitions[0]!.revision + 1 });
        controller.abort();
      }
    }, controller.signal);
  } finally {
    controller.abort();
  }
  expect(frames).toEqual(["snapshot", "definition-changed"]);

  const deniedProjection = "projection-schedules-summary";
  grants.delete(deniedProjection);
  const partial = await request("GET", `product-panels/${id}/snapshot`);
  expect(partial.status).toBe(200);
  const partialSnapshot = panelDefinitionSnapshotSchema.parse(await partial.json());
  expect(partialSnapshot.members).toContainEqual({ status: "forbidden", memberPath: [{ member: "summary" }] });
  expect(partialSnapshot.projections.map(projection => projection.id)).not.toContain(deniedProjection);
  expect(partialSnapshot.members).toContainEqual(expect.objectContaining({
    status: "ready", memberPath: [{ member: "run" }], target: { kind: "projection", id: "projection-schedules-run" },
  }));

  const evidencePath = process.env.DIRECT_PANEL_HOST_HTTP_EVIDENCE;
  if (evidencePath) {
    await writeFile(evidencePath, JSON.stringify({ panel: panelPayload, snapshot: snapshotPayload, projections: projectionPayloads }, null, 2) + "\n");
  }
});

it("preserves a code panel's ID and revision rules and describes its member operation", async () => {
  const summaryId = "mixed-summary", runId = "mixed-run";
  for (const [id, source] of [[summaryId, "projection-schedules-summary"], [runId, "projection-schedules-run"]] as const) {
    const { input } = trial.projections.find(projection => projection.id === source)!;
    const response = await request("PUT", "product-projections/" + id, projectionRequest(input, 0));
    expect(response.status, await response.text()).toBe(200);
  }
  const trialPanel = trial.panels.find(panel => panel.id === "panel-schedules-summary")!;
  const content = trial.panelContent(trialPanel.directory);
  const directTrial = trial.panels.find(panel => panel.id === "panel-schedules-trial")!;
  const { state: panelState, members } = panelManifestSchema.parse(directTrial.manifest);
  const replacement = {
    name: trialPanel.name, description: trialPanel.description, visibility: "domain", content,
    manifest: { state: panelState, commands: {}, members: {
      summary: { ...members.summary, target: { projectionId: summaryId } },
      run: { ...members.run, target: { projectionId: runId } },
    } },
  };
  const panelPath = "product-panels/" + codePanelId;
  const initial = await request("PUT", panelPath, { ...replacement, revision: 0 });
  expect(initial.status, await initial.text()).toBe(200);
  const legacy = await request("PUT", panelPath, {
    ...replacement, revision: 1, sdkVersion: "1.0.0-fixture", manifest: trialPanel.manifest,
  });
  expect(legacy.status).toBe(400);
  const stale = await request("PUT", panelPath, { ...replacement, revision: 2 });
  expect(stale.status, await stale.text()).toBe(409);
  const stored = await state.pool!.query(
    `SELECT revision,definition FROM "${state.schema}".product_panels WHERE domain_id=$1 AND id=$2`,
    ["pilot", codePanelId],
  );
  expect(stored.rows).toEqual([{ definition: replacement, revision: 1 }]);

  const saved = await request("PUT", panelPath, { ...replacement, revision: 1 });
  expect(saved.status, await saved.text()).toBe(200);
  const readback = await request("GET", panelPath);
  expect(readback.status).toBe(200);
  const { panel } = productPanelResponseSchema.parse(await readback.json());
  expect(panel).toMatchObject({ id: codePanelId, ownerId: "reader", revision: 2, ...replacement });
  expect(panel).not.toHaveProperty("sdkVersion");
  const snapshot = await request("GET", panelPath + "/snapshot");
  expect(snapshot.status).toBe(200);
  const current = panelDefinitionSnapshotSchema.parse(await snapshot.json());
  expect(current.panel).toEqual({ id: codePanelId, revision: 2 });
  expect([...current.projections].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
    { id: runId, revision: 1 }, { id: summaryId, revision: 1 },
  ]);

  const describe = (operationId: string) => request("GET", "panel-operations/descriptor?" +
    new URLSearchParams({ applicationId: "app-mixed", useId: "mixed", operationId }));
  const response = await describe("run.runNow");
  const payload = await response.json();
  expect(response.status, JSON.stringify(payload)).toBe(200);
  const descriptor = panelOperationDescriptorResponseSchema.parse(payload);
  expect(descriptor).toMatchObject({
    handlerRef: "schedules.runNow", effect: "write", target: { source: "input", input: "task" },
  });
  const authorResponse = await request("GET", "app-builder/type-table");
  const table = platformTypeTableResponseSchema.parse(await authorResponse.json());
  const { id: _id, ...declaration } = table.objectTypes["platform:ScheduledTask"].operations!.find(op => op.id === "schedules.runNow")!;
  expect(descriptor).toMatchObject(declaration);
  expect((await describe("summary.runNow")).status).toBe(422);

  const application = {
    domainId: "pilot",
    uses: [{ id: "mixed", panelId: codePanelId, inputs: { selectedTask: { literal: null } } }],
    delivery: { panels: [codePanelId], projections: [summaryId, runId] },
  };
  const validate = (body: object, token = "fixture-service") => fetch(state.base + APPLICATION_PANEL_REFERENCES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": token },
    body: JSON.stringify(body),
  });
  expect((await validate(application, "reader")).status).toBe(403);
  const allowed = await validate(application);
  expect(allowed.status, await allowed.text()).toBe(204);
  expect((await validate({ ...application, delivery: { panels: [], projections: [] } })).status).toBe(204);
  const framePanelId = "panel-app-frame";
  const frameSaved = await request("PUT", "product-panels/" + framePanelId, {
    name: "Application frame", description: "", visibility: "domain", revision: 0, content: vuePanelContent(),
    manifest: { state: { choice: panelState.selectedTask }, members: {}, commands: {} },
  });
  expect(frameSaved.status, await frameSaved.text()).toBe(200);
  const framed = { ...application, framePanelId, uses: [{
    ...application.uses[0], inputs: { selectedTask: { frameState: "choice" } },
  }] };
  expect((await validate(framed)).status).toBe(204);
  expect((await validate({ ...framed, framePanelId: undefined })).status).toBe(400);
  const invalidInput = await validate({ ...application, uses: [{
    ...application.uses[0], inputs: { selectedTask: { literal: "not an object" } },
  }] });
  expect(invalidInput.status).toBe(400);
  expect((await invalidInput.json()).error.message).toContain("selectedTask");
  const unreachable = await validate({ ...application, delivery: { panels: [], projections: ["unreachable"] } });
  expect(unreachable.status).toBe(400);
  expect((await unreachable.json()).error.message).toContain("unreachable");
});

it("rejects an unavailable default agent before accepting a proposed application use", async () => {
  const panelId = "default-agent-panel";
  const saved = await request("PUT", "product-panels/" + panelId, {
    name: "Panel with a default", description: "", visibility: "domain", revision: 0,
    content: vuePanelContent(), manifest: { state: {}, members: {}, commands: {} },
  });
  expect(saved.status, await saved.text()).toBe(200);

  const ref = protectedSkillRef("product-panels", "pilot", panelId);
  const anotherDomain = { ...ref, namespace: { kind: "domain", domainId: "elsewhere" } };
  const governanceId = randomUUID();
  const assistant = (id: string, kind: string, skills: unknown[]) => state.pool!.query(
    `INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind, name, system_prompt, skills)
     VALUES ($1, 'pilot', $2, $2, '', $3::jsonb)`,
    [id, kind, JSON.stringify(skills)],
  );
  await assistant(governanceId, "knowledge-governance", [anotherDomain]);
  await assistant(randomUUID(), "regular", []);

  const proposed = (defaultAgent?: { kind: "preset"; agentKind: string } | { kind: "id"; id: string }) =>
    fetch(state.base + APPLICATION_PANEL_REFERENCES_PATH, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "fixture-service" },
      body: JSON.stringify({
        domainId: "pilot", uses: [{ id: "manage", panelId, defaultAgent }], delivery: { panels: [], projections: [] },
      }),
    });
  const governance = { kind: "preset", agentKind: "knowledge-governance" } as const;
  const missingSkill = await proposed(governance);
  expect(missingSkill.status).toBe(409);
  expect(await missingSkill.json()).toMatchObject({ error: {
    code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    message: "Entry 'manage' default agent preset 'knowledge-governance' does not select the skill for panel 'default-agent-panel'.",
  } });

  await state.pool!.query(`UPDATE "${state.schema}".assistant_agents SET skills=$2::jsonb WHERE id=$1`,
    [governanceId, JSON.stringify([ref])]);
  expect((await proposed(governance)).status).toBe(204);
  expect((await proposed({ kind: "preset", agentKind: "regular" })).status).toBe(204);
  expect((await proposed()).status).toBe(204);

  await state.pool!.query(`UPDATE "${state.schema}".assistant_agents SET enabled=false WHERE id=$1`, [governanceId]);
  const disabled = await proposed({ kind: "id", id: governanceId });
  expect(disabled.status).toBe(409);
  expect(await disabled.json()).toMatchObject({ error: {
    code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    message: `Entry 'manage' default agent '${governanceId}' is disabled.`,
  } });
});
