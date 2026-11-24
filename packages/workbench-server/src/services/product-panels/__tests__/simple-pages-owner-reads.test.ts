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
        "panels.agentOptions.domainDefaultModel": "域默认（{model}）",
      },
      ...enLocaleMeta,
    },
  },
});

const { readPublishedMcpService, readPublishedMcpServices } = await import("../../mcp/panel-reads");
const { createAuditLogPanelReads } = await import("../../admin/audit-log-panel-reads");

afterEach(() => {
  vi.unstubAllGlobals();
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
    const fetchMock = vi.fn(async (_url: string, init?: { body?: unknown }) => {
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
});
