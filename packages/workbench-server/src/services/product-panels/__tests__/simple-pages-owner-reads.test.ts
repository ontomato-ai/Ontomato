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
  saveBuilderModel: vi.fn(),
}));

import { tmpdir } from "node:os";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";

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
const { createBuilderModelReads } = await import("../../app-builder/panel-model");

afterEach(() => { vi.unstubAllGlobals(); });

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

  it("localizes AuditLog business and operation fields with matching tones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: [
        { id: "1", bussiness: "BKNOWLEDGE", operation: "ADD", description: "Added entry", userName: "admin", operateTime: 1700000000000 },
        { id: "2", bussiness: "SCHEMA", operation: "UPD", description: "Updated schema", userName: "admin", operateTime: 1700000001000 },
        { id: "3", bussiness: "CUSTOM_BIZ", operation: "DEL", description: "Removed item", userName: "admin", operateTime: 1700000002000 },
      ],
      totalRows: 3,
      totalPages: 1,
    })));
    const reads = createAuditLogPanelReads({ token: "t", locale: "zh-CN" } as never);
    const page = await reads.query({});
    expect(page.rows.map(row => ({ business: row.fields.business, operation: row.fields.operation, tones: row.tones }))).toEqual([
      { business: "知识库", operation: "添加", tones: { business: "default", operation: "info" } },
      { business: "Schema", operation: "修改", tones: { business: "default", operation: "warning" } },
      { business: "CUSTOM_BIZ", operation: "删除", tones: { business: "default", operation: "danger" } },
    ]);
  });

  it("localizes default BuilderAgent name and formats model labels with full endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      data: {
        models: [{ ref: "api.deepseek.com/deepseek-flash", name: "dev-model", type: "chat" }],
        defaultModelId: "api.deepseek.com/deepseek-flash",
        embeddingModelId: null,
      },
    })));
    const reads = createBuilderModelReads({ domainId: "d", userId: "u" }, { token: "t", locale: "zh-CN" } as never);
    const rows = await reads.list();
    expect(rows).toEqual([
      expect.objectContaining({
        label: "应用构建",
        subtitle: "应用设计、代码生成与发布对话",
        fields: {
          name: "应用构建",
          modelId: "域默认（dev-model (api.deepseek.com/deepseek-flash)）",
        },
      }),
      expect.objectContaining({
        label: "Custom builder",
        fields: {
          name: "Custom builder",
          modelId: "dev-model (api.deepseek.com/deepseek-flash)",
        },
      }),
    ]);
  });
});
