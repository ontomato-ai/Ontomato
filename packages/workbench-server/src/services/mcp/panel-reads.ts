import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { workbenchProduct } from "../../product/installed";
import { publishedMcpCatalogue, type McpRequestLocation } from "./catalog";

export async function readPublishedMcpServices(viewer: AssistantCredentials, location?: McpRequestLocation): Promise<PanelRecord[]> {
  await assertPermission(viewer, ["mcp-service"]);
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  const { services } = await publishedMcpCatalogue(location, viewer.locale);
  const product = workbenchProduct();
  return services.map(({ name, title, mcpUrl, tools }) => ({
    primaryKey: name, label: title,
    subtitle: text(name === product.opsMcpServerName ? "opsMcpAuth" : "analysisMcpAuth"),
    fields: { mcpUrl, status: text("published"), toolCount: String(tools.length), tools: JSON.stringify(tools) },
    fieldLabels: { mcpUrl: text("mcpUrl"), status: text("status"), toolCount: text("availableTools"), tools: text("availableTools") },
    tones: { status: "success" },
  }));
}
