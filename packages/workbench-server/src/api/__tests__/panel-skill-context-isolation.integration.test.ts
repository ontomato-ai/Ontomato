import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { panelOptionListSchema, panelRecordQuerySchema } from "@ontomato/contracts/panel-projection";
import { PANEL_MEMBER_RENDER_HEADER, productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { appsSdkComponentCatalogSchema } from "@ontomato/contracts/apps-sdk";
import { SDK_COMPONENT, SKILL } from "@ontomato/contracts/platform-object-types";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { protectedSkillRef } from "../../core/skills/providers";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { panelSkillRef } from "../../services/product-panels/skill-identity";
import { installContentLayout } from "../../content/layout";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureAgentExecutionSchema } from "../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined, schema: "", base: "", runForOwner: vi.fn(), credentialsForRun: vi.fn(),
}));
vi.mock("../../services/assistant/execution", async original => ({
  ...await original<typeof import("../../services/assistant/execution")>(),
  runForOwner: state.runForOwner, credentialsForRun: state.credentialsForRun,
}));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: {
  agentRuntime: () => ({ queryServiceToken: "fixture-service", token: "fixture-callback-secret" }), publicBasePath: () => "",
  queryBase: () => state.base, queryTimeout: () => 30000,
} }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));
vi.mock("../../identity/installed", async original => ({
  ...await original<typeof import("../../identity/installed")>(),
  assertPermission: async () => undefined,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const domainId = "isolation-domain";
const applicationId = "app-panel-isolation";
function page(name: string) {
  return { applicationId, useId: `use-${name}`, panelId: `panel-${name}`, path: `/panels/${name}`,
    entrance: { permissionCode: "panel-menu", pageKey: name } };
}
const good = page("good"), broken = page("broken"), library = page("library"), changing = page("changing");
const componentsPage = {
  applicationId: "ontology", useId: "ontology-components", panelId: "builtin-product-sdk-components", path: "/ontology/components",
  entrance: { permissionCode: "ontology-modeling", pageKey: "ontology-components" },
};
const brokenProjection = "projection-broken";
const privateOperation = "private-stored-operation-body";
const skillRef = (entry: typeof good) => protectedSkillRef("product-panels", domainId, entry.panelId);
const registered = new Set<string>();
let entries = [good, broken];
let listSources = async () => entries;
let denied: string | undefined;
let executorDenied: string | undefined;
let deniedEntrance: string | undefined;
let root: string;
let cataloguePath: string;
let server: Server;

async function register(collection: string, id: string, definition: object) {
  const response = await fetch(`${state.base}/api/${collection}/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...definition, revision: 0 }),
  });
  expect(response.status, await response.text()).toBe(200);
}

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } } });
  root = await mkdtemp(path.join(tmpdir(), "panel-skill-isolation-"));
  cataloguePath = await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: path.resolve("skills"), prompts: [], runtimeResources: [] });
  state.schema = `panel_skill_isolation_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensureAssistantSchema(state.pool);
  await ensureAgentExecutionSchema(state.pool);

  const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
  installWorkbenchIdentity({ requireDomainId: () => domainId, requirePermission } as unknown as WorkbenchIdentity);
  const { default: assistantRouter } = await import("../routes/assistant");
  const { assistantExecutionRouter } = await import("../routes/assistant-execution");
  const { unwrapCallbackCredential } = await import("../../services/agent-runtime/callback-credential");
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  registerPanelSkillProvider();
  const app = express();
  app.use(express.json());
  app.use(unwrapCallbackCredential);
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    registered.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    const token = req.header("tk");
    const known = registered.has(req.body.id) || (req.body.verb === "use" && isBuiltinProductId(req.body.id));
    res.json({ allowed: known && (token === "reader"
      ? denied !== req.body.id : token === "executor" && executorDenied !== req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    res.json({ ids: [...registered].filter(id => id !== denied) });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(["reader", "executor"]).toContain(req.header("tk"));
    const entry = [...entries, library].find(({ useId, applicationId }) => req.query.useId === useId && req.query.applicationId === applicationId);
    if (!entry || (req.header("tk") === "reader" && entry.useId === deniedEntrance)) {
      res.sendStatus(403);
      return;
    }
    res.json({ success: true, data: { applicationId: entry.applicationId, menu: { groups: [], panelUses: [] },
      use: { id: entry.useId, panelId: entry.panelId, path: entry.path, pageKey: entry.entrance.pageKey,
        access: { permissionCode: entry.entrance.permissionCode } } } });
  });
  app.get("/platform/applications/panel-skill-sources", async (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    expect(req.query.domainId).toBe(domainId);
    res.json({ success: true, data: await listSources() });
  });
  app.get("/platform/page-skills", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    const admitted = entries.filter(entry => entry.useId !== deniedEntrance);
    const pageSkills = [...new Set(admitted.map(entry => entry.entrance.permissionCode))].map(permissionCode => ({ permissionCode }));
    res.json({ success: true, data: { pageSkills, registeredSkills: [], admittedEntrances: admitted.map(entry => entry.entrance) } });
  });
  app.post("/internal/agent-execution/validate-setting", (_req, res) => res.sendStatus(204));
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId, userId: "reader", token: req.header("tk") ?? "reader", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/api/assistant/executions", assistantExecutionRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const entry of entries) {
    const projectionId = `projection-${entry.entrance.pageKey}`;
    await register("product-projections", projectionId, {
      name: "Task list", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
      inputs: {}, outputs: {}, config: {}, data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: "platform:ScheduledTask" } }, read: "list", params: {} },
      },
    });
    await register("product-panels", entry.panelId, {
      name: entry.entrance.pageKey, description: "", visibility: "domain", content: vuePanelContent("list"),
      manifest: { state: {}, members: { list: { target: { projectionId } } }, commands: {} },
    });
  }
  await register("product-panels", changing.panelId, {
    name: changing.entrance.pageKey, description: "", visibility: "domain", content: vuePanelContent(),
    manifest: { state: {}, members: {}, commands: {} },
  });
  const libraryProjection = "projection-skill-library";
  const skillType = { type: { kind: "PlatformObjectType", id: SKILL } };
  await register("product-projections", libraryProjection, {
    name: "Skill catalogue", description: "", visibility: "domain", componentId: "@ontomato/sdk:PanelData",
    inputs: { search: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: {
      options: { source: skillType, read: "options", params: {} },
      rows: { source: skillType, read: "query", params: { search: { input: "search" } } },
      record: { source: { object: { literal: { className: SKILL, primaryKey: skillRef(broken).name } } }, read: "record", params: {} },
      components: { source: { type: { kind: "PlatformObjectType", id: SDK_COMPONENT } }, read: "catalogue", params: {} },
      componentDefinition: {
        source: { object: { literal: { className: SDK_COMPONENT, primaryKey: "@ontomato/sdk:ObjectList" } } },
        read: "definition", params: {},
      },
    },
  });
  await register("product-panels", library.panelId, {
    name: "Skill catalogue", description: "", visibility: "domain", content: vuePanelContent("catalogue"),
    manifest: { state: { search: { type: { kind: "scalar", type: "string" }, default: "" } },
      members: { catalogue: { target: { projectionId: libraryProjection }, inputs: { search: { state: "search" } } } }, commands: {} },
  });
  // Only the stored projection predates the current source contract. Its registered panel, grants and uses stay valid.
  const changed = await state.pool.query(
    `UPDATE "${state.schema}".product_projections SET definition=jsonb_set(definition, '{data}', $3::jsonb)
     WHERE domain_id=$1 AND id=$2`,
    [domainId, brokenProjection, JSON.stringify({ operation: { source: { operation: privateOperation }, read: "describe", params: {} } })],
  );
  expect(changed.rowCount).toBe(1);
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (state.pool) {
    await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
    await state.pool.end();
  }
  if (root) await rm(root, { recursive: true });
});
beforeEach(() => {
  entries = [good, broken];
  listSources = async () => entries;
  denied = undefined;
  executorDenied = undefined;
  deniedEntrance = undefined;
});

