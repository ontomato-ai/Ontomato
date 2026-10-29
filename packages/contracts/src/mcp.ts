import { z } from "zod";

export const mcpToolDescSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
});
export type McpToolDesc = z.infer<typeof mcpToolDescSchema>;

export interface SystemMcpTool extends McpToolDesc {
  title: string;
  description: string;
}
export interface SystemMcpService {
  name: string;
  title: string;
  mcpUrl: string;
  tools: SystemMcpTool[];
}
export interface SystemMcpToolsResponse {
  success: true;
  mcpUrl: string;
  tools: SystemMcpTool[];
  services: SystemMcpService[];
}
export interface McpToolsResponse {
  tools: Omit<SystemMcpTool, "inputSchema">[];
}
