import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runtimeRegisterSkillRequestSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";

import { RuntimeStore } from "../../../../agent-runtime/src/store";
import { SkillRegistry } from "../../../../agent-runtime/src/skills";
import { SessionSandbox } from "../../../../agent-runtime/src/sandbox";
import { removeWorkerFiles } from "../../../../agent-runtime/src/worker";
import { pageSkillContextSchema } from "@ontomato/contracts/page-skills";
import type { PanelSkillSource } from "@ontomato/contracts/product-panels";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { ensureAgentExecutionSchema } from "../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { protectedSkillRef } from "../../core/skills/providers";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";

const fixture = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined, schema: "", runtimeUrl: "",
  domainId: "sdk-history", panelId: "settings",
  grants: ["settings", "records"],
  native: false,
  uses: [
    { applicationId: "settings", useId: "settings-panel", panelId: "settings", path: "/applications/settings/settings",
      entrance: { permissionCode: "analysis-agent", pageKey: "settings" } },
    { applicationId: "other-settings", useId: "other-panel", panelId: "settings", path: "/applications/other-settings/other",
      entrance: { permissionCode: "business-knowledge", pageKey: "other-settings" } },
  ] as PanelSkillSource[],
}));
const governance = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "knowledge-governance" };
const governanceDefault = { kind: "preset" as const, agentKind: "governance-report" };
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => fixture.pool,
  qualifiedTable: (name: string) => `"${fixture.schema}"."${name}"`,
}));
vi.mock("../../services/assistant/execution-setting", () => ({ validateExecutionSetting: vi.fn() }));
vi.mock("../../config/environment", async original => {
  const { environment } = await original<typeof import("../../config/environment")>();
  return { environment: { ...environment, agentRuntime: () => ({
    ...environment.agentRuntime(), url: fixture.runtimeUrl, token: "fixture-runtime", queryServiceToken: "fixture-platform",
  }) } };
});
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return fixture.runtimeUrl; } } } }));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const agentId = randomUUID();
let server: Server;
let root: string;
let base: string;
let skill: RuntimeSkillRef;
const published = vi.fn();
const runtimeHost = { id: "workbench", providers: [], domainSkills: true, token: "fixture-runtime" };
let runtimeStore: RuntimeStore;
let registry: SkillRegistry;
let digest: string;
const regularId = randomUUID();

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bundled-sdk-skill-"));
  const publicSkills = path.join(root, "public");
  await Promise.all([mkdir(publicSkills), writeBundledAppSdkFixture(root)]);
  installContentLayout({ runtimeRoot: root, prompts: [], publicSkillsRoot: publicSkills, runtimeResources: [] });
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
  const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
  installWorkbenchIdentity({ requireDomainId: () => fixture.domainId, requirePermission } as unknown as WorkbenchIdentity);

  fixture.schema = `sdk_history_${randomUUID().replaceAll("-", "")}`;
  fixture.pool = new pg.Pool({ connectionString: database });
  runtimeStore = new RuntimeStore(database, fixture.schema);
  await runtimeStore.initialize();
  registry = new SkillRegistry(runtimeStore, path.join(root, "published"));
  await ensureAssistantSchema(fixture.pool);
  await ensureAssistantDefaultPromptSchema(fixture.pool);
  await ensureAgentExecutionSchema(fixture.pool);
  await ensureProductAssetsSchema(fixture.pool);
  await ensureProductPanelsSchema(fixture.pool);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".product_panels (id,domain_id,owner_id,definition) VALUES ($1,$2,'editor',$3)`, [
    fixture.panelId, fixture.domainId, {
      name: "Settings panel", description: "", visibility: "domain",
      content: { html: "", module: "" },
      manifest: { state: {}, members: { records: { target: { projectionId: "records" } } }, events: {} },
    },
  ]);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".product_projections (id,domain_id,owner_id,definition) VALUES ('records',$1,'editor',$2)`, [
    fixture.domainId, {
      name: "Records", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
      inputs: {}, outputs: {}, config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: "platform:AgentDefinition" } }, read: "list", params: {} } },
    },
  ]);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".assistant_agents
    (id,domain_id,kind,name,description,enabled,system_prompt,model_selection,skills,class_names,enabled_mcp_service_ids,sort_order)
    VALUES ($1::uuid,$2,($1::uuid)::text,'Before','',true,'','{"modelId":null}',$3,'[]','[]',0)`,
  [agentId, fixture.domainId, JSON.stringify([{ namespace: { kind: "domain", domainId: fixture.domainId },
    name: `panel-menu-settings-${"a".repeat(24)}` }])]);

  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const { productPanelsRouter } = await import("../routes/product-panels");
  const { default: assistantRouter } = await import("../routes/assistant");
  registerPanelSkillProvider();
  skill = protectedSkillRef("product-panels", fixture.domainId, fixture.panelId);
  const app = express();
  app.use(express.json());
  app.get("/platform/applications/panel-skill-sources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-platform");
    expect(req.query.domainId).toBe(fixture.domainId);
    res.json({ success: true, data: fixture.uses });
  });
  app.get("/platform/page-skills", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    res.json({ success: true, data: {
      pageSkills: fixture.uses.map(({ entrance }) => "permissionCode" in entrance ? {
        permissionCode: entrance.permissionCode,
        ...(fixture.native && entrance.permissionCode === "business-knowledge" && {
          skill: governance, defaults: [{ pageKey: entrance.pageKey, defaultAgent: governanceDefault }],
        }),
      } : { ...entrance, defaults: [{ pageKey: entrance.pageKey, defaultAgent: { kind: "preset", agentKind: "regular" } }] }),
      registeredSkills: fixture.native ? [governance] : [], admittedEntrances: fixture.uses.map(use => use.entrance),
    } });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    const { applicationId, useId, panelId, path, entrance } = fixture.uses.find(use =>
      req.query.applicationId === use.applicationId && req.query.useId === use.useId)!;
    res.json({ success: true, data: { applicationId, menu: { groups: [], panelUses: [] },
      use: { id: useId, panelId, path, pageKey: entrance.pageKey,
        access: "permissionCode" in entrance ? { permissionCode: entrance.permissionCode } : { kind: entrance.access } } } });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: req.header("tk") === "editor" && fixture.grants.includes(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    res.json({ ids: fixture.grants });
  });
  app.post("/product-governance/service-resources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-platform");
    expect(req.body).toMatchObject({ domainId: fixture.domainId, userId: "editor" });
    res.json({ ids: fixture.grants });
  });
  app.post("/v1/skills", async (req, res) => {
    const pkg = runtimeRegisterSkillRequestSchema.parse(req.body);
    expect(req.header("X-Domain-Id")).toBe(fixture.domainId);
    published(pkg);
    const registered = await registry.register(runtimeHost, fixture.domainId, pkg);
    digest = registered.digest;
    res.json(registered);
  });
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "editor", domainId: fixture.domainId, token: "editor", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/assistant", assistantRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  fixture.runtimeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${fixture.runtimeUrl}/api/assistant`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (fixture.pool) {
    await fixture.pool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
    await fixture.pool.end();
  }
  if (runtimeStore) await runtimeStore.close();
  if (root) await removeWorkerFiles(root);
});

