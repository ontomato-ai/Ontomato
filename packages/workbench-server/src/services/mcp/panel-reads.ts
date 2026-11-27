import { z } from "zod";
import { PUBLISHED_MCP_SERVICE } from "@ontomato/contracts/platform-object-types";
import type { McpToolDesc } from "@ontomato/contracts/mcp";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import type { ProductOwner } from "../product-governance/service-authentication";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { workbenchProduct } from "../../product/installed";
import { HttpError } from "../../utils/errors";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import type { RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { publishedMcpCatalogue, type McpRequestLocation } from "./catalog";

/** Converts one MCP tool descriptor into a panel record row for `tools` reads. */
export function mcpToolToPanelRecord(tool: McpToolDesc, locale?: string): PanelRecord {
  const text = (key: string) => tForLocale(locale, `panels.mcpTools.${key}`);
  const inputSchema = tool.inputSchema !== undefined && tool.inputSchema !== null
    ? JSON.stringify(tool.inputSchema, null, 2)
    : "";
  return {
    primaryKey: tool.name,
    label: tool.title || tool.name,
    ...(tool.title && tool.title !== tool.name ? { subtitle: tool.name } : {}),
    fields: {
      name: tool.name,
      description: tool.description ?? "",
      inputSchema,
    },
    fieldLabels: {
      name: text("name"),
      description: text("description"),
      inputSchema: text("inputSchema"),
    },
  };
}

function publishedMcpReads(
  locale: string | undefined, location: McpRequestLocation | undefined, requireAccess: () => void | Promise<void>,
) {
  async function catalogue() {
    await requireAccess();
    return (await publishedMcpCatalogue(location, locale)).services;
  }

  async function list(): Promise<PanelRecord[]> {
    const text = (key: string) => tForLocale(locale, `panels.simplePages.${key}`);
    const services = await catalogue();
    const product = workbenchProduct();
    return services.map(({ name, title, mcpUrl, tools }) => {
      const known = name === product.analysisMcpServerName
        ? { label: text("analysisMcpTitle"), authHint: text("analysisMcpAuth") }
        : name === product.opsMcpServerName
          ? { label: text("opsMcpTitle"), authHint: text("opsMcpAuth") }
          : null;
      return {
        primaryKey: name,
        label: known ? known.label : (title || name),
        ...(known && { subtitle: known.authHint }),
        fields: {
          mcpUrl,
          status: text("published"),
          toolCount: String(tools.length),
          ...(known && { authHint: known.authHint }),
        },
        fieldLabels: {
          mcpUrl: text("mcpUrl"),
          status: text("status"),
          toolCount: text("availableTools"),
          ...(known && { authHint: text("authHint") }),
        },
        tones: { status: "success" },
      };
    });
  }

  return {
    list,
    async record(primaryKey: string): Promise<PanelRecord> {
      const service = (await list()).find(row => row.primaryKey === primaryKey);
      if (!service) throw new HttpError(404, "Published MCP service not found", "NOT_FOUND");
      return service;
    },
    async tools(primaryKey: string): Promise<PanelRecord[]> {
      const service = (await catalogue()).find(item => item.name === primaryKey);
      if (!service) throw new HttpError(404, "Published MCP service not found", "NOT_FOUND");
      return service.tools.map(tool => mcpToolToPanelRecord(tool, locale));
    },
  };
}

function publishedMcpReadsForViewer(owner: ProductOwner, viewer: AssistantCredentials, location?: McpRequestLocation) {
  return publishedMcpReads(viewer.locale, location, () =>
    assertManagement(workbenchManagement.publishedMcpRead, owner, viewer));
}

export function readPublishedMcpServices(owner: ProductOwner, viewer: AssistantCredentials, location?: McpRequestLocation) {
  return publishedMcpReadsForViewer(owner, viewer, location).list();
}

export function readPublishedMcpService(
  owner: ProductOwner, viewer: AssistantCredentials, primaryKey: string, location?: McpRequestLocation,
) {
  return publishedMcpReadsForViewer(owner, viewer, location).record(primaryKey);
}

export function readPublishedMcpServiceTools(
  owner: ProductOwner, viewer: AssistantCredentials, primaryKey: string, location?: McpRequestLocation,
) {
  return publishedMcpReadsForViewer(owner, viewer, location).tools(primaryKey);
}

export function preparePublishedMcpRead(selection: PanelReadSelection, locale?: string, location?: McpRequestLocation) {
  const { typeId, method, primaryKey } = selection;
  if (typeId !== PUBLISHED_MCP_SERVICE || (method !== "list" && method !== "record" && method !== "tools")) return;
  return {
    call: { type: typeId, name: method, parameters: {} },
    present(payload: unknown) {
      if (!location) throw new HttpError(500, "Published MCP reads require the server request location");
      const reads = publishedMcpReads(locale, location, () => {
        z.literal(workbenchManagement.publishedMcpRead.id).parse(payload);
      });
      return method === "list" ? reads.list() : reads[method](primaryKey!);
    },
  };
}

export const publishedMcpDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["list", "record", "tools"] as const).map(method => ({
    typeId: PUBLISHED_MCP_SERVICE, method,
    prepare: ({ selection, credentials, location }: Parameters<NonNullable<RegisteredDataReadRegistration["prepare"]>>[0]) => preparePublishedMcpRead(selection, credentials.locale, location),
  })),
];
