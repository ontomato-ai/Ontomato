import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { TSchema } from "typebox";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import type { AgentTool } from "./core/pi/types";

export interface McpConnection {
  id: string;
  url: string;
  transport: "sse" | "streamable-http";
  headers?: Record<string, string>;
  hosts: string[];
}
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: {},
});
/** File capabilities are confined to one run workspace, including symlink resolution. */
export function workspaceTools(root: string): AgentTool[] {
  async function file(relative: string, write = false) {
    runtimeRelativePathSchema.parse(relative);
    await mkdir(root, { recursive: true });
    const actualRoot = await realpath(root);
    const pieces = relative.split("/");
    let current = actualRoot;
    for (const [index, piece] of pieces.entries()) {
      const next = path.join(current, piece);
      try {
        await lstat(next);
        current = await realpath(next);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT" || !write)
          throw error;
        if (index < pieces.length - 1) await mkdir(next);
        current = next;
      }
      if (current !== actualRoot && !current.startsWith(actualRoot + path.sep))
        throw new Error("Workspace path escapes this run");
    }
    return current;
  }
  return [
    {
      name: "workspace_edit",
      label: "Edit workspace file",
      description: "Replace exactly one occurrence in a workspace UTF-8 file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string", minLength: 1 },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
      } as TSchema,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const a = args as { path: string; oldText: string; newText: string };
        const target = await file(a.path),
          text = await readFile(target, "utf8"),
          at = text.indexOf(a.oldText);
        if (
          !a.oldText ||
          at < 0 ||
          text.indexOf(a.oldText, at + a.oldText.length) >= 0
        )
          throw new Error("oldText must match exactly once");
        await writeFile(
          target,
          text.slice(0, at) + a.newText + text.slice(at + a.oldText.length),
          { signal },
        );
        return result({ edited: true });
      },
    },
    {
      name: "workspace_read",
      label: "Read workspace file",
      description:
        "Read a UTF-8 file in this run workspace. Continue at nextOffset to read its tail.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          maxChars: { type: "integer", minimum: 1, maximum: 20000 },
        },
        required: ["path"],
      } as TSchema,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const a = args as { path: string; offset?: number; maxChars?: number };
        const text = await readFile(await file(a.path), "utf8"),
          offset = a.offset ?? 0,
          end = Math.min(text.length, offset + (a.maxChars ?? 20000));
        return result({
          text: text.slice(offset, end),
          totalChars: text.length,
          nextOffset: end < text.length ? end : null,
        });
      },
    },
    {
      name: "workspace_write",
      label: "Write workspace file",
      description: "Replace a UTF-8 file in this run workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, text: { type: "string" } },
        required: ["path", "text"],
      } as TSchema,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const a = args as { path: string; text: string };
        await writeFile(await file(a.path, true), a.text, { signal });
        return result({ written: true });
      },
    },
    {
      name: "workspace_list",
      label: "List workspace",
      description:
        "List direct entries in this run workspace or a relative subdirectory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      } as TSchema,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        await mkdir(root, { recursive: true });
        const relative = (args as { path?: string }).path;
        const entries = await readdir(relative ? await file(relative) : root, {
          withFileTypes: true,
        });
        return result(
          entries.map((e) => ({ name: e.name, directory: e.isDirectory() })),
        );
      },
    },
  ];
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
