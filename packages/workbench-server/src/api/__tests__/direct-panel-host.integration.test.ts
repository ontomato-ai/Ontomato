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
import { domainApplicationIconKeys } from "@ontomato/contracts/application-icons";
import { DOMAIN_COMPONENTS_PATH, domainComponentResponseSchema } from "@ontomato/contracts/domain-components";
import { PANEL_MEMBER_RENDER_HEADER } from "@ontomato/contracts/panel-host";
import { COMPONENT_PACKAGES_PATH } from "@ontomato/contracts/component-packages";
import { cataloguePath as installedPackagePath, componentId, release, upload } from "../../__tests__/fixtures/component-packages";
import { createComponentPackagesRouter } from "../routes/component-packages";
import { platformService } from "../middleware/platform-service";
import { errorHandler } from "../middleware";
import { checkComponentPackageUpgrade } from "../../services/component-packages/upgrade";
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
import scheduleExamples from "../../../../contracts/examples/platform-schedules.json";
import { protectedSkillRef } from "../../core/skills/providers";
import { installContentLayout } from "../../content/layout";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { readSseFrames } from "../../infrastructure/agent-runtime/client";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureDomainComponentsSchema } from "../../infrastructure/postgres-migrations/20261122-domain-components/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensurePanelOperationsSchema } from "../../infrastructure/postgres-migrations/20261118-panel-operations/schema";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "", denyCustomerTypes: false, operationFrameId: "" }));
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
const scheduledRun = scheduleExamples.runs.find(example => example.name === "agents-running")!.response;
const frameDispatches: string[] = [];
const codePanelId = "panel-schedules-mixed";
const frameHostPanelId = "panel-host-frame";
const frameHostContentId = "panel-host-frame-content";
const frameOperationContentId = "panel-frame-operation-content";
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
    packs: {
      en: { ...enLocaleMeta, messages: en },
      "zh-CN": { ...enLocaleMeta, messages: {
        "panels.productCatalog.defaultAgent.missing": "这个默认智能体在本域不存在。",
        "panels.productCatalog.defaultAgent.disabled": "这个默认智能体已停用。",
      } },
    },
  });
  state.schema = `direct_panel_host_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensureDomainComponentsSchema(state.pool);
  await ensurePanelOperationsSchema(state.pool);
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
  app.post("/product-governance/unregister", (req, res) => {
    grants.delete(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    const token = req.header("tk");
    const allowed = isBuiltinProductId(req.body.id)
      ? (token === "host-reader" || token === "host-no-entry") && req.body.verb === "use"
      : (token === "host-reader" && grants.has(req.body.id)) ||
        (token === "domain-component-reader" && req.body.id === "domain-component-projection" && req.body.verb === "use");
    res.json({ allowed });
  });
  app.post("/product-governance/resources", (req, res) => {
    if (req.header("tk") === "domain-component-reader") {
      res.json({ ids: req.body.verb === "use" ? ["domain-component-projection"] : [] });
      return;
    }
    if (req.header("tk") === undefined) expect(req.body).toEqual({ verb: "use" });
    else expect(req.header("tk")).toBe("host-reader");
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
    if (req.query.applicationId === "app-frame-host") {
      expect(req.header("tk")).toBe("host-reader");
      const useId = String(req.query.useId);
      if (useId === "hidden") { res.sendStatus(403); return; }
      res.json({ success: true, data: {
        applicationId: "app-frame-host", menu: { groups: [], panelUses: [] },
        use: { id: useId, pageKey: useId, path: `/applications/app-frame-host/${useId}`,
          panelId: useId === "operable" ? frameOperationContentId : frameHostContentId, access: { kind: "domain-member" } },
        ...(useId === "framed" && { framePanelId: frameHostPanelId }),
        ...(useId === "operable" && { framePanelId: state.operationFrameId }),
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
  app.post("/platform/scheduled-tasks/:taskId/runs", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    expect(req.params.taskId).toBe(scheduledRun.taskId);
    frameDispatches.push(req.header("Idempotency-Key")!);
    res.json(scheduledRun);
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: req.header("X-Test-Domain") ?? "pilot", userId: req.header("X-Test-User") ?? "reader",
      token: req.header("X-Test-Token") ?? "host-reader", locale: "en" });
    next();
  });
  app.use(COMPONENT_PACKAGES_PATH, createComponentPackagesRouter(platformService, checkComponentPackageUpgrade));
  app.use(DOMAIN_COMPONENTS_PATH, (await import("../routes/domain-components")).domainComponentsRouter);
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  app.use("/api", appBuilderRouter);
  app.use(errorHandler);
  app.use("/internal/product-panels", productPanelsInternalRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

it("reports the allowed icons when the domain application registration preflight rejects a choice", async () => {
  const request = { domainId: "pilot", uses: [], delivery: { panels: [], projections: [] } };
  const validate = (body: object) => fetch(state.base + APPLICATION_PANEL_REFERENCES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "fixture-service" },
    body: JSON.stringify(body),
  });
  for (const icon of ["settings", "not-an-icon"]) {
    const response = await validate({ ...request, icon });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.message).toContain("field 'icon'");
    expect(error.message).toContain(`Icon '${icon}'`);
    expect(error.message).toContain(`Choose one of ${domainApplicationIconKeys.join(", ")}`);
  }
  expect((await validate({ ...request, icon: domainApplicationIconKeys[0] })).status).toBe(204);
  expect((await validate(request)).status).toBe(204);
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
    expect(panel.manifest.commands.create).toMatchObject({
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

it("uses the authorized frame root for its record, snapshot, member reads, nested content and personal state", async () => {
  const projectionId = "frame-host-components";
  const brokenId = "frame-host-invalid-sibling";
  const projection = {
    name: "Frame components", description: "", visibility: "domain", revision: 0,
    componentId: "@ontomato/sdk:PanelData", config: {}, inputs: {}, outputs: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: "platform:SDKComponent" } }, read: "catalogue", params: {} } },
  };
  for (const id of [projectionId, brokenId]) {
    const saved = await request("PUT", `product-projections/${id}`, projection);
    expect(saved.status, await saved.text()).toBe(200);
  }
  const panel = { name: "Application frame", description: "", visibility: "domain", revision: 0, content: vuePanelContent() };
  const content = await request("PUT", `product-panels/${frameHostContentId}`, {
    ...panel, manifest: { state: {}, members: {}, commands: {} },
  });
  expect(content.status, await content.text()).toBe(200);
  const theme = { light: { "--sdk-color-primary": "#123456" } };
  const frame = await request("PUT", `product-panels/${frameHostPanelId}`, {
    ...panel, theme, manifest: {
      state: { term: { type: { kind: "scalar", type: "string" }, personal: true } }, commands: {},
      members: {
        content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } },
        components: { target: { projectionId } },
        invalid: { target: { projectionId: brokenId } },
      },
    },
  });
  expect(frame.status, await frame.text()).toBe(200);
  const source = { kind: "frame", applicationId: "app-frame-host", useId: "framed" };
  const getFrame = (id = frameHostPanelId, useId = source.useId, suffix = "") => request("GET", `product-panels/${id}${suffix}?` +
    new URLSearchParams({ applicationId: source.applicationId, useId, source: "frame" }));
  const getSnapshot = (id = frameHostPanelId, useId = source.useId) => getFrame(id, useId, "/snapshot");
  const get = await getFrame();
  expect(get.status, await get.clone().text()).toBe(200);
  expect(get.headers.get("cache-control")).toBe("no-store");
  expect(await get.json()).toEqual({ panel: expect.objectContaining({
    id: frameHostPanelId, theme, manifest: expect.objectContaining({ members: expect.any(Object) }),
  }) });
  expect((await getFrame(frameHostContentId)).status).toBe(404);
  expect((await getFrame(frameHostPanelId, "native")).status).toBe(404);
  expect((await getFrame(frameHostPanelId, "hidden")).status).toBe(403);

  const snapshot = await getSnapshot();
  expect(snapshot.status, await snapshot.clone().text()).toBe(200);
  expect(snapshot.headers.get("cache-control")).toBe("no-store");
  const payload = panelDefinitionSnapshotSchema.parse(await snapshot.json());
  expect(payload.panel).toEqual({ id: frameHostPanelId, revision: 1 });
  expect(payload.members).toHaveLength(2);
  expect(payload.members).toContainEqual({
    status: "ready", memberPath: [{ member: "components" }], target: { kind: "projection", id: projectionId }, revision: 1,
  });
  expect(payload.projections).toEqual(expect.arrayContaining([{ id: projectionId, revision: 1 }, { id: brokenId, revision: 1 }]));
  expect(payload.pageSkillContext).toBeUndefined();
  expect((await getSnapshot(frameHostContentId)).status).toBe(404);
  expect((await getSnapshot(frameHostPanelId, "native")).status).toBe(404);
  expect((await getSnapshot(frameHostPanelId, "hidden")).status).toBe(403);

  await state.pool!.query(
    `UPDATE "${state.schema}".product_projections SET definition = definition || '{"obsolete":true}' WHERE id=$1`, [brokenId],
  );
  const read = (member: string) => request("POST", "product-panels/read", {
    source, memberPath: [{ member }], dataName: "rows", inputs: {},
  });
  expect(await (await read("invalid")).json()).toMatchObject({
    status: "error", message: expect.stringContaining(`Projection '${brokenId}': Unrecognized field 'obsolete'`),
  });
  expect(await (await read("components")).json()).toMatchObject({ status: "ready" });
  const nested = await request("POST", "product-panels/nested", { source, memberPath: [{ member: "content" }] });
  expect(nested.status, await nested.clone().text()).toBe(200);
  expect(await nested.json()).toMatchObject({ panel: { id: frameHostContentId } });

  const personal = { source, memberPath: [] };
  expect((await request("PUT", "product-panels/personal-state", { ...personal, values: { term: "spring" } })).status).toBe(200);
  const preference = await request("POST", "product-panels/personal-state/read", { ...personal, fields: ["term"] });
  expect(await preference.json()).toEqual({ values: { term: "spring" } });

  grants.delete(frameHostPanelId);
  expect((await getFrame()).status).toBe(403);
  expect((await getSnapshot()).status).toBe(403);
  expect(await (await read("components")).json()).toEqual({ status: "forbidden" });
});

it("freezes the frame of a human operation and rechecks it before dispatch", async () => {
  const projectionId = "frame-host-run";
  const oldFrame = "panel-operable-frame";
  const replacement = "panel-operable-replacement";
  const run = trial.projections.find(entry => entry.id === "projection-schedules-run")!;
  const projection = await request("PUT", `product-projections/${projectionId}`, projectionRequest(run.input, 0));
  expect(projection.status, await projection.text()).toBe(200);
  for (const id of [frameOperationContentId, oldFrame, replacement]) {
    const frame = id !== frameOperationContentId;
    const saved = await request("PUT", `product-panels/${id}`, {
      name: "Operation host", description: "", visibility: "domain", revision: 0, content: vuePanelContent(),
      manifest: {
        state: frame ? { task: { type: { kind: "object", objectType: "platform:ScheduledTask" } } } : {}, commands: {},
        members: frame ? { run: { target: { projectionId }, inputs: { task: { state: "task" } } } } : {},
      },
    });
    expect(saved.status, await saved.text()).toBe(200);
  }
  state.operationFrameId = oldFrame;

  const scope = { applicationId: "app-frame-host", useId: "operable", operationId: "run.runNow" };
  const descriptor = (query: Record<string, string>) => request("GET", "panel-operations/descriptor?" + new URLSearchParams(query));
  expect((await descriptor(scope)).status).toBe(403);
  const described = await descriptor({ ...scope, root: "frame" });
  expect(described.status, await described.clone().text()).toBe(200);
  expect(await described.json()).toMatchObject({ handlerRef: "schedules.runNow" });

  const call = { target: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: scheduledRun.taskId }, input: {} };
  const invoke = { ...scope, root: "frame", call };
  const read = await request("POST", "panel-operations/read", invoke);
  expect(await read.json()).toMatchObject({ error: { code: "OPERATION_READ_REQUIRED" } });
  const impact = await request("POST", "panel-operations/inspect-impact", invoke);
  expect(await impact.json()).toMatchObject({ error: { code: "OPERATION_IMPACT_UNAVAILABLE" } });
  async function prepare() {
    const response = await request("POST", "panel-operations/intents", invoke);
    expect(response.status, await response.clone().text()).toBe(200);
    const { intentId } = await response.json() as { intentId: string };
    return intentId;
  }
  const intentId = await prepare();
  const stored = await state.pool!.query(`SELECT intent FROM "${state.schema}".panel_operation_intents WHERE id=$1`, [intentId]);
  expect(stored.rows).toMatchObject([{ intent: { panelId: oldFrame, root: "frame", use: {
    applicationId: scope.applicationId, useId: scope.useId,
  } } }]);
  const dispatch = (id: string) => request("POST", `panel-operations/intents/${id}/dispatch`, {});
  state.operationFrameId = replacement;
  const changed = await dispatch(intentId);
  expect(changed.status, await changed.clone().text()).toBe(409);
  expect(await changed.json()).toMatchObject({ error: { code: "INTENT_CHANGED" } });
  expect(frameDispatches).toEqual([]);

  const newIntent = await prepare();
  grants.delete(replacement);
  expect((await dispatch(newIntent)).status).toBe(403);
  expect(frameDispatches).toEqual([]);
  grants.add(replacement);
  const completed = await dispatch(newIntent);
  expect(completed.status, await completed.clone().text()).toBe(200);
  expect(await completed.json()).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
  expect(frameDispatches).toEqual([newIntent]);
});

it("reports cross-domain references to admitted package maintainers and keeps the installed digest", async () => {
  const value = { kind: "scalar", type: "string" };
  const packageFiles = (version: string, inputs: Record<string, object>) => {
    const files = release(version);
    const [example] = JSON.parse(files["components.json"]);
    return { ...files, "components.json": JSON.stringify([{ ...example, inputs }]) };
  };
  const packageRequest = (mode: "inspect" | "install", files: Record<string, string>) =>
    fetch(state.base + COMPONENT_PACKAGES_PATH + "/install", {
      method: "POST", headers: { "X-Ontomato-Query-Service-Token": "fixture-service", "X-Test-Token": "" },
      body: upload(files, mode, "directory"),
    });
  const initial = await packageRequest("install", packageFiles("1.0.0", { value, unused: value }));
  expect(initial.status, await initial.clone().text()).toBe(200);
  const installed = await initial.json();
  const projectionId = "package-projection-used";
  const panelId = "package-panel-using-projection";
  const projection = await request("PUT", `product-projections/${projectionId}`, {
    name: "Packaged projection", description: "", visibility: "domain", revision: 0,
    componentId, config: {}, data: {}, inputs: { value }, outputs: {},
  });
  expect(projection.status, await projection.text()).toBe(200);
  const panel = await request("PUT", `product-panels/${panelId}`, {
    name: "Packaged panel", description: "", visibility: "domain", revision: 0, content: vuePanelContent(),
    manifest: { state: {}, commands: {}, members: {
      example: { target: { projectionId }, inputs: { value: { literal: "Hello" } } },
    } },
  });
  expect(panel.status, await panel.text()).toBe(200);

  // The deployment check sees both domains, and a damaged row does not hide reference details for other records.
  await state.pool!.query(`INSERT INTO "${state.schema}".product_projections (domain_id,id,owner_id,definition,revision)
    SELECT 'another-domain','secret-package-projection',owner_id,definition,revision
    FROM "${state.schema}".product_projections WHERE domain_id='pilot' AND id=$1
    UNION ALL SELECT 'another-domain','broken-package-projection','reader',$2::jsonb,1`,
  [projectionId, JSON.stringify({ componentId, inputs: false })]);
  await state.pool!.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition,revision)
    SELECT 'another-domain','other-package-panel',owner_id,
      jsonb_set(definition,'{manifest,members,example,target,projectionId}',to_jsonb('secret-package-projection'::text)),revision
    FROM "${state.schema}".product_panels WHERE domain_id='pilot' AND id=$1
    UNION ALL SELECT 'another-domain','broken-package-panel','reader','{"manifest":{"members":{"bad":false}}}'::jsonb,1`, [panelId]);

  for (const mode of ["inspect", "install"] as const) {
    const refused = await packageRequest(mode, packageFiles("2.0.0", { unused: value }));
    expect(refused.status, await refused.clone().text()).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "COMPONENT_PACKAGE_INCOMPATIBLE",
      error: expect.stringContaining("This deployment-level check lists all affected projections and panels"),
      details: { scope: "deployment", changes: [{ component: componentId, field: "inputs.value", before: value,
        projectionIds: [projectionId, "secret-package-projection"], panelIds: ["other-package-panel", panelId],
        projections: [{ id: "secret-package-projection", domainId: "another-domain" }, { id: projectionId, domainId: "pilot" }],
        panels: [{ id: "other-package-panel", domainId: "another-domain" }, { id: panelId, domainId: "pilot" }] }] },
    });
  }
  const current = async () => (await fetch(state.base + installedPackagePath)).json();
  expect(await current()).toEqual(installed);
  const compatible = packageFiles("2.0.0", { value });
  const preview = await packageRequest("inspect", compatible);
  expect(preview.status, await preview.clone().text()).toBe(200);
  expect(await current()).toEqual(installed);
  const upgraded = await packageRequest("install", compatible);
  expect(upgraded.status, await upgraded.clone().text()).toBe(200);
  expect(await current()).toEqual(await upgraded.json());
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

  const proposed = (
    defaultAgent?: { kind: "preset"; agentKind: string } | { kind: "id"; id: string }, useId = "manage", locale?: string,
  ) =>
    fetch(state.base + APPLICATION_PANEL_REFERENCES_PATH, {
      method: "POST", headers: {
        "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "fixture-service",
        ...(locale && { "Accept-Language": locale }),
      },
      body: JSON.stringify({
        domainId: "pilot", uses: [{ id: useId, panelId, defaultAgent }], delivery: { panels: [], projections: [] },
      }),
    });
  const governance = { kind: "preset", agentKind: "knowledge-governance" } as const;
  const missingSkill = await proposed(governance);
  expect(missingSkill.status).toBe(409);
  const missingSkillBody = await missingSkill.json();
  expect(missingSkillBody.error).toEqual({
    code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    message: "This default agent has not selected this panel's skill.",
  });
  expect(missingSkillBody.details).toEqual({ useId: "manage" });

  await state.pool!.query(`UPDATE "${state.schema}".assistant_agents SET skills=$2::jsonb WHERE id=$1`,
    [governanceId, JSON.stringify([ref])]);
  expect((await proposed(governance)).status).toBe(204);
  expect((await proposed({ kind: "preset", agentKind: "regular" })).status).toBe(204);
  expect((await proposed()).status).toBe(204);

  await state.pool!.query(`UPDATE "${state.schema}".assistant_agents SET enabled=false WHERE id=$1`, [governanceId]);
  const disabled = await proposed({ kind: "id", id: governanceId }, "review-entry", "zh-CN, en;q=0.8");
  expect(disabled.status).toBe(409);
  const disabledBody = await disabled.json();
  expect(disabledBody.error).toEqual({
    code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    message: "这个默认智能体已停用。",
  });
  expect(disabledBody.details).toEqual({ useId: "review-entry" });

  const missing = await proposed({ kind: "preset", agentKind: "missing-preset" }, "new-entry", "zh-CN");
  expect(missing.status).toBe(409);
  const missingBody = await missing.json();
  expect(missingBody.error).toEqual({
    code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    message: "这个默认智能体在本域不存在。",
  });
  expect(missingBody.details).toEqual({ useId: "new-entry" });
});

