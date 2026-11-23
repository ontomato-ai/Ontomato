import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PanelSkillSource } from "@ontomato/contracts/product-panels";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { workbenchServerResourceRoot } from "../../content/resources";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureAgentExecutionSchema } from "../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensureAssistantPresetUpgradesSchema } from "../../infrastructure/postgres-migrations/20261121-assistant-preset-upgrades/schema";
import {
  GOVERNANCE_KIND,
  GOVERNANCE_PANEL_ID,
  GOVERNANCE_PRESET_VERSION,
  GOVERNANCE_SKILL,
  GOVERNANCE_SKILLS,
} from "../../services/assistant/governance-definition";
import { initializeDomainPresetAgents, initializeExistingDomainPresetAgents } from "../../services/assistant/preset-initialization";
import { assistantStore } from "../../services/assistant/store";
import { panelSkillRef } from "../../services/product-panels/skill-identity";
import { errorHandler } from "../middleware/error-handler";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ queryServiceToken: "fixture-service" }),
    publicBasePath: () => "",
    queryBase: () => state.base,
    queryTimeout: () => 30000,
  },
}));
vi.mock("../../utils/request-identity", async (original) => ({
  ...(await original<typeof import("../../utils/request-identity")>()),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server | undefined;
let contentRoot: string;

const panelSourcesByDomain = new Map<string, PanelSkillSource[]>();
const startupDomain = "domain-enumerated-by-java";
const presetKinds = ["regular", "analysis", GOVERNANCE_KIND].sort();

function initializeViaService(domainId: string, token?: string) {
  return fetch(`${state.base}/internal/assistant/domains/${domainId}/initialize-presets`, {
    method: "POST",
    headers: token ? { "X-Ontomato-Query-Service-Token": token } : {},
  });
}

async function api(domainId: string, method: string, route: string, body?: unknown) {
  return fetch(`${state.base}/api/${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-domain-id": domainId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedBuiltinBusinessKnowledgePanel() {
  const bundle = path.join(contentRoot, "builtin-business-knowledge");
  await cp(
    path.resolve("../ontology-manager/resources/builtin-panels/business-knowledge"),
    path.join(bundle, "business-knowledge"),
    { recursive: true },
  );
  await writeFile(path.join(bundle, "index.json"), JSON.stringify(["business-knowledge"]));
  const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
  await registerBuiltinProducts(bundle);
}

function exposeBusinessKnowledgeEntry(domainId: string) {
  panelSourcesByDomain.set(domainId, [{
    applicationId: "ontology",
    useId: "business-knowledge",
    panelId: GOVERNANCE_PANEL_ID,
    path: "/ontology/knowledge",
    entrance: { permissionCode: "business-knowledge", pageKey: "business-knowledge" },
  }]);
}

async function storedGovernanceRow(domainId: string) {
  const result = await state.pool!.query<{ id: string; skills: unknown[] }>(
    `SELECT id, skills FROM "${state.schema}".assistant_agents WHERE domain_id=$1 AND kind=$2`,
    [domainId, GOVERNANCE_KIND],
  );
  return result.rows[0] ?? null;
}

async function upgradeRecordCount(domainId: string) {
  const result = await state.pool!.query(
    `SELECT 1 FROM "${state.schema}".assistant_preset_upgrades WHERE domain_id=$1 AND kind=$2 AND version=$3`,
    [domainId, GOVERNANCE_KIND, GOVERNANCE_PRESET_VERSION],
  );
  return result.rowCount ?? 0;
}

async function expectReadOnlyAgentLists(domainId: string) {
  const owner = { domainId, userId: "admin" };
  const readAgents = () => state.pool!.query(
    `SELECT * FROM "${state.schema}".assistant_agents WHERE domain_id=$1 ORDER BY id`, [domainId],
  );
  const { rows } = await readAgents();
  const definitionIds = rows.filter(row => row.kind !== "app-builder").map(row => row.id).sort();
  const upgrades = await upgradeRecordCount(domainId);

  expect((await assistantStore.agents(domainId)).map(agent => agent.id).sort()).toEqual(definitionIds);
  expect((await assistantStore.channelAgents(domainId)).map(agent => agent.id).sort()).toEqual(rows.map(row => row.id));
  expect(await assistantStore.countAgentDefinitions(domainId)).toBe(definitionIds.length);
  const { listAgentDefinitions } = await import("../../services/assistant/definitions");
  const definitions = await listAgentDefinitions(owner, { token: domainId, locale: "en" });
  expect(definitions.agents.map(agent => agent.id).sort()).toEqual(definitionIds);
  for (const route of ["assistant/agents", "assistant/agent-definitions"]) {
    const response = await api(domainId, "GET", route);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as { agents: { id: string }[] };
    expect(result.agents.map(agent => agent.id).sort()).toEqual(definitionIds);
  }

  expect((await readAgents()).rows).toEqual(rows);
  expect(await upgradeRecordCount(domainId)).toBe(upgrades);
}

async function governanceEffectiveSkills(domainId: string, agentId: string) {
  const response = await api(domainId, "GET", "assistant/agents");
  expect(response.status, await response.clone().text()).toBe(200);
  const { agents } = await response.json() as { agents: { id: string; effectiveSkills: unknown[] }[] };
  return agents.find(agent => agent.id === agentId)!.effectiveSkills;
}

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
  state.schema = `gov_preset_panel_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);
  await ensureAssistantDefaultPromptSchema(state.pool);
  await ensureAssistantPresetUpgradesSchema(state.pool);
  await ensureAgentExecutionSchema(state.pool);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  contentRoot = await mkdtemp(path.join(os.tmpdir(), "gov-preset-panel-"));
  const publicSkillsRoot = path.join(contentRoot, "public");
  await Promise.all([mkdir(publicSkillsRoot), writeBundledAppSdkFixture(contentRoot)]);
  installContentLayout({
    runtimeRoot: contentRoot,
    publicSkillsRoot,
    runtimeResources: [],
    prompts: [{ from: path.join(workbenchServerResourceRoot, "prompts"), to: "." }],
  });

  const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
  installWorkbenchIdentity({
    requireDomainId: () => "unused",
    requirePermission,
    assertPermission: async () => undefined,
  } as unknown as WorkbenchIdentity);

  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { default: assistantRouter, assistantInternalRouter } = await import("../routes/assistant");
  registerPanelSkillProvider();

  const app = express();
  app.use(express.json());
  app.post("/product-governance/resources", (_req, res) => {
    res.json({ ids: [] });
  });
  app.post("/product-governance/service-resources", (_req, res) => {
    res.json({ ids: [] });
  });
  app.post("/product-governance/check", (_req, res) => {
    res.json({ allowed: true });
  });
  app.get("/internal/domains/ids", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    res.json([startupDomain]);
  });
  app.get("/platform/applications/panel-skill-sources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    const domainId = String(req.query.domainId);
    res.json({ success: true, data: panelSourcesByDomain.get(domainId) ?? [] });
  });
  app.get("/platform/page-skills", (req, res) => {
    const domainId = req.header("tk")!;
    const sources = panelSourcesByDomain.get(domainId) ?? [];
    res.json({
      success: true,
      data: {
        pageSkills: sources.map(({ entrance }) =>
          "permissionCode" in entrance ? { permissionCode: entrance.permissionCode } : entrance),
        registeredSkills: [],
        admittedEntrances: sources.map((source) => source.entrance),
      },
    });
  });
  app.post("/internal/agent-execution/validate-setting", (_req, res) => {
    res.json({});
  });

  app.use("/api", (req, _res, next) => {
    const domainId = req.header("x-domain-id") ?? "default-domain";
    Object.assign(req, { domainId, userId: "admin", token: domainId, locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/internal/assistant", assistantInternalRouter);
  app.use(errorHandler);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  if (state.pool) {
    await state.pool.query(`DROP SCHEMA IF EXISTS "${state.schema}" CASCADE`);
    await state.pool.end();
  }
  if (contentRoot) await rm(contentRoot, { recursive: true, force: true });
});

it("upgrades existing domains at startup once the registered governance panel is exposed", async () => {
  const domainId = "domain-deferred";
  const panelRef = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
  const existingId = randomUUID();
  await state.pool!.query(
    `INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind, name, description, system_prompt, skills, sort_order)
     VALUES ($1, $2, $3, 'Knowledge governance', 'Existing', NULL, $4::jsonb, 2)`,
    [existingId, domainId, GOVERNANCE_KIND, JSON.stringify(GOVERNANCE_SKILLS)],
  );

  await initializeDomainPresetAgents(domainId);
  expect((await assistantStore.agents(domainId)).map(agent => agent.kind).sort()).toEqual(presetKinds);
  expect(await storedGovernanceRow(domainId)).toEqual({ id: existingId, skills: GOVERNANCE_SKILLS });
  expect(await upgradeRecordCount(domainId)).toBe(0);

  await seedBuiltinBusinessKnowledgePanel();
  await initializeDomainPresetAgents(domainId);
  expect(await upgradeRecordCount(domainId)).toBe(0);

  exposeBusinessKnowledgeEntry(domainId);
  await expectReadOnlyAgentLists(domainId);

  // The existing domain is known only to PG, and the other domain exists only in Java.
  await initializeExistingDomainPresetAgents();
  expect((await assistantStore.agents(startupDomain)).map(agent => agent.kind).sort()).toEqual(presetKinds);
  expect(await storedGovernanceRow(domainId)).toEqual({ id: existingId, skills: [...GOVERNANCE_SKILLS, panelRef] });
  expect(await upgradeRecordCount(domainId)).toBe(1);
});

it("only creates agents through the service-token initialization endpoint and never re-adds an admin-removed skill", async () => {
  const domainId = "domain-visible-new";
  const panelRef = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
  await seedBuiltinBusinessKnowledgePanel();
  exposeBusinessKnowledgeEntry(domainId);

  expect((await initializeViaService(domainId)).status).toBe(403);
  expect(await assistantStore.agents(domainId)).toEqual([]);
  await expectReadOnlyAgentLists(domainId);

  const initialize = () => initializeViaService(domainId, "fixture-service");
  expect((await initialize()).status).toBe(204);
  const presets = await assistantStore.channelAgents(domainId);
  expect(presets.map(agent => agent.kind).sort()).toEqual([...presetKinds, "app-builder"].sort());
  const stored = (await storedGovernanceRow(domainId))!;
  expect(stored.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
  expect(await governanceEffectiveSkills(domainId, stored.id)).toContainEqual(panelRef);
  expect(await upgradeRecordCount(domainId)).toBe(1);
  expect((await initialize()).status).toBe(204);
  expect(await assistantStore.channelAgents(domainId)).toEqual(presets);
  await expectReadOnlyAgentLists(domainId);

  const updated = await api(domainId, "PUT", `assistant/agent-definitions/${stored.id}`, {
    name: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
    icon: null,
    enabled: true,
    systemPrompt: "",
    skills: [GOVERNANCE_SKILL],
  });
  expect(updated.status, await updated.clone().text()).toBe(200);

  expect((await initialize()).status).toBe(204);
  expect(await storedGovernanceRow(domainId)).toEqual({ id: stored.id, skills: [GOVERNANCE_SKILL] });
  expect(await governanceEffectiveSkills(domainId, stored.id)).not.toContainEqual(panelRef);
  expect(await upgradeRecordCount(domainId)).toBe(1);
});