it("lists a code panel's protected skill from the bundled current SDK and saves its selection", async () => {
  const [listed, saved] = await Promise.all([
    fetch(base + "/agent-skills"),
    fetch(`${base}/agent-definitions/${agentId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", description: "", icon: null, enabled: true, systemPrompt: "", skills: [skill] }),
    }),
  ]);
  expect([listed.status, saved.status]).toEqual([200, 200]);
  expect(await listed.json()).toMatchObject({ skills: expect.arrayContaining([expect.objectContaining({ skill })]) });
  expect(await saved.json()).toMatchObject({ id: agentId, name: "Renamed", skills: [skill] });
  const result = await fixture.pool!.query(`SELECT name,skills FROM "${fixture.schema}".assistant_agents WHERE id=$1`, [agentId]);
  expect(result.rows).toEqual([{ name: "Renamed", skills: [skill] }]);
});

it("prepares the same exact panel version from both current uses and omits it when a dependency is unreadable", async () => {
  const { pageSkillMemberContext, prepareAssistantSkills, readAssistantSkillView } = await import("../../services/assistant/skills");
  const credentials = { token: "editor", locale: "en" };
  const agent = { kind: "regular", skills: [] };
  const view = await readAssistantSkillView(fixture.domainId, credentials);
  for (const { applicationId, useId, entrance, path } of fixture.uses) {
    const source = { kind: "application-use" as const, applicationId, useId };
    const context = await pageSkillMemberContext(view, entrance, source, { id: fixture.panelId });
    expect(context).toMatchObject({ member: { source, memberPath: [], ref: skill } });
    expect(await prepareAssistantSkills(fixture.domainId, agent, credentials, context)).toEqual({
      skills: [{ skill, digest }], pageDrafts: true,
      currentPage: { entrance, member: { source, memberPath: [], ref: skill }, path },
    });
  }
  expect(published).toHaveBeenCalledTimes(2);
  expect(published.mock.calls[0]).toEqual(published.mock.calls[1]);
  published.mockClear();
  fixture.grants = [fixture.panelId];
  const denied = await readAssistantSkillView(fixture.domainId, credentials);
  const { applicationId, useId, entrance } = fixture.uses[0]!;
  expect(await pageSkillMemberContext(denied, entrance, { kind: "application-use", applicationId, useId }, { id: fixture.panelId }))
    .toMatchObject({ member: null });
  expect(await prepareAssistantSkills(fixture.domainId, agent, credentials)).toEqual({
    skills: [], pageDrafts: false, currentPage: null,
  });
  expect(published).not.toHaveBeenCalled();
});

it("keeps the native governance skill and preset alongside the protected panel in the same group", async () => {
  const { effectiveAssistantSkills, readAssistantSkillView } = await import("../../services/assistant/skills");
  fixture.grants = [fixture.panelId, "records"];
  fixture.native = true;
  const view = await readAssistantSkillView(fixture.domainId, { token: "editor", locale: "en" });
  const groups = view.pageSkills.filter(group =>
    "permissionCode" in group.locator && group.locator.permissionCode === "business-knowledge");
  expect(groups).toEqual([{
    locator: { permissionCode: "business-knowledge" }, skills: [governance, skill],
    defaults: [{ pageKey: "other-settings", defaultAgent: governanceDefault }],
  }]);
  expect(effectiveAssistantSkills({ kind: "regular", skills: [] }, view)).toHaveLength(2);
});

it("opens registered panel entries, selects the regular assistant and installs the exact current page skill", async () => {
  const { prepareAssistantSkills } = await import("../../services/assistant/skills");
  const { assistantStore } = await import("../../services/assistant/store");
  const pages = [
    { applicationId: "app-business-knowledge-panel", useId: "business-knowledge-panel-use", panelId: "panel-business-knowledge",
      path: "/applications/app-business-knowledge-panel/manage", entrance: { access: "domain-member", pageKey: "business-knowledge-panel" } },
    { applicationId: "app-panels-trial-a", useId: "use-trial-a-tasks", panelId: "panel-schedules-trial",
      path: "/applications/app-panels-trial-a/tasks", entrance: { access: "domain-member", pageKey: "panels-trial-a-tasks" } },
  ] satisfies PanelSkillSource[];
  fixture.uses = pages;
  fixture.native = false;
  fixture.grants = ["records", ...pages.map(page => page.panelId)];
  for (const page of pages) {
    await fixture.pool!.query(`INSERT INTO "${fixture.schema}".product_panels (id,domain_id,owner_id,definition)
      VALUES($1,$2,'editor',$3)`, [page.panelId, fixture.domainId, {
      name: page.entrance.pageKey, description: "", visibility: "domain", content: vuePanelContent("records"),
      manifest: { state: {}, members: { records: { target: { projectionId: "records" } } }, events: {} },
    }]);
  }
  await fixture.pool!.query(`INSERT INTO "${fixture.schema}".assistant_agents (id,domain_id,kind,name,system_prompt,skills)
    VALUES($1,$2,'regular','Assistant',NULL,'[]')`, [regularId, fixture.domainId]);
  const credentials = { token: "editor", locale: "en" };
  const owner = { domainId: fixture.domainId, userId: "editor" };
  const scope = { hostId: runtimeHost.id, domainId: fixture.domainId };
  for (const { applicationId, useId, panelId, entrance, path: pagePath } of pages) {
    const panelUrl = `${fixture.runtimeUrl}/api/product-panels/${panelId}?${new URLSearchParams({ applicationId, useId, ...entrance })}`;
    const opened = await fetch(panelUrl);
    const page = await opened.json();
    expect(opened.status, JSON.stringify(page)).toBe(200);
    const context = pageSkillContextSchema.parse(page.pageSkillContext);
    const member = { source: { kind: "application-use", applicationId, useId }, memberPath: [],
      ref: protectedSkillRef("product-panels", owner.domainId, panelId) };
    expect(context).toEqual({ mode: "member", locator: entrance, member });
    if (context.mode !== "member" || !context.member) throw new Error("Expected an admitted panel member");

    const locator = new URLSearchParams(context.locator);
    const missing = await fetch(`${base}/agents?${locator}`);
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ error: { code: "PAGE_SKILL_FORBIDDEN" } });
    locator.set("member", JSON.stringify(context.member));
    const candidateUrl = `${base}/agents?${locator}`;
    const result = await fetch(candidateUrl);
    const candidates = await result.json();
    expect(result.status, JSON.stringify(candidates)).toBe(200);
    expect(candidates.defaultAgentId).toBe(regularId);
    expect(candidates.agents).toContainEqual(expect.objectContaining({ id: regularId, enabled: true }));
    const agent = await assistantStore.agent(candidates.defaultAgentId, owner);
    const prepared = await prepareAssistantSkills(owner.domainId, agent, credentials, context);
    expect(prepared.currentPage).toEqual({ entrance, member, path: pagePath });
    const installed = await Promise.all(prepared.skills.map(version => registry.resolve(runtimeHost, owner.domainId, version)));
    const sessionId = randomUUID();
    await runtimeStore.createSession(scope, sessionId);
    const sandbox = new SessionSandbox(runtimeStore, root, { development: true, python: "python3" }, scope, sessionId);
    await sandbox.prepare(installed);
    const version = installed.find(entry => entry.skill.name === member.ref.name)!;
    expect(version).toMatchObject({ skill: member.ref, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await readFile(path.join(sandbox.workspace, "skills", member.ref.name, "SKILL.md"), "utf8"))
      .toEqual(await readFile(path.join(version.directory, "SKILL.md"), "utf8"));

    fixture.grants = pages.map(page => page.panelId);
    const denied = await fetch(panelUrl);
    expect(denied.status).toBe(200);
    expect((await denied.json()).pageSkillContext).toEqual({ mode: "member", locator: entrance, member: null });
    expect((await fetch(candidateUrl)).status).toBe(403);
    await expect(prepareAssistantSkills(owner.domainId, agent, credentials, context))
      .rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
    fixture.grants.push("records");
  }
});