function read(entry: typeof good, route: string) {
  const { applicationId, useId, entrance, panelId } = entry;
  const query = new URLSearchParams({ applicationId, useId, ...entrance });
  return fetch(`${state.base}/api/product-panels/${panelId}${route}?${query}`);
}

it("keeps a registered panel across SDK releases and refuses only an incompatible rendered projection", async () => {
  const entry = page("release-change");
  entries = [...entries, entry];
  await register("product-panels", entry.panelId, {
    name: "SDK release check", description: "", visibility: "domain", content: vuePanelContent("list", "healthy"),
    manifest: { state: {}, members: {
      list: { target: { projectionId: "projection-good" } },
      healthy: { target: { projectionId: "projection-skill-library" } },
    }, commands: {} },
  });
  const oldDirectory = path.dirname(cataloguePath);
  const sdkRoot = path.dirname(oldDirectory);
  const currentPath = path.join(sdkRoot, "current.json");
  const oldCurrent = await readFile(currentPath, "utf8");
  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
  const manifest = JSON.parse(await readFile(path.join(oldDirectory, "sdk.json"), "utf8"));
  const version = "sdk-test-after-release";
  const directory = path.join(sdkRoot, version);
  const publishCatalogue = (components: typeof catalogue.components) =>
    writeFile(path.join(directory, "components.json"), JSON.stringify({ version, components }));
  const projection = (id: string, rendering = true) => fetch(`${state.base}/api/product-projections/${id}`, {
    headers: rendering ? { [PANEL_MEMBER_RENDER_HEADER]: "1" } : undefined,
  });

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "sdk.json"), JSON.stringify({ ...manifest, version }));
    await publishCatalogue(catalogue.components);
    await writeFile(currentPath, JSON.stringify({ version, digest: "b".repeat(64) }));
    for (const route of ["", "/snapshot"]) {
      const current = await read(entry, route);
      expect(current.status).toBe(200);
      expect(await current.json()).toMatchObject({
        panel: { revision: 1 }, pageSkillContext: { member: { ref: skillRef(entry) } },
      });
    }
    expect((await projection("projection-good")).status).toBe(200);
    expect((await projection("projection-skill-library")).status).toBe(200);

    await publishCatalogue(catalogue.components.map(component => component.componentId === "ObjectList"
      ? { ...component, data: { ...component.data, rows: { results: ["panelRecordQuery"], required: false } } }
      : component));
    const changedResult = await projection("projection-good");
    expect(changedResult.status).toBe(400);
    expect(await changedResult.json()).toMatchObject({ error: {
      code: "PANEL_COMPONENT_DATA_RESULT_MISMATCH", message: expect.stringContaining("data.rows"),
    } });
    expect((await projection("projection-skill-library")).status).toBe(200);

    await publishCatalogue(catalogue.components.filter(component => component.componentId !== "ObjectList"));
    for (const route of ["", "/snapshot"]) {
      const current = await read(entry, route);
      expect(current.status).toBe(200);
      expect(await current.json()).toMatchObject({ panel: { revision: 1 }, pageSkillContext: { member: null } });
    }
    const removedComponent = await projection("projection-good");
    expect(removedComponent.status).toBe(400);
    expect(await removedComponent.json()).toMatchObject({ error: {
      code: "PANEL_COMPONENT_UNAVAILABLE", message: expect.stringContaining("componentId"),
    } });
    expect((await projection("projection-good", false)).status).toBe(200);
    expect((await projection("projection-skill-library")).status).toBe(200);
  } finally {
    await writeFile(currentPath, oldCurrent);
  }
});

