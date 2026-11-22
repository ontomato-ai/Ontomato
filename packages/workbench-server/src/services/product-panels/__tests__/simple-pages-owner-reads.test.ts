import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" }, apiBase: "/api" } }));
vi.mock("../../../identity/installed", () => ({ assertPermission: vi.fn(async () => undefined) }));
vi.mock("../../../product/installed", () => ({
  workbenchProduct: () => ({ analysisMcpServerName: "analysis-agents", opsMcpServerName: "ops-agent" }),
}));
vi.mock("../../mcp/catalog", () => ({
  publishedMcpCatalogue: vi.fn(async () => ({
    success: true,
    services: [
      { name: "analysis-agents", title: "Raw Analysis MCP", mcpUrl: "http://example/mcp/analysis-agents", tools: [{ name: "list_agents", title: "List Agents", description: "", inputSchema: {} }] },
      { name: "ops-agent", title: "Raw Ops MCP", mcpUrl: "http://example/mcp/ops-agent", tools: [] },
    ],
  })),
}));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: vi.fn(async () => undefined) }));
const saveBuilderModelMock = vi.fn();
vi.mock("../../app-builder/agents", () => ({
  builderAgentName: { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }) },
  listBuilderAgents: vi.fn(async () => [
    { id: "11111111-1111-4111-8111-111111111111", name: "App builder", modelSelection: { modelId: null } },
    { id: "22222222-2222-4222-8222-222222222222", name: "Custom builder", modelSelection: { modelId: "api.deepseek.com/deepseek-flash" } },
  ]),
  readBuilderAgent: vi.fn(async (_owner: unknown, id: string) => ({
    id, name: "App builder", modelSelection: { modelId: "api.deepseek.com/deepseek-flash" },
  })),
  createBuilderAgent: vi.fn(),
  saveBuilderModel: saveBuilderModelMock,
}));
vi.mock("../../ops-diagnosis/model-settings", () => ({
  readDiagnosisModel: vi.fn(async () => ({ modelSelection: { modelId: null } })),
  saveDiagnosisModel: vi.fn(),
}));

import { tmpdir } from "node:os";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { BUILDER_AGENT } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";
import { HttpError } from "../../../utils/errors";

installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: true,
  appTextLocale: "en",
  packs: {
    en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta },
    "zh-CN": {
      messages: {
        ...en,
        ...appTextEn,
        "panels.simplePages.analysisMcpTitle": "智能体服务",
        "panels.simplePages.opsMcpTitle": "运维智能体服务",
        "panels.simplePages.auditBusinessKnowledge": "知识库",
        "panels.simplePages.auditOperationAdd": "添加",
        "panels.simplePages.auditOperationModify": "修改",
        "panels.simplePages.auditOperationDelete": "删除",
        "panels.simplePages.diagnosisAgent": "运维智能体",
        "panels.simplePages.diagnosisDescription": "依据日志与运行记录诊断问数和分析中的问题，并给出处理建议。",
        "panels.simplePages.defaultBuilderAgentName": "应用构建",
        "panels.simplePages.builderDescription": "应用设计、代码生成与发布对话",
        "panels.agentOptions.domainDefaultModel": "域默认（{model}）",
      },
      ...enLocaleMeta,
    },
  },
});

const { readPublishedMcpService, readPublishedMcpServices } = await import("../../mcp/panel-reads");
const { createAuditLogPanelReads } = await import("../../admin/audit-log-panel-reads");
const { BUILDER_MODELS_FORM_KEY, builderModelOperations, createBuilderModelReads } = await import("../../app-builder/panel-model");
const { createDiagnosisModelReads } = await import("../../ops-diagnosis/panel-model");

afterEach(() => {
  vi.unstubAllGlobals();
  saveBuilderModelMock.mockReset();
});

