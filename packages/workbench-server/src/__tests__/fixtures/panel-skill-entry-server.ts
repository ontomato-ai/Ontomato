import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type pg from "pg";
import { expect, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkill } from "@ontomato/contracts/page-skills";
import type { PanelSkillSource } from "@ontomato/contracts/product-panels";
import { SkillRegistry, type InstalledSkill } from "../../../../agent-runtime/src/skills";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { SessionSandbox } from "../../../../agent-runtime/src/sandbox";
import { RuntimeStore } from "../../../../agent-runtime/src/store";
import { RuntimeError } from "../../../../agent-runtime/src/errors";
import { removeWorkerFiles } from "../../../../agent-runtime/src/worker";
import { protectedSkillRef } from "../../core/skills/providers";
import { installContentLayout } from "../../content/layout";
import { workbenchServerResourceRoot } from "../../content/resources";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureOpsDiagnosisSchema } from "../../infrastructure/postgres-migrations/20261029-ops-diagnosis/schema";
import { ensureAssistantDefaultPromptSchema } from "../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { ensureWorkspacesSchema } from "../../infrastructure/postgres-migrations/20261109-workspaces/schema";
import { ensureAgentExecutionSchema } from "../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { writeBundledAppSdkFixture } from "./bundled-app-sdk";
import { vuePanelContent } from "./vue-panel";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", origin: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/environment", async original => {
  const { environment } = await original<typeof import("../../config/environment")>();
  return { environment: { ...environment, queryBase: () => state.origin, agentRuntime: () => ({
    ...environment.agentRuntime(), url: state.origin, callbackUrl: state.origin, token: "fixture-runtime", queryServiceToken: "fixture-platform",
  }) } };
});
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.origin; } } } }));

const domainId = "panel-entry-domain";
const host = { id: "workbench", providers: ["workbench"], domainSkills: true, token: "fixture-runtime" };
const scope = { domainId, hostId: host.id };
const panelEntries: PanelSkillSource[] = [
  { applicationId: "app-business-knowledge-panel", useId: "business-knowledge-panel-use", panelId: "panel-business-knowledge",
    path: "/applications/app-business-knowledge-panel/manage", entrance: { access: "domain-member", pageKey: "business-knowledge-panel" } },
  { applicationId: "app-panels-trial-a", useId: "use-trial-a-tasks", panelId: "panel-schedules-trial",
    path: "/applications/app-panels-trial-a/tasks", entrance: { access: "domain-member", pageKey: "panels-trial-a-tasks" } },
];

function javaUse({ useId, panelId, path, entrance }: PanelSkillSource) {
  return { id: useId, panelId, path, pageKey: entrance.pageKey, names: { en: entrance.pageKey },
    access: "permissionCode" in entrance ? { permissionCode: entrance.permissionCode } : { kind: entrance.access } };
}

