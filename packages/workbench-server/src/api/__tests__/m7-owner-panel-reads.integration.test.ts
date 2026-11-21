import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import AdmZip from "adm-zip";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  AGENT_DEFINITION, DELETE_SKILL, EXPORT_FEEDBACK, EXPORT_SKILL, FEEDBACK_RECORD, SKILL,
} from "@ontomato/contracts/panel-client-requests";
import { productPanelOperationsReadResponseSchema } from "@ontomato/contracts/panel-host";
import { productPanelInputSchema, productProjectionInputSchema } from "@ontomato/contracts/product-panels";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { registerSkillProvider } from "../../core/skills/providers";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { HttpError } from "../../utils/errors";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined,
  schema: "",
  base: "",
  permissions: new Set<string>(["user-feedback", "skill-management", "analysis-agent"]),
}));

vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({
  config: { dataQuery: { get baseUrl() { return state.base; } } },
}));
vi.mock("../../config/environment", () => ({
  environment: {
    agentRuntime: () => ({ url: state.base, token: "runtime-token", queryServiceToken: "fixture-service" }),
    publicBasePath: () => "",
  },
}));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));
vi.mock("../../identity/installed", async original => ({
  ...await original<typeof import("../../identity/installed")>(),
  assertPermission: async (_identity: { token?: string }, keys: readonly string[]) => {
    if (!keys.every(key => state.permissions.has(key))) {
      throw new HttpError(403, `Missing ${keys.join(", ")} permission`, "PERMISSION_DENIED");
    }
  },
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

let server: Server | undefined;
let contentRoot: string;
let publicSkillsRoot: string;
const resourceIds = new Set<string>();
const domainId = "m7-owner-domain";
const panelId = "panel-m7-owners";
const feedbackIds = {
  qaLike: randomUUID(),
  qaDislike: randomUUID(),
  taskLike: randomUUID(),
};
const runIds = {
  qaLike: randomUUID(),
  qaDislike: randomUUID(),
  taskLike: randomUUID(),
};
const messageTargets = {
  qaLike: randomUUID(),
  qaDislike: randomUUID(),
  taskLike: randomUUID(),
};
const agentIds = {
  readable: randomUUID(),
  appBuilder: randomUUID(),
};

const feedbackRefType = { kind: "object", objectType: FEEDBACK_RECORD } as const;
const skillRefType = { kind: "object", objectType: SKILL } as const;

const projections = {
  "proj-feedback-list": productProjectionInputSchema.parse({
    name: "Feedback list", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      search: { kind: "scalar", type: "string" },
      sourceType: { kind: "scalar", type: "string" },
      rating: { kind: "scalar", type: "string" },
      cursor: { kind: "scalar", type: "string" },
      size: { kind: "scalar", type: "number" },
    },
    outputs: {},
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } },
        read: "query",
        params: {
          search: { input: "search" },
          sourceType: { input: "sourceType" },
          rating: { input: "rating" },
          cursor: { input: "cursor" },
          size: { input: "size" },
        },
      },
    },
    operations: { export: { operation: { kind: "PlatformOperation", id: EXPORT_FEEDBACK } } },
  }),
  "proj-feedback-counts": productProjectionInputSchema.parse({
    name: "Feedback counts", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:SegmentedControl",
    inputs: {
      by: { kind: "scalar", type: "string" },
      search: { kind: "scalar", type: "string" },
      sourceType: { kind: "scalar", type: "string" },
      rating: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      counts: {
        source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } },
        read: "counts",
        params: {
          by: { input: "by" },
          search: { input: "search" },
          sourceType: { input: "sourceType" },
          rating: { input: "rating" },
        },
      },
    },
  }),
  "proj-feedback-detail": productProjectionInputSchema.parse({
    name: "Feedback detail", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { record: feedbackRefType },
    outputs: {},
    config: {},
    data: {
      record: { source: { object: { input: "record" } }, read: "record", params: {} },
    },
  }),
  "proj-skill-list": productProjectionInputSchema.parse({
    name: "Skill list", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      search: { kind: "scalar", type: "string" },
      cursor: { kind: "scalar", type: "string" },
      size: { kind: "scalar", type: "number" },
    },
    outputs: {},
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: SKILL } },
        read: "query",
        params: { search: { input: "search" }, cursor: { input: "cursor" }, size: { input: "size" } },
      },
    },
  }),
  "proj-skill-detail": productProjectionInputSchema.parse({
    name: "Skill detail", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:PanelData",
    inputs: { skill: skillRefType, path: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: {
      record: { source: { object: { input: "skill" } }, read: "record", params: {} },
      files: { source: { object: { input: "skill" } }, read: "files", params: {} },
      file: { source: { object: { input: "skill" } }, read: "file", params: { path: { input: "path" } } },
    },
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: DELETE_SKILL }, target: { input: "skill" } },
      export: { operation: { kind: "PlatformOperation", id: EXPORT_SKILL }, target: { input: "skill" } },
    },
  }),
};