async function readLibrary(dataName: string, inputs: Record<string, string> = {}) {
  const response = await fetch(`${state.base}/api/product-panels/read`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: { kind: "registered", applicationId, useId: library.useId },
      memberPath: [{ member: "catalogue" }], dataName, inputs,
    }),
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return productPanelReadResponseSchema.parse(body);
}

it("derives SDK catalogue reads from the page and serves them through the run's executor", async () => {
  entries = [...entries, library];
  const ref = skillRef(library);
  const { panelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const offering = await panelSkillProvider.findByUse(domainId, library, { token: "reader" });
  if (!offering || !("kind" in offering)) throw new Error("Expected a registered catalogue panel");
  const skill = (await offering.provide(ref)).files[0]!.content;
  expect(skill).toContain("POST to `$ONTOMATO_PANEL_OPERATIONS_URL/read`");
  expect(skill).toContain("Member `catalogue`, dataName `components` — catalogue returns `panelRecordList`");
  expect(skill).toContain("Member `catalogue`, dataName `componentDefinition` — definition returns `sdkComponentDefinition`");
  expect(skill).not.toContain("/apps-sdk/current/components.json");

  const runId = randomUUID();
  const run = { status: "running", sessionId: randomUUID(), channel: { authority: { executionKind: "live" } },
    resolvedSkills: [{ skill: ref, digest: "a".repeat(64) }] };
  state.runForOwner.mockResolvedValue(run);
  state.credentialsForRun.mockResolvedValue({ executionUserId: "second-user", credentials: { token: "executor", locale: "en" } });
  const { callbackCredential } = await import("../../services/agent-runtime/callback-credential");
  const pathPrefix = `/api/assistant/executions/${runId}/`;
  const credential = callbackCredential({ pathPrefix, runId, expiresAt: Date.now() + 60_000, token: "reader", apiKey: "" });
  const readFromRun = (dataName: string) => fetch(state.base + pathPrefix + "panels/read", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Ontomato-Callback-Credential": credential.value,
      "X-Ontomato-Run-Id": runId },
    body: JSON.stringify({ source: { kind: "registered", applicationId, useId: library.useId },
      memberPath: [{ member: "catalogue" }], dataName, inputs: {} }),
  });
  for (const datum of ["components", "componentDefinition"]) {
    const response = await readFromRun(datum);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("ready");
    expect(body).toEqual(await readLibrary(datum));
  }
  expect(state.credentialsForRun).toHaveBeenCalledWith(
    { domainId, userId: "reader" }, runId, expect.objectContaining({ token: "reader" }), run.sessionId,
  );

  executorDenied = "projection-skill-library";
  expect(await (await readFromRun("components")).json()).toEqual({ status: "forbidden" });

  state.runForOwner.mockResolvedValue({ ...run, resolvedSkills: [] });
  state.credentialsForRun.mockClear();
  const deniedRun = await readFromRun("components");
  expect(deniedRun.status).toBe(403);
  expect(state.credentialsForRun).not.toHaveBeenCalled();
});

