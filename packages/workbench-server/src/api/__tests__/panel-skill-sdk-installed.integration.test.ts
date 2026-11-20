import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runtimeRegisterSkillRequestSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";

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
  ],
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
vi.mock("../../utils/backend-client", async original => ({
  ...await original<typeof import("../../utils/backend-client")>(),
  backendGet: async (endpoint: string, url: string, { headers }: { headers: Record<string, string> }) => {
    let data;
    if (endpoint === "panel-skill-sources") {
      expect(headers["X-Ontomato-Query-Service-Token"]).toBe("fixture-platform");
      expect(new URL(url, "http://ontology.test").searchParams.get("domainId")).toBe(fixture.domainId);
      data = fixture.uses;
    } else {
      expect(headers.tk).toBe("editor");
      if (endpoint === "page-skills") {
        data = {
          pageSkills: fixture.uses.map(({ entrance }) => ({
            permissionCode: entrance.permissionCode,
            ...(fixture.native && entrance.permissionCode === "business-knowledge" && {
              skill: governance,
              defaults: [{ pageKey: entrance.pageKey, defaultAgent: governanceDefault }],
            }),
          })),
          registeredSkills: fixture.native ? [governance] : [],
          admittedEntrances: fixture.uses.map(({ entrance }) => entrance),
        };
      } else {
        expect(endpoint).toBe("panel-use");
        const use = fixture.uses.find(({ applicationId }) => url.endsWith(`/applications/${applicationId}/panel-uses`))!;
        data = {
          applicationId: use.applicationId, entry: { path: `/applications/${use.applicationId}`, renderer: "panels" },
          panelUses: [{ id: use.useId, panelId: use.panelId, path: use.path, pageKey: use.entrance.pageKey,
            access: { permissionCode: use.entrance.permissionCode } }],
        };
      }
    }
    return { text: JSON.stringify({ success: true, data }) };
  },
  backendPost: async (endpoint: string, _url: string, body: unknown, { headers }: { headers: Record<string, string> }) => {
    expect(endpoint).toBe("product-grant-resources");
    expect(headers.tk).toBe("editor");
    expect(body).toEqual({ verb: "use" });
    return { text: JSON.stringify({ ids: fixture.grants }) };
  },
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const current = "1.1.2-dev.current";
const agentId = randomUUID();
let server: Server;
let root: string;
let base: string;
let skill: RuntimeSkillRef;
const published = vi.fn();
const digest = "b".repeat(64);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "installed-sdk-skill-"));
  const publicSkills = path.join(root, "public");
  const installed = path.join(root, "data/apps-sdk", current);
  const distribution = path.join(root, "dist/apps-sdk");
  await Promise.all([mkdir(publicSkills), mkdir(installed, { recursive: true }), mkdir(distribution, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(distribution, "current.json"), JSON.stringify({ version: current, digest: "a".repeat(64) })),
    writeFile(path.join(installed, "sdk.json"), JSON.stringify({ components: "components.json" })),
    writeFile(path.join(installed, "components.json"), JSON.stringify({
      version: current, components: [{ componentId: "ObjectList", meaning: "Displays current objects" }],
    })),
  ]);
  installContentLayout({ runtimeRoot: root, prompts: [], publicSkillsRoot: publicSkills, runtimeResources: [] });
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
  const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
  installWorkbenchIdentity({ requireDomainId: () => fixture.domainId, requirePermission } as unknown as WorkbenchIdentity);

  fixture.schema = `sdk_history_${randomUUID().replaceAll("-", "")}`;
  fixture.pool = new pg.Pool({ connectionString: database });
  await fixture.pool.query(`CREATE SCHEMA "${fixture.schema}";
    CREATE TABLE "${fixture.schema}".product_panels (
      id text, domain_id text, owner_id text, definition jsonb, revision integer, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE "${fixture.schema}".product_projections (LIKE "${fixture.schema}".product_panels);
    CREATE TABLE "${fixture.schema}".assistant_agents (
      id uuid PRIMARY KEY, domain_id text, kind text, name text, description text, enabled boolean,
      system_prompt text, model_selection jsonb, skills jsonb, icon text, class_names jsonb,
      enabled_mcp_service_ids jsonb, sort_order integer, execution_user_id text, model_reference_migrated boolean
    );
    CREATE TABLE "${fixture.schema}".product_native_agent_bindings (domain_id text, agent_id text, asset_id text)`);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".product_panels VALUES ($1,$2,'editor',$3,1,now(),now())`, [
    fixture.panelId, fixture.domainId, {
      name: "Settings panel", description: "", visibility: "domain",
      content: { html: "", module: "" },
      manifest: { state: {}, members: { records: { target: { projectionId: "records" } } }, events: {} },
    },
  ]);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".product_projections VALUES ('records',$1,'editor',$2,1,now(),now())`, [
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
  const { protectedSkillRef } = await import("../../core/skills/providers");
  const { default: assistantRouter } = await import("../routes/assistant");
  registerPanelSkillProvider();
  skill = protectedSkillRef("product-panels", fixture.domainId, fixture.panelId);
  const app = express();
  app.use(express.json());
  app.post("/v1/skills", (req, res) => {
    const pkg = runtimeRegisterSkillRequestSchema.parse(req.body);
    expect(req.header("X-Domain-Id")).toBe(fixture.domainId);
    published(pkg);
    res.json({ skill: pkg.skill, digest, description: "Published panel package" });
  });
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "editor", domainId: fixture.domainId, token: "editor", locale: "en" });
    next();
  });
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
  if (root) await rm(root, { recursive: true });
});

it("lists a code panel's protected skill from the installed current SDK and saves its selection", async () => {
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
