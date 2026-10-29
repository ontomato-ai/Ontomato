import { z } from "zod";
import { nodeApiGet, nodeApiPost, nodeApiPut, nodeApiDelete } from "../../utils/api";
import {
  mcpServiceOptionsSchema, mcpServiceListSchema, mcpServiceToolsSchema,
  type McpServiceView, type McpServiceWrite,
} from "@ontomato/contracts/agent-runtime-mcp";
import { mcpToolDescSchema as toolSchema } from "@ontomato/contracts/mcp";
const publishedServiceSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  mcpUrl: z.string(),
  tools: z.array(toolSchema),
});
export type { McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";
export type McpTool = z.infer<typeof toolSchema>;
export type PublishedMcpService = z.infer<typeof publishedServiceSchema>;

const base = "/mcp/services";
export async function listMcpServiceOptions() {
  return mcpServiceOptionsSchema.parse(await nodeApiGet(`${base}/names`));
}
export async function listMcpServices(): Promise<McpServiceView[]> {
  return mcpServiceListSchema.parse(await nodeApiGet(base)).services;
}
export async function saveMcpService(
  config: McpServiceWrite,
  id?: string
): Promise<void> {
  const result =
    id === undefined
      ? await nodeApiPost(base, config)
      : await nodeApiPut(`${base}/${encodeURIComponent(id)}`, config);
  z.object({ success: z.literal(true) }).parse(result);
}
export async function deleteMcpService(id: string): Promise<void> {
  z.object({ success: z.literal(true) }).parse(
    await nodeApiDelete(`${base}/${encodeURIComponent(id)}`)
  );
}
export async function listExternalMcpTools(id: string): Promise<McpTool[]> {
  return mcpServiceToolsSchema.parse(await nodeApiGet(`${base}/${encodeURIComponent(id)}/tools`)).tools;
}
export async function listPublishedMcpServices(): Promise<PublishedMcpService[]> {
  return z
    .object({ services: z.array(publishedServiceSchema) })
    .parse(await nodeApiGet("/mcp/system/tools")).services;
}
