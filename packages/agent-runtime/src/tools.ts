import { logHeaders } from "@ontomato/service-logging";
import { runtimeLogger } from "./logging";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { TSchema } from "typebox";
import type { AgentTool } from "./core/pi/types";
export interface McpConnection {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
}
async function openMcp(
  config: McpConnection,
  correlationId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const client = new Client({ name: "ontomato-agent-runtime", version: "1" });
  const fetchWithHeaders: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(config.headers))
      headers.set(name, value);
    for (const [name, value] of Object.entries(logHeaders())) headers.set(name, value);
    headers.set("X-Correlation-Id", correlationId);
    const started = performance.now();
    let outcome = "failure";
    try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
    outcome = response.ok ? "success" : "failure";
    return response;
    } finally {
      runtimeLogger.info("MCP call completed", { kind: "downstream", target: `mcp:${config.id}`, durationMs: Math.floor(performance.now() - started), outcome: signal.aborted ? "cancelled" : outcome });
    }
  };
  try {
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          fetch: fetchWithHeaders,
        }),
      );
    } catch (error) {
      if (
        signal.aborted ||
        !(error instanceof StreamableHTTPError) ||
        ![400, 404, 405].includes(error.code ?? 0)
      )
        throw error;
      // Transport negotiation happens only during initialization, before any tool action.
      await client.close();
      signal.throwIfAborted();
      await client.connect(
        new SSEClientTransport(new URL(config.url), {
          fetch: fetchWithHeaders,
        }),
      );
    }
    const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
    let cursor: string | undefined;
    do {
      signal.throwIfAborted();
      const page = await client.listTools({ cursor }, { signal });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return { client, tools };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
export async function discoverMcp(
  config: McpConnection,
  correlationId: string,
  signal: AbortSignal,
) {
  const { client, tools } = await openMcp(config, correlationId, signal);
  try {
    return tools;
  } finally {
    await client.close();
  }
}

/** Connections are already resolved within the run's host/domain scope. */
export async function connectMcp(
  configs: McpConnection[],
  correlationId: string,
  signal: AbortSignal,
) {
  const clients: Client[] = [];
  const tools: AgentTool[] = [];
  try {
    for (const config of configs) {
      const { client, tools: discovered } = await openMcp(
        config,
        correlationId,
        signal,
      );
      clients.push(client);
      for (const tool of discovered)
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
                        p.type === "text" ? String(p.text) : JSON.stringify(p),
                    },
              ),
              details: {},
              isError: Boolean(response.isError),
            };
          },
        });
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
