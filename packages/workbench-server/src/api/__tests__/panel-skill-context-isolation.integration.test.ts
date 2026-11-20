import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { panelOptionListSchema, panelRecordQuerySchema } from "@ontomato/contracts/panel-projection";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { SKILL } from "@ontomato/contracts/platform-object-types";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { protectedSkillRef } from "../../core/skills/providers";
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

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: {
  agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "",
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
const brokenProjection = "projection-broken";
const privateOperation = "private-stored-operation-body";
const skillRef = (entry: typeof good) => protectedSkillRef("product-panels", domainId, entry.panelId);
const registered = new Set<string>();
let entries = [good, broken];
let listSources = async () => entries;
let denied: string | undefined;
let root: string;
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
  await writeBundledAppSdkFixture(root);
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
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  registerPanelSkillProvider();
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    registered.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: req.header("tk") === "reader" && registered.has(req.body.id) && denied !== req.body.id });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    res.json({ ids: [...registered].filter(id => id !== denied) });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    const entry = [...entries, library].find(({ useId, applicationId }) => req.query.useId === useId && req.query.applicationId === applicationId)!;
    res.json({ success: true, data: { applicationId, menu: { groups: [], panelUses: [] },
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
    res.json({ success: true, data: { pageSkills: [{ permissionCode: good.entrance.permissionCode }], registeredSkills: [],
      admittedEntrances: entries.map(entry => entry.entrance) } });
  });
  app.post("/internal/agent-execution/validate-setting", (_req, res) => res.sendStatus(204));
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId, userId: "reader", token: "reader", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api/assistant", assistantRouter);
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
      manifest: { state: {}, members: { list: { target: { projectionId } } }, events: {} },
    });
  }
  await register("product-panels", changing.panelId, {
    name: changing.entrance.pageKey, description: "", visibility: "domain", content: vuePanelContent(),
    manifest: { state: {}, members: {}, events: {} },
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
    },
  });
  await register("product-panels", library.panelId, {
    name: "Skill catalogue", description: "", visibility: "domain", content: vuePanelContent("catalogue"),
    manifest: { state: { search: { type: { kind: "scalar", type: "string" }, default: "" } },
      members: { catalogue: { target: { projectionId: libraryProjection }, inputs: { search: { state: "search" } } } }, events: {} },
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
});

function read(entry: typeof good, route: string) {
  const { applicationId, useId, entrance, panelId } = entry;
  const query = new URLSearchParams({ applicationId, useId, ...entrance });
  return fetch(`${state.base}/api/product-panels/${panelId}${route}?${query}`);
}

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
