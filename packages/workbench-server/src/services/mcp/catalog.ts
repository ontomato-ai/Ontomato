import { workbenchProduct } from "../../product/installed";
import type { SystemMcpTool, SystemMcpService, SystemMcpToolsResponse } from "@ontomato/contracts/mcp";
import type { McpToolDesc } from "@ontomato/contracts/mcp";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import { getAnalysisAgentMcpUrlOverride } from "../../config/mcp";
import { tForLocale } from "../../i18n";

const ANALYSIS_AGENT_MCP_SUFFIX = "/mcp/analysis-agents";
const OPS_AGENT_MCP_SUFFIX = "/mcp/ops-agent";

export type McpRequestLocation = { protocol: string; headers: Record<string, unknown> };

function toolToClient(t: McpToolDesc): SystemMcpTool {
  return {
    name: t.name,
    title: t.title || t.name,
    description: t.description || "",
    inputSchema: t.inputSchema,
  };
}

function getAnalysisAgentMcpUrl(req?: McpRequestLocation): string {
  const configured = getAnalysisAgentMcpUrlOverride();
  if (configured) return configured.replace(/\/$/, "");
  if (!req) return environment.publicBasePath() + ANALYSIS_AGENT_MCP_SUFFIX;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  // A gateway serving this service under a path prefix forwards it as X-Forwarded-Prefix.
  const forwardedPrefix = String(req.headers["x-forwarded-prefix"] || "")
    .split(",")[0]
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const apiBase = config.apiBase || "/api";
  const mountBase = forwardedPrefix
    ? `/${forwardedPrefix}`
    : apiBase.endsWith("/api")
      ? apiBase.slice(0, -4)
      : "";
  const path = `${mountBase}${ANALYSIS_AGENT_MCP_SUFFIX}`.replace(/\/+/g, "/");
  return host ? `${proto}://${host}${path}` : path;
}

function getOpsAgentMcpUrl(req?: McpRequestLocation): string {
  return `${analysisAgentPublicServiceRoot(req)}${OPS_AGENT_MCP_SUFFIX}`;
}

/** Strips the trailing `/mcp/analysis-agents` from the external MCP address to get the service root with the same mount prefix as `/api`. */
export function analysisAgentPublicServiceRoot(req?: McpRequestLocation): string {
  const mcpUrl = getAnalysisAgentMcpUrl(req);
  if (!mcpUrl.endsWith(ANALYSIS_AGENT_MCP_SUFFIX)) {
    throw new Error(`Analysis agent MCP URL must end with ${ANALYSIS_AGENT_MCP_SUFFIX}`);
  }
  return mcpUrl.slice(0, -ANALYSIS_AGENT_MCP_SUFFIX.length);
}

export function analysisReportPdfDownloadUrl(serviceRoot: string, taskId: string): string {
  return `${serviceRoot}/api/analysis-tasks/${encodeURIComponent(taskId)}/report/pdf`;
}

export async function publishedMcpCatalogue(req?: McpRequestLocation, locale?: string) {
  const [{ getAnalysisAgentMcpToolCatalog }, { getOpsAgentMcpToolCatalog }] = await Promise.all([
    import("../../api/routes/analysis-agent-mcp"), import("../../api/routes/ops-agent-mcp"),
  ]);
  const [analysisTools, opsTools] = await Promise.all([getAnalysisAgentMcpToolCatalog(), getOpsAgentMcpToolCatalog()]);
  return buildMcpSystemToolsResponse(req, analysisTools, opsTools, locale);
}

export async function buildMcpSystemToolsResponse(
  req: McpRequestLocation | undefined,
  analysisAgentMcpTools: McpToolDesc[],
  opsAgentMcpTools: McpToolDesc[],
  locale?: string,
): Promise<SystemMcpToolsResponse> {
  const analysisMcpUrl = getAnalysisAgentMcpUrl(req);
  const opsMcpUrl = getOpsAgentMcpUrl(req);
  const product = workbenchProduct();
  const services: SystemMcpService[] = [
    {
      name: product.analysisMcpServerName,
      title: tForLocale(locale, "mcp.catalog.analysisTitle"),
      mcpUrl: analysisMcpUrl,
      tools: analysisAgentMcpTools.map(toolToClient),
    },
    {
      name: product.opsMcpServerName,
      title: tForLocale(locale, "mcp.catalog.opsTitle"),
      mcpUrl: opsMcpUrl,
      tools: opsAgentMcpTools.map(toolToClient),
    },
  ];
  return {
    success: true,
    services,
  };
}
