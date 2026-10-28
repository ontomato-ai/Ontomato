import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { TSchema } from "typebox";
import type { AgentTool } from "./core/pi/types";
export interface McpConnection {
  id: string;
  url: string;
  transport: "sse" | "streamable-http";
  headers?: Record<string, string>;
  hosts: string[];
}
/** Configured external MCP clients are lower-level tools, not runtime hosts or business handlers. */
export async function connectMcp(
  configs: McpConnection[],
  ids: string[],
  hostId: string,
  correlationId: string,
  signal: AbortSignal,
) {
  const clients: Client[] = [];
  const tools: AgentTool[] = [];
  try {
    for (const id of ids) {
      const config = configs.find(
        (c) => c.id === id && c.hosts.includes(hostId),
      );
      if (!config) throw new Error("MCP reference is not authorized");
      const client = new Client({
        name: "ontomato-agent-runtime",
        version: "1",
      });
      clients.push(client);
      const headers = { ...config.headers, "X-Correlation-Id": correlationId };
      await client.connect(
        config.transport === "sse"
          ? new SSEClientTransport(new URL(config.url), {
              requestInit: { headers },
            })
          : new StreamableHTTPClientTransport(new URL(config.url), {
              requestInit: { headers },
            }),
      );
      let cursor: string | undefined;
      do {
        signal.throwIfAborted();
        const page = await client.listTools({ cursor }, { signal });
        cursor = page.nextCursor;
        for (const tool of page.tools)
          tools.push({
            name: tool.name,
            label: tool.title ?? tool.name,
            description: tool.description ?? tool.name,
            parameters: tool.inputSchema as TSchema,
            async execute(_id, args, callSignal) {
              const response = await client.callTool(
                { name: tool.name, arguments: args as Record<string, unknown> },
                undefined,
                { signal: callSignal },
              );
              const parts = (
                "content" in response ? response.content : []
              ) as Array<Record<string, unknown>>;
              return {
                content: parts.map((p) =>
                  p.type === "image"
                    ? {
                        type: "image" as const,
                        data: String(p.data),
                        mimeType: String(p.mimeType),
                      }
                    : {
                        type: "text" as const,
                        text:
                          p.type === "text"
                            ? String(p.text)
                            : JSON.stringify(p),
                      },
                ),
                details: {},
                isError: Boolean(response.isError),
              };
            },
          });
      } while (cursor);
    }
    return {
      tools,
      close: async () => {
        await Promise.allSettled(clients.map((c) => c.close()));
      },
    };
  } catch (error) {
    await Promise.allSettled(clients.map((c) => c.close()));
    throw error;
  }
}