const panel = productPanelInputSchema.parse({
  name: "M7 owner reads", description: "", visibility: "domain",
  content: {
    html: [
      '<div id="app" v-cloak>',
      '  <projection slot="feedbackCounts"></projection>',
      '  <projection slot="feedbackList"></projection>',
      '  <projection slot="feedbackDetail"></projection>',
      '  <projection slot="skillList"></projection>',
      '  <projection slot="skillDetail"></projection>',
      "</div>",
    ].join("\n"),
    module: [
      'import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";',
      "const Panel = { setup() { usePanelContext(); return {}; } };",
      "await mountPanel(Panel);",
    ].join("\n"),
  },
  manifest: {
    state: {
      selectedFeedback: { type: feedbackRefType, default: null },
      selectedSkill: { type: skillRefType, default: null },
    },
    members: {
      feedbackList: { target: { projectionId: "proj-feedback-list" } },
      feedbackCounts: { target: { projectionId: "proj-feedback-counts" } },
      feedbackDetail: { target: { projectionId: "proj-feedback-detail" }, inputs: { record: { state: "selectedFeedback" } } },
      skillList: { target: { projectionId: "proj-skill-list" } },
      skillDetail: { target: { projectionId: "proj-skill-detail" }, inputs: { skill: { state: "selectedSkill" } } },
    },
    commands: {},
  },
});

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      "zh-CN": {
        ...enLocaleMeta,
        messages: {
          ...en,
          "panels.feedback.all": "全部",
          "api.feedback.sources.qa": "问答",
          "api.feedback.sources.analysis_task": "分析任务",
          "api.feedback.ratings.like": "点赞",
          "api.feedback.ratings.dislike": "点踩",
          "panels.skill.delete": "删除",
          "panels.skill.readOnlyPublic": "内置技能随产品提供，不能删除",
          "panels.skill.readOnlyProvider": "由 {provider} 提供，不能在这里删除",
          "panels.confirmation.deleteSkillImpact": "此操作将删除所选技能，并清理 {count} 个智能体对它的引用。",
        } as typeof en,
      },
    },
  });

  state.schema = `panel_m7_owners_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensureAssistantSchema(state.pool);

  contentRoot = await mkdtemp(path.join(os.tmpdir(), "panel-m7-content-"));
  publicSkillsRoot = await mkdtemp(path.join(os.tmpdir(), "panel-m7-public-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot, prompts: [], runtimeResources: [] });

  await mkdir(path.join(publicSkillsRoot, "builtin-skill"), { recursive: true });
  await writeFile(
    path.join(publicSkillsRoot, "builtin-skill", "SKILL.md"),
    "---\nname: builtin-skill\ndescription: Platform built-in skill\n---\nBuilt-in\n",
  );

  const domainSkillDir = path.join(contentRoot, "data", "domain-skills", domainId, "custom-domain-skill");
  await mkdir(path.join(domainSkillDir, "scripts"), { recursive: true });
  await writeFile(
    path.join(domainSkillDir, "SKILL.md"),
    "---\nname: custom-domain-skill\ndescription: Custom domain helper\n---\nBody\n",
  );
  await writeFile(path.join(domainSkillDir, "scripts", "main.mjs"), "export const ok = true;\n");

  registerSkillProvider({
    id: "provider-m7",
    name: "M7 Provider",
    async list(context) {
      return [
        {
          skill: { namespace: { kind: "domain", domainId: context.domainId }, name: "provider-m7-skill" },
          manifest: { name: "provider-m7-skill", description: "Provider managed skill" },
          async provide() {
            return {
              skill: { namespace: { kind: "domain" as const, domainId: context.domainId }, name: "provider-m7-skill" },
              files: [{ path: "SKILL.md", content: "---\nname: provider-m7-skill\ndescription: Provider managed skill\n---\n" }],
            };
          },
        },
      ];
    },
  });

  // Seed PG feedback rows and referencing agents.
  const regularAgentId = randomUUID();
  const domainSkillRef = { namespace: { kind: "domain", domainId }, name: "custom-domain-skill" };
  await state.pool.query(
    `INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind, name, description, system_prompt, skills)
     VALUES ($1,$2,'regular','QA','QA','prompt','[]'::jsonb),
            ($3,$2,'analysis','Sales Analyst','Analyst','prompt',$4::jsonb),
            ($5,$2,'app-builder','Builder','Builder','prompt',$4::jsonb)`,
    [regularAgentId, domainId, agentIds.readable, JSON.stringify([domainSkillRef]), agentIds.appBuilder],
  );

  const qaSession = randomUUID();
  const taskSession = randomUUID();
  await state.pool.query(
    `INSERT INTO "${state.schema}".assistant_sessions (id, domain_id, owner_id, agent_id, title)
     VALUES ($1,$2,'owner-1',$3,'QA session'), ($4,$2,'owner-1',$5,'Analysis session')`,
    [qaSession, domainId, regularAgentId, taskSession, agentIds.readable],
  );
  await state.pool.query(
    `INSERT INTO "${state.schema}".assistant_turns (id, session_id, request_seq, input_hash, admitted, settled)
     VALUES ($1,$2,1,'h1',true,true), ($3,$2,2,'h2',true,true), ($4,$5,1,'h3',true,true)`,
    [runIds.qaLike, qaSession, runIds.qaDislike, runIds.taskLike, taskSession],
  );
  await state.pool.query(
    `INSERT INTO "${state.schema}".assistant_feedback (id, session_id, run_id, target_kind, target_id, rating, text, updated_at)
     VALUES ($1,$2,$3,'message',$4,'like','Great chart','2026-11-20T10:00:00Z'),
            ($5,$2,$6,'message',$7,'dislike','Slow chart','2026-11-20T09:00:00Z'),
            ($8,$9,$10,'message',$11,'like','Good summary','2026-11-20T08:00:00Z')`,
    [
      feedbackIds.qaLike, qaSession, runIds.qaLike, messageTargets.qaLike,
      feedbackIds.qaDislike, runIds.qaDislike, messageTargets.qaDislike,
      feedbackIds.taskLike, taskSession, runIds.taskLike, messageTargets.taskLike,
    ],
  );

  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { ensurePanelOperationsSchema } = await import("../../infrastructure/postgres-migrations/20261118-panel-operations/schema");
  await ensurePanelOperationsSchema(state.pool);

  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    resourceIds.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: req.header("tk") === "m7-reader" && resourceIds.has(req.body.id) });
  });
  app.post("/product-governance/resources", (_req, res) => {
    res.json({ ids: [...resourceIds] });
  });
  app.get("/platform/applications/resolve-entry", (_req, res) => {
    res.json({
      success: true,
      data: {
        applicationId: "app-m7",
        menu: { groups: [], panelUses: [] },
        use: { id: "owners", pageKey: "owners", path: "/owners", panelId, access: { kind: "domain-member" } },
      },
    });
  });
  app.get("/platform/page-skills", (_req, res) => {
    res.json({ success: true, data: { pageSkills: [], registeredSkills: [] } });
  });
  app.get("/v1/runs/:runId", (req, res) => {
    const runId = req.params.runId;
    const targetId = Object.entries(runIds).find(([, value]) => value === runId)?.[0];
    const msgId = targetId ? messageTargets[targetId as keyof typeof messageTargets] : randomUUID();
    res.json({
      run: {
        id: runId,
        sessionId: qaSession,
        domainId,
        status: "stopped",
        correlationId: "corr-1",
        language: "en",
        createdAt: "2026-11-20T08:00:00.000Z",
        finishedAt: "2026-11-20T08:00:01.000Z",
        stopReason: "stop",
        errorMessage: null,
        answerMessageId: msgId,
        workspaceCommit: null,
        resolvedSkills: [],
        environment: { values: {}, secretNames: [] },
        definition: {
          systemPrompt: "",
          modelId: null,
          skills: [],
          sandbox: { limits: {} },
          externalMcp: [],
          compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" },
        },
      },
      cursor: { runId, seq: 0, streamId: randomUUID() },
      messages: [
        {
          id: randomUUID(),
          runId,
          messageSeq: 1,
          contextSeq: 1,
          message: { role: "user", content: `Prompt for ${runId}`, timestamp: 1 },
        },
        {
          id: msgId,
          runId,
          messageSeq: 2,
          contextSeq: 2,
          message: {
            role: "assistant",
            content: [{ type: "text", text: `Answer for ${runId}` }],
            api: null,
            provider: null,
            model: null,
            usage: null,
            stopReason: "stop",
            timestamp: 2,
          },
        },
      ],
      pendingQuestions: [],
      pendingMessages: [],
      toolExecutions: [],
      artifacts: [],
    });
  });

  app.use("/api", (req, _res, next) => {
    const token = req.header("tk") ?? "m7-reader";
    Object.assign(req, { domainId, userId: "owner-1", token, locale: req.header("Accept-Language") ?? "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);

  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  if (state.pool) {
    await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
    await state.pool.end();
  }
  if (contentRoot) await rm(contentRoot, { recursive: true, force: true });
  if (publicSkillsRoot) await rm(publicSkillsRoot, { recursive: true, force: true });
});

function request(method: string, resource: string, body?: object, locale = "en", headers?: Record<string, string>) {
  return fetch(`${state.base}/api/${resource}`, {
    method,
    headers: { "Content-Type": "application/json", "Accept-Language": locale, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it("serves feedback, governance, and skill library reads plus skills.delete over HTTP backed by PG", async () => {
  for (const [id, definition] of Object.entries(projections)) {
    const res = await request("PUT", `product-projections/${id}`, { ...definition, revision: 0 });
    expect(res.status, await res.text()).toBe(200);
  }
  const panelRes = await request("PUT", `product-panels/${panelId}`, { ...panel, revision: 0 });
  expect(panelRes.status, await panelRes.text()).toBe(200);

  const source = { kind: "registered", applicationId: "app-m7", useId: "owners" };
  const read = async (member: string, dataName: string, inputs: object, locale = "en", headers?: Record<string, string>) => {
    const res = await request("POST", "product-panels/read", {
      source, memberPath: [{ member }], dataName, inputs,
    }, locale, headers);
    expect(res.status).toBe(200);
    return res.json();
  };

  // 1. FeedbackRecord reads backed by real PG assistant_feedback rows.
  const feedbackPage1 = await read("feedbackList", "rows", { search: "chart", sourceType: "all", rating: "all", size: 1 });
  expect(feedbackPage1).toMatchObject({
    status: "ready",
    value: {
      rows: [{ primaryKey: feedbackIds.qaLike, fields: { sourceType: "Query", rating: "Like" } }],
      nextCursor: "1",
      total: 2,
    },
  });
  const feedbackPage2 = await read("feedbackList", "rows", {
    search: "chart", cursor: "1", size: 1,
  }, "zh-CN");
  expect(feedbackPage2).toMatchObject({
    status: "ready",
    value: {
      rows: [{ primaryKey: feedbackIds.qaDislike, fields: { sourceType: "问答", rating: "点踩" } }],
      total: 2,
    },
  });
  expect(feedbackPage2.value.nextCursor).toBeUndefined();

  expect(await read("feedbackCounts", "counts", {
    by: "sourceType", search: "chart", sourceType: "analysis_task", rating: "like",
  }, "zh-CN")).toEqual({
    status: "ready",
    value: [
      { key: "all", label: "全部", count: 1 },
      { key: "qa", label: "问答", count: 1 },
      { key: "analysis_task", label: "分析任务", count: 0 },
    ],
  });
  expect(await read("feedbackCounts", "counts", {
    by: "rating", sourceType: "qa", rating: "like",
  })).toEqual({
    status: "ready",
    value: [
      { key: "all", label: "All", count: 2 },
      { key: "like", label: "Like", count: 1 },
      { key: "dislike", label: "Dislike", count: 1 },
    ],
  });

  const feedbackSingle = await read("feedbackDetail", "record", {
    record: { className: FEEDBACK_RECORD, primaryKey: feedbackIds.taskLike },
  });
  expect(feedbackSingle).toMatchObject({
    status: "ready",
    value: {
      primaryKey: feedbackIds.taskLike,
      fields: { sourceType: "Analysis task", rating: "Like", feedbackText: "Good summary" },
    },
  });
  expect(await read("feedbackDetail", "record", {
    record: { className: FEEDBACK_RECORD, primaryKey: "not-a-uuid" },
  })).toEqual({ status: "error", message: "Invalid feedback ID" });

  state.permissions.delete("user-feedback");
  expect(await read("feedbackList", "rows", {})).toEqual({ status: "forbidden" });
  state.permissions.add("user-feedback");

  const csvCall = {
    applicationId: source.applicationId, useId: source.useId, operationId: "feedbackList.export",
    call: { input: { search: "chart", sourceType: "qa", rating: "like", timeZone: "UTC" } },
  };
  const csv = await request("POST", "panel-operations/read", csvCall);
  expect(csv.status).toBe(200);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="feedback_records_.*\.csv"; filename\*=/u);
  expect(csv.headers.get("cache-control")).toBe("no-store");
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csvBytes.toString()).toContain("Great chart");
  expect(csvBytes.toString()).not.toContain("Slow chart");
  expect(csvBytes.toString()).not.toContain("Good summary");

  state.permissions.delete("user-feedback");
  try {
    const denied = await request("POST", "panel-operations/read", csvCall);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("content-disposition")).toBeNull();
    expect(await denied.json()).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  } finally {
    state.permissions.add("user-feedback");
  }

  // 2. Skill library reads (available without analysis-agent permission) and skills.delete operation.
  state.permissions.delete("analysis-agent");
  const skillPage = await read("skillList", "rows", { size: 2 });
  expect(skillPage).toMatchObject({
    status: "ready",
    value: { nextCursor: "2", total: 3 },
  });
  expect(skillPage.value.rows).toHaveLength(2);

  const publicSkillRef = { className: SKILL, primaryKey: "builtin-skill" };
  expect(await read("skillDetail", "record", { skill: publicSkillRef })).toMatchObject({
    status: "ready",
    value: {
      primaryKey: "builtin-skill",
      fields: {
        source: "Platform",
        writeRestriction: "Built-in skills come with the product and cannot be deleted",
      },
    },
  });

  const providerSkillRef = { className: SKILL, primaryKey: "provider-m7-skill" };
  expect(await read("skillDetail", "record", { skill: providerSkillRef })).toMatchObject({
    status: "ready",
    value: {
      primaryKey: "provider-m7-skill",
      fields: {
        source: "M7 Provider",
        writeRestriction: "Provided by M7 Provider and cannot be deleted here",
      },
    },
  });

  const domainSkillRef = { className: SKILL, primaryKey: "custom-domain-skill" };
  expect(await read("skillDetail", "files", { skill: domainSkillRef })).toMatchObject({
    status: "ready",
    value: [
      { primaryKey: "SKILL.md" },
      { primaryKey: "scripts/main.mjs" },
    ],
  });
  expect(await read("skillDetail", "file", { skill: domainSkillRef, path: "scripts/main.mjs" })).toEqual({
    status: "ready",
    value: {
      primaryKey: "scripts/main.mjs",
      label: "scripts/main.mjs",
      fieldLabels: { content: "Content" },
      fields: { content: "export const ok = true;\n" },
    },
  });
  state.permissions.add("analysis-agent");

  const opReadRes = await request("POST", "product-panels/read", {
    source,
    memberPath: [{ member: "skillDetail" }],
    operations: true,
    inputs: { skill: domainSkillRef },
  }, "zh-CN");
  expect(opReadRes.status).toBe(200);
  expect(productPanelOperationsReadResponseSchema.parse(await opReadRes.json())).toMatchObject({
    status: "ready",
    value: {
      delete: {
        kind: "action",
        handlerRef: DELETE_SKILL,
        effect: "write",
        batch: false,
        label: "删除",
        target: { source: "input", input: "skill" },
        inspectImpact: { handlerRef: `${DELETE_SKILL}.inspect-impact` },
      },
    },
  });

  const zipCall = {
    applicationId: source.applicationId, useId: source.useId, operationId: "skillDetail.export",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: domainSkillRef.primaryKey }, input: {} },
  };
  const zip = await request("POST", "panel-operations/read", zipCall);
  expect(zip.status).toBe(200);
  expect(zip.headers.get("content-type")).toBe("application/zip");
  expect(zip.headers.get("content-disposition")).toContain('attachment; filename="custom-domain-skill.zip"');
  expect(zip.headers.get("cache-control")).toBe("no-store");
  const archive = new AdmZip(Buffer.from(await zip.arrayBuffer()));
  expect(archive.readAsText("SKILL.md")).toContain("name: custom-domain-skill");
  expect(archive.readAsText("scripts/main.mjs")).toBe("export const ok = true;\n");
  const missingZip = await request("POST", "panel-operations/read", {
    ...zipCall, call: { ...zipCall.call, target: { ...zipCall.call.target, primaryKey: "missing-skill" } },
  });
  expect(missingZip.status).toBe(404);
  expect(missingZip.headers.get("content-disposition")).toBeNull();
  expect(await missingZip.json()).toMatchObject({ error: { code: "SKILL_NOT_FOUND" } });
  const writeAttempt = await request("POST", "panel-operations/intents", zipCall);
  expect(writeAttempt.status).toBe(422);
  expect(await writeAttempt.json()).toMatchObject({ error: { code: "OPERATION_WRITE_REQUIRED" } });

  const intents = await state.pool!.query(`SELECT id FROM "${state.schema}".panel_operation_intents`);
  expect(intents.rows).toEqual([]);

  // Refusals: missing permission, public package, provider package.
  state.permissions.delete("skill-management");
  const noPermIntent = await (await request("POST", "panel-operations/intents", {
    applicationId: "app-m7",
    useId: "owners",
    operationId: "skillDetail.delete",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: "custom-domain-skill" }, input: {} },
  })).json();
  expect(noPermIntent.confirmation).toEqual({
    kind: "impact",
    impact: {
      summary: "This deletes the selected skill and removes its references from 1 agent(s).",
      objects: [{ target: { objectType: AGENT_DEFINITION, primaryKey: agentIds.readable }, label: "Sales Analyst" }],
      total: 1,
    },
  });
  expect(await (await request("POST", `panel-operations/intents/${noPermIntent.intentId}/dispatch`, {})).json()).toMatchObject({
    kind: "dispatched",
    outcome: { kind: "refusal", code: "PERMISSION_DENIED" },
  });
  state.permissions.add("skill-management");

  const publicIntent = await (await request("POST", "panel-operations/intents", {
    applicationId: "app-m7",
    useId: "owners",
    operationId: "skillDetail.delete",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: "builtin-skill" }, input: {} },
  }, "zh-CN")).json();
  expect(await (await request("POST", `panel-operations/intents/${publicIntent.intentId}/dispatch`, {}, "zh-CN")).json()).toMatchObject({
    kind: "dispatched",
    outcome: {
      kind: "refusal",
      code: "PUBLIC_SKILL_READ_ONLY",
      message: "内置技能随产品提供，不能删除",
    },
  });

  const providerIntent = await (await request("POST", "panel-operations/intents", {
    applicationId: "app-m7",
    useId: "owners",
    operationId: "skillDetail.delete",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: "provider-m7-skill" }, input: {} },
  }, "zh-CN")).json();
  expect(await (await request("POST", `panel-operations/intents/${providerIntent.intentId}/dispatch`, {}, "zh-CN")).json()).toMatchObject({
    kind: "dispatched",
    outcome: {
      kind: "refusal",
      code: "SKILL_PROVIDER_READ_ONLY",
      message: "由 M7 Provider 提供，不能在这里删除",
    },
  });

  // Successful delete removes disk directory and cleans referencing agent skills in real PG.
  const deleteIntent = await (await request("POST", "panel-operations/intents", {
    applicationId: "app-m7",
    useId: "owners",
    operationId: "skillDetail.delete",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: "custom-domain-skill" }, input: {} },
  })).json();
  const deleteDispatch = await (await request("POST", `panel-operations/intents/${deleteIntent.intentId}/dispatch`, {})).json();
  expect(deleteDispatch).toEqual({
    kind: "dispatched",
    intentId: deleteIntent.intentId,
    outcome: {
      kind: "success",
      data: {},
      affected: {
        objects: [
          { objectType: SKILL, primaryKey: "custom-domain-skill" },
          { objectType: AGENT_DEFINITION, primaryKey: agentIds.readable },
        ],
        objectTypes: [SKILL, AGENT_DEFINITION],
      },
    },
  });
  await expect(stat(path.join(contentRoot, "data", "domain-skills", domainId, "custom-domain-skill"))).rejects.toThrow();
  const agentRows = await state.pool!.query<{ id: string; skills: unknown[] }>(
    `SELECT id, skills FROM "${state.schema}".assistant_agents WHERE id=$1`,
    [agentIds.readable],
  );
  expect(agentRows.rows[0]?.skills).toEqual([]);
});