it("reads detail.definition on the real builtin component entry through the authenticated run callback", async () => {
  const bundle = path.join(root, "native-components");
  await cp(path.resolve("../ontology-manager/resources/builtin-panels/sdk-components"), path.join(bundle, "sdk-components"),
    { recursive: true });
  await writeFile(path.join(bundle, "index.json"), JSON.stringify(["sdk-components"]));
  const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
  await registerBuiltinProducts(bundle);
  entries = [...entries, componentsPage];

  const ref = panelSkillRef(domainId, componentsPage.panelId);
  expect(ref.namespace).toEqual({ kind: "provider", provider: "workbench" });
  const panelResponse = await read(componentsPage, "");
  expect(panelResponse.status).toBe(200);
  expect(await panelResponse.json()).toMatchObject({
    panel: { id: componentsPage.panelId },
    pageSkillContext: { locator: componentsPage.entrance, member: { ref } },
  });
  const { panelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const offering = await panelSkillProvider.findByUse(domainId, componentsPage, { token: "reader" });
  if (!offering || !("kind" in offering)) throw new Error("Expected an admitted platform panel offering");
  const skill = (await offering.provide(ref)).files[0]!.content;
  expect(skill).toContain("Member `detail`, dataName `definition` — definition returns `sdkComponentDefinition`");
  expect(skill).not.toContain(componentsPage.useId);

  const runId = randomUUID();
  const run = { status: "running", sessionId: randomUUID(), channel: { authority: { executionKind: "live" } },
    resolvedSkills: [{ skill: ref, digest: "a".repeat(64) }] };
  state.runForOwner.mockResolvedValue(run);
  state.credentialsForRun.mockResolvedValue({ executionUserId: "second-user", credentials: { token: "executor", locale: "en" } });
  const { callbackCredential } = await import("../../services/agent-runtime/callback-credential");
  const pathPrefix = `/api/assistant/executions/${runId}/`;
  const credential = callbackCredential({ pathPrefix, runId, expiresAt: Date.now() + 60_000, token: "reader", apiKey: "" });
  const readDefinition = () => fetch(state.base + pathPrefix + "panels/read", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Ontomato-Callback-Credential": credential.value,
      "X-Ontomato-Run-Id": runId },
    body: JSON.stringify({
      source: { kind: "registered", applicationId: componentsPage.applicationId, useId: componentsPage.useId },
      memberPath: [{ member: "detail" }], dataName: "definition",
      inputs: { target: { className: SDK_COMPONENT, primaryKey: "@ontomato/sdk:ObjectList" } },
    }),
  });
  const response = await readDefinition();
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ status: "ready", value: { componentId: "ObjectList" } });
  expect(state.credentialsForRun).toHaveBeenCalledWith(
    { domainId, userId: "reader" }, runId, expect.objectContaining({ token: "reader" }), run.sessionId,
  );

  deniedEntrance = componentsPage.useId;
  state.credentialsForRun.mockClear();
  expect((await readDefinition()).status).toBe(403);
  expect(state.credentialsForRun).not.toHaveBeenCalled();
});

