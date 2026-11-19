import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";

const fixture = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined, schema: "",
  domainId: "sdk-history", panelId: "settings",
  skill: { namespace: { kind: "domain", domainId: "sdk-history" }, name: "panel-menu-settings" },
}));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => fixture.pool,
  qualifiedTable: (name: string) => `"${fixture.schema}"."${name}"`,
}));
vi.mock("../../services/assistant/execution-setting", () => ({ validateExecutionSetting: vi.fn() }));
vi.mock("../../utils/backend-client", async original => ({
  ...await original<typeof import("../../utils/backend-client")>(),
  backendGet: async (endpoint: string) => {
    const data = endpoint === "panel-skill-sources"
      ? [{ skill: fixture.skill, uses: [{
        applicationId: "settings", useId: "settings-panel", pageKey: "settings", panelId: fixture.panelId,
        path: "/applications/settings/settings",
      }] }]
      : { pageSkills: [{ permissionCode: "analysis-agent", skill: fixture.skill }], registeredSkills: [fixture.skill] };
    expect(["panel-skill-sources", "page-skills"]).toContain(endpoint);
    return { text: JSON.stringify({ success: true, data }) };
  },
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const older = "1.1.2-dev.installed";
const bundled = "1.1.2-dev.current";
const agentId = randomUUID();
let server: Server;
let root: string;
let base: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "installed-sdk-skill-"));
  const publicSkills = path.join(root, "public");
  await Promise.all([mkdir(publicSkills), ...[
    ["data", older], ["dist", bundled],
  ].map(async ([area, version]) => {
    const sdk = path.join(root, area!, "apps-sdk", version!);
    await mkdir(sdk, { recursive: true });
    await writeFile(path.join(sdk, "components.json"), JSON.stringify({ version, components: [] }));
  })]);
  await writeFile(path.join(root, "dist/apps-sdk/current.json"), JSON.stringify({ version: bundled }));
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
    CREATE TABLE "${fixture.schema}".assistant_agents (
      id uuid PRIMARY KEY, domain_id text, kind text, name text, description text, enabled boolean,
      system_prompt text, model_selection jsonb, skills jsonb, icon text, class_names jsonb,
      enabled_mcp_service_ids jsonb, sort_order integer, execution_user_id text, model_reference_migrated boolean
    );
    CREATE TABLE "${fixture.schema}".product_native_agent_bindings (domain_id text, agent_id text, asset_id text)`);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".product_panels VALUES ($1,$2,'editor',$3,1,now(),now())`, [
    fixture.panelId, fixture.domainId, {
      name: "Older panel", description: "", visibility: "domain", sdkVersion: older,
      content: { html: "", module: "" }, manifest: { state: {}, slots: {}, operations: [] },
    },
  ]);
  await fixture.pool.query(`INSERT INTO "${fixture.schema}".assistant_agents
    (id,domain_id,kind,name,description,enabled,system_prompt,model_selection,skills,class_names,enabled_mcp_service_ids,sort_order)
    VALUES ($1::uuid,$2,($1::uuid)::text,'Before','',true,'','{"modelId":null}',$3,'[]','[]',0)`,
  [agentId, fixture.domainId, JSON.stringify([fixture.skill])]);

  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const { default: assistantRouter } = await import("../routes/assistant");
  registerPanelSkillProvider();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "editor", domainId: fixture.domainId, token: "editor", locale: "en" });
    next();
  });
  app.use("/api/assistant", assistantRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assistant`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (fixture.pool) {
    await fixture.pool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
    await fixture.pool.end();
  }
  if (root) await rm(root, { recursive: true });
});

it("lists a panel's skill and saves a definition using its installed older SDK", async () => {
  const [listed, saved] = await Promise.all([
    fetch(base + "/agent-skills"),
    fetch(`${base}/agent-definitions/${agentId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", description: "", icon: null, enabled: true, systemPrompt: "", skills: [fixture.skill] }),
    }),
  ]);
  expect([listed.status, saved.status]).toEqual([200, 200]);
  expect(await listed.json()).toMatchObject({ skills: expect.arrayContaining([expect.objectContaining({ skill: fixture.skill })]) });
  expect(await saved.json()).toMatchObject({ id: agentId, name: "Renamed", skills: [fixture.skill] });
  const result = await fixture.pool!.query(`SELECT name,skills FROM "${fixture.schema}".assistant_agents WHERE id=$1`, [agentId]);
  expect(result.rows).toEqual([{ name: "Renamed", skills: [fixture.skill] }]);
});