/** One origin for the panel, assistant, runtime and the external Java/Grant HTTP fixtures. */
export async function startPanelSkillEntryServer(options: {
  entries?: PanelSkillSource[];
  grants?: Set<string>;
  nativeMapping?: () => PageSkill | undefined;
  admittedEntrances?: () => PanelSkillSource["entrance"][] | undefined;
  onPublish?: (pkg: unknown) => string | void;
} = {}) {
  const database = process.env.RUNTIME_TEST_DATABASE_URL;
  if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
  const entries = options.entries ?? structuredClone(panelEntries);
  const grants = options.grants ?? new Set(["records", ...entries.map(page => page.panelId)]);
  const regularAgentId = randomUUID();
  const root = await mkdtemp(path.join(tmpdir(), "panel-entry-skill-"));
  const publicSkillsRoot = path.join(root, "public");
  await Promise.all([mkdir(publicSkillsRoot), writeBundledAppSdkFixture(root)]);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot, runtimeResources: [],
    prompts: [{ from: path.join(workbenchServerResourceRoot, "prompts"), to: "." }] });
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
  const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
  installWorkbenchIdentity({ requireDomainId: () => domainId, requirePermission, assertPermission: async () => undefined } as unknown as WorkbenchIdentity);
  state.schema = `panel_entry_${randomUUID().replaceAll("-", "")}`;
  const store = new RuntimeStore(database, state.schema);
  state.pool = store.pool;
  const app = express();
  app.use(express.json());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = state.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const registry = new SkillRegistry(store, path.join(root, "published"));
  await store.initialize();
  const pool = store.pool;
  await ensureAssistantSchema(pool);
  await ensureAssistantDefaultPromptSchema(pool);
  await ensureAgentExecutionSchema(pool);
  await ensureOpsDiagnosisSchema(pool);
  await ensureWorkspacesSchema(pool);
  await ensureProductAssetsSchema(pool);
  await ensureProductPanelsSchema(pool);
  await pool.query(`INSERT INTO ${store.table("assistant_agents")} (id,domain_id,kind,name,system_prompt,skills)
    VALUES($1,$2,'regular','Assistant',NULL,'[]')`, [regularAgentId, domainId]);
  await pool.query(`INSERT INTO ${store.table("product_projections")} (id,domain_id,owner_id,definition)
    VALUES('records',$1,'editor',$2)`, [domainId, {
    name: "Records", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: "platform:AgentDefinition" } }, read: "list", params: {} } },
  }]);
  for (const id of new Set([...panelEntries, ...entries].map(entry => entry.panelId))) {
    await pool.query(`INSERT INTO ${store.table("product_panels")} (id,domain_id,owner_id,definition)
      VALUES($1,$2,'editor',$3)`, [id, domainId, {
      name: id, description: "", visibility: "domain", content: vuePanelContent("records"),
      manifest: { state: {}, members: { records: { target: { projectionId: "records" } } }, events: {} },
    }]);
  }

  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  const { productPanelsRouter, productProjectionsRouter } = await import("../../api/routes/product-panels");
  const { default: skillsRouter } = await import("../../api/routes/skills");
  const { default: assistantRouter } = await import("../../api/routes/assistant");
  const { agentChannelRouter } = await import("../../api/routes/agent-channel");
  const { appBuilderRouter } = await import("../../api/routes/app-builder");
  const { mountAppsSdkStatic } = await import("../../api/routes/apps-sdk");
  registerPanelSkillProvider();

  app.post("/platform/agent-channel/callers", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    res.json({ id: req.body.id, domainId });
  });
  app.post("/platform/agent-channel/restore", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-platform");
    res.json({ domainId, userId: "editor", expiresAt: Date.now() + 60000 });
  });
  app.post("/ontology/retrieval-callers", (req, res) => {
    res.json({ id: req.header("X-Ontomato-Retrieval-Caller-Id"), expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  app.get("/platform/applications/panel-skill-sources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-platform");
    expect(req.query.domainId).toBe(domainId);
    res.json({ success: true, data: entries });
  });
  app.get("/platform/page-skills", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    const native = options.nativeMapping?.();
    res.json({ success: true, data: {
      pageSkills: entries.map(({ entrance }) => "permissionCode" in entrance
        ? (native && "permissionCode" in native && native.permissionCode === entrance.permissionCode ? native : { permissionCode: entrance.permissionCode })
        : { ...entrance, defaults: [{ pageKey: entrance.pageKey, defaultAgent: { kind: "preset", agentKind: "regular" } }] }),
      registeredSkills: native ? [native.skill] : [], admittedEntrances: options.admittedEntrances?.() ?? entries.map(use => use.entrance),
    } });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    const entry = entries.find(use => req.query.applicationId === use.applicationId && req.query.useId === use.useId)!;
    res.json({ success: true, data: { applicationId: entry.applicationId, menu: { groups: [], panelUses: [] }, use: javaUse(entry) } });
  });
  app.get("/api/data-query/platform/applications/:id/panel-uses", (req, res) => {
    res.json({ success: true, data: { applicationId: req.params.id, entry: { path: `/applications/${req.params.id}`, renderer: "panels" },
      panelUses: entries.filter(use => use.applicationId === req.params.id).map(javaUse) } });
  });
  app.post("/product-governance/check", (req, res) => res.json({ allowed: req.header("tk") === "editor" && grants.has(req.body.id) }));
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("editor");
    res.json({ ids: [...grants] });
  });
  app.post("/product-governance/service-resources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-platform");
    expect(req.body).toMatchObject({ domainId, userId: "editor" });
    res.json({ ids: [...grants] });
  });
  const installedSessions = new Map<string, { installed: InstalledSkill[]; workspace: string; systemPrompt: string }>();
  app.post("/v1/skills", async (req, res) => {
    expect(req.header("X-Domain-Id")).toBe(domainId);
    const rejection = options.onPublish?.(req.body);
    if (rejection) {
      res.status(422).json({ error: { code: "INVALID_REQUEST", message: rejection } });
      return;
    }
    const version = await registry.register(host, domainId, req.body);
    res.status(201).json(version);
  });
  app.post("/v1/sessions", async (req, res) => {
    res.status(201).json(await store.createSession(scope, req.header("Idempotency-Key")!));
  });
  app.get("/v1/sessions/:session", (req, res, next) => {
    void store.session(scope, req.params.session).then(
      session => res.json({ session, messages: [], pendingQuestions: [], latestRun: null }),
      error => {
        if (!(error instanceof RuntimeError)) return next(error);
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
      },
    );
  });
  app.post("/v1/channel/sessions/:session/bind", (_req, res) => res.sendStatus(204));
  // Stand in for the scheduler at its HTTP boundary. The actual host request supplies the actor, input and page context.
  app.post("/v1/channel/sessions/:session/runs", async (req, res) => {
    const runId = req.header("Idempotency-Key")!;
    const sessionId = req.params.session;
    const { channel, language, input, context, presentationBinding, credential } = req.body;
    const response = await fetch(origin + "/internal/agent-channel/prepare", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "fixture-platform",
      "X-Domain-Id": domainId, tk: credential.token,
    }, body: JSON.stringify({ ...channel, mode: "run", sessionId, runId, inputId: runId, input, language, context, presentationBinding }) });
    const body = await response.json();
    if (!response.ok) { res.status(response.status).json(body); return; }
    const prepared = runtimeStartRunRequestSchema.parse(body);
    const installed = await Promise.all(prepared.definition.skills.map(version => registry.resolve(host, domainId, version)));
    const sandbox = new SessionSandbox(store, root, { development: true, python: "python3" }, scope, sessionId);
    await sandbox.prepare(installed);
    await store.admit(scope, {
      id: runId, sessionId, domainId, status: "running", correlationId: runId, language: prepared.language,
      createdAt: new Date().toISOString(), finishedAt: null, stopReason: null, errorMessage: null,
      answerMessageId: null, workspaceCommit: null, definition: prepared.definition,
      resolvedSkills: installed.map(({ skill, digest, description }) => ({ skill, digest, description })),
      environment: { values: prepared.environment.values, secretNames: Object.keys(prepared.environment.secrets) },
    }, runId, input);
    installedSessions.set(sessionId, { installed, workspace: sandbox.workspace, systemPrompt: prepared.definition.systemPrompt });
    res.status(202).json({
      delivery: { messageId: runId, sessionRef: { providerId: "workbench", sessionId }, runId, delivery: "run", status: "starting" },
      input: { id: runId, runId, messageSeq: 1, contextSeq: null, message: input }, pendingQuestions: [], replayed: false,
    });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId, userId: "editor", token: "editor", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/api/skills", skillsRouter);
  app.use("/api", appBuilderRouter);
  mountAppsSdkStatic(app);
  app.use("/internal/agent-channel", agentChannelRouter);


  return {
    origin, domainId, regularAgentId, entries: panelEntries,
    async installedSkill(sessionId: string, ref: RuntimeSkillRef) {
      const { installed, workspace, systemPrompt } = installedSessions.get(sessionId)!;
      const version = installed.find(entry => runtimeSkillKey(entry.skill) === runtimeSkillKey(ref))!;
      const entry = entries.find(page => runtimeSkillKey(protectedSkillRef("product-panels", domainId, page.panelId)) === runtimeSkillKey(ref))!;
      expect(systemPrompt).toContain(JSON.stringify({ entrance: entry.entrance,
        member: { source: { kind: "application-use", applicationId: entry.applicationId, useId: entry.useId }, memberPath: [], ref },
        path: entry.path }));
      const markdown = await readFile(path.join(workspace, "skills", ref.name, "SKILL.md"), "utf8");
      expect(markdown).toBe(await readFile(path.join(version.directory, "SKILL.md"), "utf8"));
      return { skill: version.skill, digest: version.digest, markdown };
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
      await store.close();
      await removeWorkerFiles(root);
    },
  };
}