it("serves current panel records and snapshots without browser storage", async () => {
  const id = "panel-cache-policy";
  const definition = { name: "Before", description: "", visibility: "domain",
    content: vuePanelContent(), manifest: { state: {}, members: {}, commands: {} } };
  await register("product-panels", id, definition);
  const url = `${state.base}/api/product-panels/${id}`;
  const urls = [url, url + "/snapshot"];
  for (const route of urls) {
    const response = await fetch(route);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ panel: { revision: 1, ...(route === url && { name: "Before" }) } });
  }
  const updated = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...definition, name: "After", revision: 1 }) });
  expect(updated.status).toBe(200);
  for (const route of urls) {
    const response = await fetch(route);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ panel: { revision: 2, ...(route === url && { name: "After" }) } });
  }
});

it("lists healthy skills and only admitted diagnostics through the panel's real reads", async () => {
  const options = await readLibrary("options");
  expect(options.status).toBe("ready");
  if (options.status !== "ready") return;
  const picker = panelOptionListSchema.parse(options.value);
  expect(picker.options).toContainEqual(expect.objectContaining({ value: skillRef(good) }));
  expect(picker.options).not.toContainEqual(expect.objectContaining({ value: skillRef(broken) }));
  const diagnostic = expect.stringMatching(/projection-broken.*data\.operation\.source.*stored definition is invalid/u);
  expect(picker.diagnostics).toEqual([diagnostic]);

  const query = await readLibrary("rows", { search: skillRef(good).name });
  expect(query.status).toBe("ready");
  if (query.status !== "ready") return;
  expect(panelRecordQuerySchema.parse(query.value)).toMatchObject({
    rows: [expect.objectContaining({ primaryKey: skillRef(good).name })], total: 1, diagnostics: [diagnostic],
  });
  const empty = await readLibrary("rows", { search: skillRef(broken).name });
  expect(empty).toMatchObject({ status: "ready", value: { rows: [], total: 0, diagnostics: [diagnostic] } });
  const record = await readLibrary("record");
  expect(record).toMatchObject({ status: "error", message: expect.stringContaining("source is unavailable") });
  expect(JSON.stringify([options, query, empty, record])).not.toContain(privateOperation);

  denied = brokenProjection;
  const restricted = await readLibrary("options");
  expect(restricted).toMatchObject({ status: "ready" });
  expect(JSON.stringify(restricted)).not.toContain(brokenProjection);
  expect(JSON.stringify(restricted)).not.toContain(skillRef(broken).name);
});

async function seedAgent(skills: RuntimeSkillRef[]) {
  const id = randomUUID();
  await state.pool!.query(`INSERT INTO "${state.schema}".assistant_agents
    (id, domain_id, kind, name, system_prompt, skills) VALUES ($1::uuid, $2, ($1::uuid)::text, 'Initial', 'Prompt', $3::jsonb)`,
  [id, domainId, JSON.stringify(skills)]);
  return id;
}

function storedAgent(id: string) {
  return state.pool!.query(`SELECT name, skills FROM "${state.schema}".assistant_agents WHERE id=$1`, [id])
    .then(result => result.rows[0]);
}

function agentDefinition(id: string, update?: { name: string; skills?: RuntimeSkillRef[] }) {
  return fetch(`${state.base}/api/assistant/agent-definitions/${id}`, update ? {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "", icon: null, enabled: true, systemPrompt: "Prompt", ...update }),
  } : undefined);
}

it("retains a visible broken root on read and omitted updates and permits its explicit removal", async () => {
  const skills = [skillRef(broken)];
  const id = await seedAgent(skills);
  const response = await agentDefinition(id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ skills });

  const rename = await agentDefinition(id, { name: "Renamed" });
  expect(rename.status, await rename.text()).toBe(200);
  expect(await storedAgent(id)).toEqual({ name: "Renamed", skills });

  const rejected = await agentDefinition(id, { name: "Rejected", skills });
  expect(rejected.status).toBe(502);
  expect(await rejected.json()).toMatchObject({ error: { code: "SKILL_SOURCE_UNAVAILABLE" } });
  expect(await storedAgent(id)).toEqual({ name: "Renamed", skills });

  const cleared = await agentDefinition(id, { name: "Cleared", skills: [] });
  expect(cleared.status, await cleared.text()).toBe(200);
  expect(await storedAgent(id)).toEqual({ name: "Cleared", skills: [] });
});

