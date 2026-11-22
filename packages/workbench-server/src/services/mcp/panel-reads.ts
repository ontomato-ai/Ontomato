import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { workbenchProduct } from "../../product/installed";
import { HttpError } from "../../utils/errors";
import { publishedMcpCatalogue, type McpRequestLocation } from "./catalog";

export async function readPublishedMcpServices(viewer: AssistantCredentials, location?: McpRequestLocation): Promise<PanelRecord[]> {
  await assertPermission(viewer, ["mcp-service"]);
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  const { services } = await publishedMcpCatalogue(location, viewer.locale);
  const product = workbenchProduct();
  return services.map(({ name, title, mcpUrl, tools }) => {
    const known = name === product.analysisMcpServerName
      ? { label: text("analysisMcpTitle"), subtitle: text("analysisMcpAuth") }
      : name === product.opsMcpServerName
        ? { label: text("opsMcpTitle"), subtitle: text("opsMcpAuth") }
        : null;
    return {
      primaryKey: name,
      label: known ? known.label : (title || name),
      ...(known && { subtitle: known.subtitle }),
      fields: { mcpUrl, status: text("published"), toolCount: String(tools.length), tools: JSON.stringify(tools) },
      fieldLabels: { mcpUrl: text("mcpUrl"), status: text("status"), toolCount: text("availableTools"), tools: text("availableTools") },
      tones: { status: "success" },
    };
  });
}

export async function readPublishedMcpService(
  viewer: AssistantCredentials, primaryKey: string, location?: McpRequestLocation,
): Promise<PanelRecord> {
  const service = (await readPublishedMcpServices(viewer, location)).find(row => row.primaryKey === primaryKey);
  if (!service) throw new HttpError(404, "Published MCP service not found", "NOT_FOUND");
  return service;
}

export async function readPublishedMcpServiceTools(
  viewer: AssistantCredentials, primaryKey: string, location?: McpRequestLocation,
): Promise<PanelRecord[]> {
  await assertPermission(viewer, ["mcp-service"]);
  const { services } = await publishedMcpCatalogue(location, viewer.locale);
  const service = services.find(item => item.name === primaryKey);
  if (!service) throw new HttpError(404, "Published MCP service not found", "NOT_FOUND");
  const fieldLabels = {
    name: tForLocale(viewer.locale, "panels.agentForm.name"),
    inputSchema: tForLocale(viewer.locale, "panels.simplePages.parameters"),
  };
  return service.tools.map(tool => ({
    primaryKey: tool.name,
    label: tool.title || tool.name,
    ...(tool.description ? { subtitle: tool.description } : {}),
    fields: {
      name: tool.name,
      ...(tool.inputSchema ? { inputSchema: JSON.stringify(tool.inputSchema, null, 2) } : {}),
    },
    fieldLabels,
  }));
}