describe("simple pages owner reads", () => {
  it("returns localized titles for PublishedMcpService and supports single record lookup", async () => {
    const viewer = { token: "t", locale: "zh-CN" } as never;
    const rows = await readPublishedMcpServices(viewer);
    expect(rows.map(row => ({ key: row.primaryKey, label: row.label }))).toEqual([
      { key: "analysis-agents", label: "智能体服务" },
      { key: "ops-agent", label: "运维智能体服务" },
    ]);
    const single = await readPublishedMcpService(viewer, "ops-agent");
    expect(single.label).toBe("运维智能体服务");
    await expect(readPublishedMcpService(viewer, "missing")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("localizes AuditLog business and operation fields with tones and uses page-number pagination", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.pageNum === 5) {
        return Response.json({ data: [], totalRows: 3, totalPages: 2 });
      }
      return Response.json({
        data: [
          { id: "1", bussiness: "BKNOWLEDGE", operation: "ADD", description: "Added entry", userName: "admin", operateTime: 1700000000000 },
          { id: "2", bussiness: "SCHEMA", operation: "UPD", description: "Updated schema", userName: "admin", operateTime: 1700000001000 },
          { id: "3", bussiness: "CUSTOM_BIZ", operation: "DEL", description: "Removed item", userName: "admin", operateTime: 1700000002000 },
        ],
        totalRows: 3,
        totalPages: 2,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const reads = createAuditLogPanelReads({ token: "t", locale: "zh-CN" } as never);
    const page = await reads.query({ page: { number: 2, size: 20 } });
    expect(page).toEqual({
      rows: expect.arrayContaining([
        expect.objectContaining({ fields: expect.objectContaining({ business: "知识库", operation: "添加" }), tones: { business: "default", operation: "info" } }),
        expect.objectContaining({ fields: expect.objectContaining({ business: "Schema", operation: "修改" }), tones: { business: "default", operation: "warning" } }),
        expect.objectContaining({ fields: expect.objectContaining({ business: "CUSTOM_BIZ", operation: "删除" }), tones: { business: "default", operation: "danger" } }),
      ]),
      total: 3,
    });
    expect("nextCursor" in page).toBe(false);

    // Out-of-range page number falls back to the last available page, matching AuditLogPage.vue.
    const clamped = await reads.query({ page: { number: 5, size: 20 } });
    expect(clamped.rows).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("provides agent name, description and defaultValue on DiagnosisModel form field", async () => {
    const reads = createDiagnosisModelReads("d", { token: "t", locale: "zh-CN" } as never);
    const form = await reads.form(DIAGNOSIS_AGENT_ID, {});
    expect(form.fields).toEqual([
      expect.objectContaining({
        path: "/modelSelection/modelId",
        label: "运维智能体",
        help: "依据日志与运行记录诊断问数和分析中的问题，并给出处理建议。",
        defaultValue: null,
      }),
    ]);
  });

  it("localizes BuilderAgent list, exposes per-agent row form under 'all', and saves changed agents individually", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      data: {
        models: [{ ref: "api.deepseek.com/deepseek-flash", name: "dev-model", type: "chat" }],
        defaultModelId: "api.deepseek.com/deepseek-flash",
        embeddingModelId: null,
      },
    })));
    const owner = { domainId: "d", userId: "u" };
    const viewer = { token: "t", locale: "zh-CN" } as never;
    const reads = createBuilderModelReads(owner, viewer);
    const rows = await reads.list();
    expect(rows).toEqual([
      expect.objectContaining({
        label: "应用构建",
        subtitle: "应用设计、代码生成与发布对话",
        fields: { name: "应用构建", modelId: "域默认（dev-model (api.deepseek.com/deepseek-flash)）" },
      }),
      expect.objectContaining({
        label: "Custom builder",
        fields: { name: "Custom builder", modelId: "dev-model (api.deepseek.com/deepseek-flash)" },
      }),
    ]);

    const batchForm = await reads.form(BUILDER_MODELS_FORM_KEY, {});
    expect(batchForm.fields.map(field => ({ path: field.path, label: field.label, help: field.help, defaultValue: field.defaultValue }))).toEqual([
      { path: "/11111111-1111-4111-8111-111111111111", label: "应用构建", help: "应用设计、代码生成与发布对话", defaultValue: "@default" },
      { path: "/22222222-2222-4222-8222-222222222222", label: "Custom builder", help: "应用设计、代码生成与发布对话", defaultValue: "@default" },
    ]);
    expect(batchForm.values).toEqual({
      "11111111-1111-4111-8111-111111111111": "@default",
      "22222222-2222-4222-8222-222222222222": "api.deepseek.com/deepseek-flash",
    });

    const invalidDraft = await reads.form(BUILDER_MODELS_FORM_KEY, {
      values: { "11111111-1111-4111-8111-111111111111": "missing/model" },
    });
    expect(invalidDraft.errors).toEqual([
      expect.objectContaining({ field: "/11111111-1111-4111-8111-111111111111", code: "invalid_option" }),
    ]);

    // Partial save: agent 1 succeeds, agent 2 fails with 400; savedFields records agent 1 while errors reports agent 2.
    saveBuilderModelMock.mockImplementation(async (_owner: unknown, agentId: string) => {
      if (agentId === "22222222-2222-4222-8222-222222222222") throw new HttpError(400, "bad model", "INVALID_MODEL");
      return { modelSelection: { modelId: "api.deepseek.com/deepseek-flash" } };
    });
    const saveOp = builderModelOperations[0]!;
    const outcome = await saveOp.execute(
      { executor: { owner, credentials: viewer }, locale: "zh-CN" } as never,
      { kind: "object", objectType: BUILDER_AGENT, primaryKey: BUILDER_MODELS_FORM_KEY },
      {
        values: {
          "11111111-1111-4111-8111-111111111111": "api.deepseek.com/deepseek-flash",
          "22222222-2222-4222-8222-222222222222": "@default",
        },
        submittedFields: ["/11111111-1111-4111-8111-111111111111", "/22222222-2222-4222-8222-222222222222"],
      },
      "intent-1",
    );
    expect(outcome).toMatchObject({
      kind: "refusal",
      code: "BUILDER_MODELS_SAVE_FAILED",
      savedFields: { "/11111111-1111-4111-8111-111111111111": "api.deepseek.com/deepseek-flash" },
      errors: [expect.objectContaining({ field: "/22222222-2222-4222-8222-222222222222", code: "invalid_option" })],
    });
  });
});