it("rejects old uncertain roots without writes and gives old hidden roots precedence", async () => {
  const unknown = page("unknown");
  entries = [...entries, unknown];
  registered.add(unknown.panelId);
  denied = brokenProjection;
  const uncertain = skillRef(unknown);
  const hidden = skillRef(broken);
  for (const { skills, status, code } of [
    { skills: [uncertain], status: 502, code: "SKILL_SOURCE_UNAVAILABLE" },
    { skills: [uncertain, hidden], status: 403, code: "SKILL_SELECTION_INCOMPLETE" },
  ]) {
    const id = await seedAgent(skills);
    const response = await agentDefinition(id, { name: "Rejected", skills: [] });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(status);
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(uncertain.name);
    expect(JSON.stringify(body)).not.toContain(hidden.name);
    expect(await storedAgent(id)).toEqual({ name: "Initial", skills });
  }
});

it.each(["", "/snapshot"])("serves the authorized member on GET %s despite a broken sibling", async route => {
  const response = await read(good, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: good.entrance,
    member: { source: { kind: "application-use", applicationId, useId: good.useId }, memberPath: [],
      ref: protectedSkillRef("product-panels", domainId, good.panelId) } });
});

it.each(["", "/snapshot"])("reports the authorized broken projection and field on GET %s", async route => {
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(502);
  expect(body.error.code).toBe("SKILL_SOURCE_UNAVAILABLE");
  expect(body.error.message).toContain(`Panel '${broken.panelId}'`);
  expect(body.error.message).toContain(`projection '${brokenProjection}'`);
  expect(body.error.message).toMatch(/field 'data\.operation\.source': .+/);
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("withholds the member on GET %s when its invalid dependency is not granted", async route => {
  denied = brokenProjection;
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: broken.entrance, member: null });
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("denies GET %s before exposing the invalid dependency of an inaccessible panel", async route => {
  denied = broken.panelId;
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(403);
  expect(body.error.code).toBe("PRODUCT_FORBIDDEN");
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("keeps the displayed panel distinct from its repointed use on GET %s", async route => {
  entries = [{ ...good, panelId: broken.panelId }, broken];
  const response = await read(good, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.panel.id).toBe(good.panelId);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: good.entrance, member: null });
});

it.each(["", "/snapshot"])("keeps another panel's dependency failure private on GET %s", async route => {
  const other = "other-private-panel";
  listSources = async () => [{ ...good, panelId: other }];
  const response = await read(good, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: good.entrance, member: null });
  expect(JSON.stringify(body)).not.toContain(other);
});

it.each(["", "/snapshot"])("classifies a single use with unknown dependencies on GET %s before reporting it", async route => {
  const entry = changing;
  entries = [entry];
  // The route has already loaded its panel when the service lists the matching use.
  // Change its actual stored dependencies at that boundary, so both reads use the real provider.
  const panels = `"${state.schema}".product_panels`;
  for (const hasRootGrant of [false, true]) {
    denied = undefined;
    await state.pool!.query(`UPDATE ${panels} SET definition=jsonb_set(definition,'{manifest,members}','{}') WHERE id=$1 AND domain_id=$2`,
      [entry.panelId, domainId]);
    listSources = async () => {
      await state.pool!.query(`UPDATE ${panels} SET definition=jsonb_set(definition,'{manifest,members}',to_jsonb($3::text))
        WHERE id=$1 AND domain_id=$2`, [entry.panelId, domainId, privateOperation]);
      denied = hasRootGrant ? undefined : entry.panelId;
      return entries;
    };
    const response = await read(entry, route);
    const body = await response.json();
    if (hasRootGrant) {
      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error.code).toBe("SKILL_SOURCE_UNAVAILABLE");
      for (const privateValue of [entry.panelId, skillRef(entry).name, "manifest", privateOperation])
        expect(JSON.stringify(body)).not.toContain(privateValue);
    } else {
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.pageSkillContext).toEqual({ mode: "member", locator: entry.entrance, member: null });
    }
  }
});
