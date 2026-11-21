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
  const { default: assistantRouter } = await import("../routes/assistant");
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

it("skips and leaves upgrade unrecorded when the builtin panel is unregistered or invisible, then backfills once visible", async () => {
  const domainId = "domain-deferred";
  const panelRef = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
  const existingId = randomUUID();
  await state.pool!.query(
    `INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind, name, description, system_prompt, skills, sort_order)
     VALUES ($1, $2, $3, 'Knowledge governance', 'Existing', NULL, $4::jsonb, 2)`,
    [existingId, domainId, GOVERNANCE_KIND, JSON.stringify(GOVERNANCE_SKILLS)],
  );

  // Panel not registered yet: does not add and does not mark upgraded.
  const beforeReg = await api(domainId, "GET", "assistant/agents");
  expect(beforeReg.status).toBe(200);
  expect((await storedGovernanceRow(domainId))!.skills).toEqual(GOVERNANCE_SKILLS);
  expect(await upgradeRecordCount(domainId)).toBe(0);

  // Builtin panel registered in PG, but not yet visible via page-skills / panel-skill-sources: still skipped and unrecorded.
  await seedBuiltinBusinessKnowledgePanel();
  const invisibleRead = await api(domainId, "GET", "assistant/agent-definitions");
  expect(invisibleRead.status).toBe(200);
  expect((await storedGovernanceRow(domainId))!.skills).toEqual(GOVERNANCE_SKILLS);
  expect(await upgradeRecordCount(domainId)).toBe(0);

  // Expose the panel entry so its page skill becomes visible to the domain.
  exposeBusinessKnowledgeEntry(domainId);

  const afterVisible = await api(domainId, "GET", "assistant/agents");
  expect(afterVisible.status).toBe(200);
  const agents = (await afterVisible.json()).agents as { id: string; effectiveSkills: unknown[] }[];
  expect(agents.find((item) => item.id === existingId)!.effectiveSkills).toContainEqual(panelRef);
  expect((await storedGovernanceRow(domainId))!.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
  expect(await upgradeRecordCount(domainId)).toBe(1);

  // Subsequent read does not duplicate.
  const repeatDefs = await api(domainId, "GET", "assistant/agent-definitions");
  expect(repeatDefs.status).toBe(200);
  const defs = (await repeatDefs.json()).agents as { id: string; skills: unknown[] }[];
  expect(defs.find((item) => item.id === existingId)!.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
});

it("adds the visible builtin panel skill once on a new domain, preserves preset skills, and never re-adds after admin removal", async () => {
  const domainId = "domain-visible-new";
  const panelRef = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
  exposeBusinessKnowledgeEntry(domainId);

  const firstList = await api(domainId, "GET", "assistant/agents");
  expect(firstList.status, await firstList.clone().text()).toBe(200);
  const firstAgents = (await firstList.json()).agents as { id: string; effectiveSkills: unknown[] }[];

  const definitionsRes = await api(domainId, "GET", "assistant/agent-definitions");
  expect(definitionsRes.status).toBe(200);
  const definitions = (await definitionsRes.json()).agents as { id: string; skills: unknown[] }[];

  const storedAfterFirst = await storedGovernanceRow(domainId);
  expect(storedAfterFirst).not.toBeNull();
  expect(storedAfterFirst!.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
  expect(await upgradeRecordCount(domainId)).toBe(1);

  const governanceDef = definitions.find((item) => item.id === storedAfterFirst!.id)!;
  expect(governanceDef.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);
  const governanceAgent = firstAgents.find((item) => item.id === storedAfterFirst!.id)!;
  expect(governanceAgent.effectiveSkills).toContainEqual(panelRef);

  // Reading again does not duplicate the panel skill.
  expect((await api(domainId, "GET", "assistant/agents")).status).toBe(200);
  expect((await api(domainId, "GET", "assistant/agent-definitions")).status).toBe(200);
  expect((await storedGovernanceRow(domainId))!.skills).toEqual([...GOVERNANCE_SKILLS, panelRef]);

  // Admin removes the panel skill; subsequent reads do not add it back.
  const updated = await api(domainId, "PUT", `assistant/agent-definitions/${storedAfterFirst!.id}`, {
    name: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
    icon: null,
    enabled: true,
    systemPrompt: "",
    skills: [GOVERNANCE_SKILL],
  });
  expect(updated.status, await updated.clone().text()).toBe(200);
  expect((await updated.json()).skills).toEqual([GOVERNANCE_SKILL]);

  const afterAdminDelete = await api(domainId, "GET", "assistant/agents");
  expect(afterAdminDelete.status).toBe(200);
  const afterAgents = (await afterAdminDelete.json()).agents as { id: string; effectiveSkills: unknown[] }[];
  expect(afterAgents.find((item) => item.id === storedAfterFirst!.id)!.effectiveSkills).not.toContainEqual(panelRef);
  expect((await storedGovernanceRow(domainId))!.skills).toEqual([GOVERNANCE_SKILL]);
});
