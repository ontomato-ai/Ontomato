import { mountCurrentProductDecisions } from "../../__tests__/fixtures/product-grant-check";
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
const publications: { domainId: string; ids: string[] }[] = [];
const registrations: { domainId: string; id: string }[] = [];
let failRegistrationFor: string | undefined;
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
    entrance: { applicationId: "ontology", entryKey: "business-knowledge", pageKey: "business-knowledge" },
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
  const definitionIds = rows.filter(row => row.kind !== "app-builder" && row.kind !== "ops-diagnosis").map(row => row.id).sort();
  const chatAgentIds = rows.map(row => row.id);
  const upgrades = await upgradeRecordCount(domainId);

  expect((await assistantStore.agents(domainId)).map(agent => agent.id).sort()).toEqual(definitionIds);
  expect((await assistantStore.channelAgents(domainId)).map(agent => agent.id).sort()).toEqual(rows.map(row => row.id));
  expect(await assistantStore.countAgentDefinitions(domainId)).toBe(definitionIds.length);
  const { listAgentDefinitions } = await import("../../services/assistant/definitions");
  const definitions = await listAgentDefinitions(owner, { token: domainId, locale: "en" });
  expect(definitions.agents.map(agent => agent.id).sort()).toEqual(definitionIds);
  for (const [route, expectedIds] of [
    ["assistant/agents", chatAgentIds],
    ["assistant/agent-definitions", definitionIds],
  ] as const) {
    const response = await api(domainId, "GET", route);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as { agents: { id: string }[] };
    expect(result.agents.map(agent => agent.id).sort()).toEqual(expectedIds);
  }

  expect((await readAgents()).rows).toEqual(rows);
  expect(await upgradeRecordCount(domainId)).toBe(upgrades);
}

async function governanceSettingsSkills(domainId: string, agentId: string) {
  const response = await api(domainId, "GET", `assistant/agent-definitions/${agentId}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json() as { skills: unknown[] }).skills;
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
    assertObserveAccess: async () => undefined,
  } as unknown as WorkbenchIdentity);

  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { default: assistantRouter, assistantInternalRouter } = await import("../routes/assistant");
  registerPanelSkillProvider();

  const app = express();
  app.use(express.json());
  mountCurrentProductDecisions(app, {
    token: "fixture-service", domain: caller => caller,
    allow: ({ ownerFacts, verb }, caller) => Boolean(caller && (ownerFacts.ownerId === "admin" || verb === "USE" && ownerFacts.ownerId === null)),
  });
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    registrations.push(req.body);
    return res.json({ success: true });
  });
  app.post("/authorization/objects/decide-batch", (req, res) => {
    const domainId = req.header("tk");
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    res.json({ decisions: req.body.requests.map(({ target }: { target: { domainId: string; id: string } }) =>
      target.domainId === domainId && publications.some(row => row.domainId === domainId && row.ids.includes(target.id))
        ? { allowed: true }
        : { allowed: false, code: "FORBIDDEN", reason: "Agent is not published in this domain" }) });
  });
  app.post("/authorization/objects/published-agent-presets", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    if (req.body.domainId === failRegistrationFor) {
      failRegistrationFor = undefined;
      return res.status(422).json({ error: { code: "FIXTURE_FAILURE", message: "Registration failed" } });
    }
    publications.push(req.body);
    return res.sendStatus(204);
  });
  app.post("/product-governance/resources", (req, res) => {
    res.json({ ids: registrations.filter(row => row.domainId === req.header("tk")).map(row => row.id) });
  });
  app.post("/product-governance/service-resources", (_req, res) => {
    res.json({ ids: [] });
  });
  app.post("/product-governance/check-batch", (req, res) => {
    res.json({ allowed: Object.fromEntries(req.body.ids.map((id: string) => [id, true])) });
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
        pageSkills: sources.map(({ entrance }) => entrance),
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

it("publishes only domain presets once and retries when publication fails", async () => {
  const legacyDomain = "legacy-grants";
  const newDomain = "new-grants";
  const addAgent = async (domainId: string, kind: string) => {
    const id = randomUUID();
    await state.pool!.query(
      `INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind, name) VALUES ($1,$2,$3,'Agent')`,
      [id, domainId, kind],
    );
    return id;
  };
  const oldCustom = await addAgent(legacyDomain, "custom-legacy");
  const builderCopy = await addAgent(legacyDomain, "app-builder:copy");
  await initializeDomainPresetAgents(legacyDomain);
  const builtinKinds = new Set([...presetKinds, "app-builder", "ops-diagnosis"]);
  const presetIds = async (domainId: string) => (await assistantStore.channelAgents(domainId))
    .filter(agent => builtinKinds.has(agent.kind)).map(agent => agent.id);
  const legacyIds = await presetIds(legacyDomain);
  expect(legacyIds).toHaveLength(builtinKinds.size);
  expect(publications.filter(row => row.domainId === legacyDomain)).toEqual([
    { domainId: legacyDomain, ids: expect.arrayContaining(legacyIds) },
  ]);
  const legacyPublication = publications.find(row => row.domainId === legacyDomain)!;
  expect(legacyPublication.ids).toHaveLength(legacyIds.length);
  expect(legacyPublication.ids).not.toContain(oldCustom);
  expect(legacyPublication.ids).not.toContain(builderCopy);

  const newCustom = await addAgent(legacyDomain, "custom-after-upgrade");
  const before = publications.length;
  await initializeDomainPresetAgents(legacyDomain);
  expect(publications).toHaveLength(before);
  expect(legacyPublication.ids).not.toContain(newCustom);
  expect(registrations.filter(row => row.domainId === legacyDomain)).toEqual([]);

  failRegistrationFor = newDomain;
  await expect(initializeDomainPresetAgents(newDomain)).rejects.toMatchObject({ code: "FIXTURE_FAILURE" });
  expect(await assistantStore.channelAgents(newDomain)).toEqual([]);
  await initializeDomainPresetAgents(newDomain);
  const newIds = await presetIds(newDomain);
  expect(newIds).toHaveLength(builtinKinds.size);
  expect(publications.filter(row => row.domainId === newDomain)).toEqual([
    { domainId: newDomain, ids: expect.arrayContaining(newIds) },
  ]);
  expect(publications.find(row => row.domainId === newDomain)?.ids).toHaveLength(newIds.length);

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
  expect(presets.map(agent => agent.kind).sort()).toEqual([...presetKinds, "app-builder", "ops-diagnosis"].sort());
  const stored = (await storedGovernanceRow(domainId))!;
  expect(stored.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
  expect(await governanceSettingsSkills(domainId, stored.id)).toContainEqual(panelRef);
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
  expect(await governanceSettingsSkills(domainId, stored.id)).not.toContainEqual(panelRef);
  expect(await upgradeRecordCount(domainId)).toBe(1);
});