it("stores domain components as source and protects every projection using their declarations", async () => {
  const collection = state.base + DOMAIN_COMPONENTS_PATH;
  const call = (url: string, method: string, body?: object, headers: Record<string, string> = {}) =>
    fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });
  const definition = {
    name: "Domain component",
    visibility: "private",
    declaration: {
      role: "presentation", meaning: "Shows a configuration value", data: {},
      config: [{ name: "caption", type: "string", description: "Caption", required: false }],
      ports: { props: [], events: [], slots: [] },
    },
    source: { template: "<span>{{ caption }}</span>", module: "export default { props: ['caption'] }" },
  };
  const created = await call(collection, "POST", definition);
  expect(created.status).toBe(201);
  const { component } = domainComponentResponseSchema.parse(await created.json());
  const { componentId } = component.declaration;
  expect(componentId).toMatch(/^domain-component:[0-9a-f-]+$/u);
  expect(component.revision).toBe(1);
  const url = collection + "/" + encodeURIComponent(componentId);
  const projectionUrl = state.base + "/api/product-projections/domain-component-projection";
  const projection = {
    name: "Domain component projection", description: "", visibility: "domain", revision: 0,
    componentId, inputs: {}, outputs: {}, data: {}, config: { caption: "Example" },
  };
  const badDomain = { "X-Test-Domain": "other-domain" };
  expect((await call(url, "GET", undefined, badDomain)).status).toBe(404);
  expect((await (await call(collection, "GET", undefined, badDomain)).json()).components).toEqual([]);
  expect((await call(projectionUrl, "PUT", projection, badDomain)).status).toBe(400);
  expect((await call(projectionUrl, "PUT", projection, { "X-Test-User": "another-author" })).status).toBe(400);
  expect((await call(projectionUrl, "PUT", projection)).status).toBe(200);

  const render = () => call(projectionUrl, "GET", undefined, {
    [PANEL_MEMBER_RENDER_HEADER]: "1", "X-Test-Token": "domain-component-reader",
  });
  expect(await (await render()).json()).toMatchObject({ domainComponent: { domainId: "pilot", componentId, revision: 1 } });
  const updated = { ...definition, declaration: component.declaration, revision: 1, source: { ...definition.source, template: "<em>{{ caption }}</em>" } };
  expect((await call(url, "PUT", updated)).status).toBe(200);
  expect(await (await render()).json()).toMatchObject({ domainComponent: { revision: 2, source: updated.source } });
  expect((await call(url, "PUT", updated)).status).toBe(409);
  expect(await (await call(url + "/used-by", "GET")).json()).toMatchObject({
    projections: [{ id: "domain-component-projection" }], hiddenProjectionCount: 0,
  });

  const incompatible = await call(url, "PUT", { ...updated, revision: 2, declaration: { ...updated.declaration, config: [] } });
  expect(incompatible.status).toBe(409);
  expect(await incompatible.json()).toMatchObject({ error: { code: "COMPONENT_INCOMPATIBLE" }, details: { fields: ["config.caption"] } });
  const deletion = await call(url + "?revision=2", "DELETE");
  expect(deletion.status).toBe(409);
  expect(await deletion.json()).toMatchObject({ error: { code: "COMPONENT_IN_USE" } });
  expect((await call(projectionUrl + "?revision=1", "DELETE")).status).toBe(200);
  expect((await call(url + "?revision=2", "DELETE")).status).toBe(204);
});
