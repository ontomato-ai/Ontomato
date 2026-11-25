import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAgentDefinition, RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { HarnessTurnHost } from "../adapters/contract";
import {
  bindPlatformTools,
  declarePlatformTools,
  type PlatformTool,
  registerSkillCallbackRoutes,
  usesEngineTools,
} from "../platform-tools";
import { RuntimeError } from "../errors";

function baseDefinition(overrides: Partial<RuntimeAgentDefinition> = {}): RuntimeAgentDefinition {
  return {
    systemPrompt: "Be helpful",
    modelId: null,
    skills: [],
    sandbox: {
      limits: {
        memoryBytes: 1_000_000_000,
        wallTimeMs: 60_000,
        cpuSeconds: 60,
        processCount: 64,
        fileBytes: 10_000_000,
        outputBytes: 1_000_000,
      },
    },
    externalMcp: [],
    toolSurface: "standard",
    productTools: [],
    ...overrides,
  };
}

function baseRequest(definition: RuntimeAgentDefinition): RuntimeStartRunRequest {
  return {
    language: "en",
    definition,
    input: { role: "user", content: "hi", timestamp: 1 },
    businessCallbacks: { product: { owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL("http://workbench.test/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools").pathname, baseUrl: "http://workbench.test/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools", credential: "wbc1.prod-secret" } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("declarePlatformTools", () => {
  it("assembles session-open declarations once with engineTools=true for standard surfaces", () => {
    const surface = declarePlatformTools({
      definition: baseDefinition({
        productTools: [
          {
            name: "list_orders",
            description: "List orders",
            inputSchema: { type: "object", properties: { limit: { type: "number" } } },
            path: "/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools/list",
          },
        ],
      }),
      mcpTools: [
        {
          name: "erp_lookup",
          description: "Lookup ERP",
          parameters: { type: "object", properties: { id: { type: "string" } } },
        },
      ],
      hasChannel: true,
      hasPresentation: true,
    });

    expect(surface.engineTools).toBe(true);
    expect(surface.tools.map((tool) => tool.name)).toEqual([
      "erp_lookup",
      "list_orders",
      "agent",
      "present",
      "observe_display",
      "fill_form",
      "page_action",
    ]);
    // Pure JSON declarations without TypeBox/PI symbols.
    for (const declaration of surface.tools) {
      expect(Object.getOwnPropertySymbols(declaration.parameters)).toEqual([]);
    }
  });

  it("disables engine and MCP tools on product surfaces while allowing product tools named like built-ins", () => {
    const productDef = baseDefinition({
      toolSurface: "product",
      productTools: [
        {
          name: "read",
          description: "Domain read",
          inputSchema: { type: "object" },
          path: "/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools/read",
        },
      ],
    });
    expect(usesEngineTools(productDef)).toBe(false);

    const surface = declarePlatformTools({
      definition: productDef,
      mcpTools: [{ name: "ignored_mcp", description: "Should be ignored", parameters: { type: "object" } }],
      hasChannel: false,
      hasPresentation: true,
    });

    expect(surface.engineTools).toBe(false);
    expect(surface.tools.map((tool) => tool.name)).toEqual([
      "read",
      "present",
      "observe_display",
      "fill_form",
      "page_action",
    ]);
  });

  it("rejects duplicate platform tool names and collisions with built-in engine tools", () => {
    expect(() =>
      declarePlatformTools({
        definition: baseDefinition({
          productTools: [
            {
              name: "bash",
              description: "Collides with engine bash",
              inputSchema: { type: "object" },
              path: "/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools/bash",
            },
          ],
        }),
        hasChannel: false,
        hasPresentation: false,
      }),
    ).toThrow("Exposed tool names must be unique");

    expect(() =>
      declarePlatformTools({
        definition: baseDefinition({
          productTools: [
            {
              name: "dup",
              description: "First",
              inputSchema: { type: "object" },
              path: "/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools/a",
            },
            {
              name: "dup",
              description: "Second",
              inputSchema: { type: "object" },
              path: "/api/product-assets/orders/releases/12345678-1234-4234-8234-123456789012/tools/b",
            },
          ],
        }),
        hasChannel: false,
        hasPresentation: false,
      }),
    ).toThrow("Exposed tool names must be unique");
  });
});

describe("bindPlatformTools", () => {
  it("matches HarnessTurnHost.invokeTool, enforces per-run authorization, validates args, forwards progress, and rejects on abort", async () => {
    let releaseStarted!: () => void;
    const startedInFlight = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const customMcpTool: PlatformTool = {
      declaration: {
        name: "mcp_step",
        description: "Runs an MCP step",
        parameters: {
          type: "object",
          required: ["count"],
          properties: { count: { type: "number" } },
          additionalProperties: false,
        },
      },
      label: "MCP Step",
      async execute(call) {
        call.onUpdate?.({ text: "working", data: { pct: 50 } });
        if (call.args.count === 999) {
          releaseStarted();
          return await new Promise((_, reject) => {
            call.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        if (call.args.count === 500) {
          throw new Error("downstream unavailable");
        }
        return {
          result: { content: [{ type: "text", text: `ok:${call.args.count}` }], details: {} },
          isError: false,
        };
      },
    };

    const authorize = vi.fn(async (call) => {
      if (call.args.count === 403) {
        throw new RuntimeError(403, "FORBIDDEN", "Not allowed for this record");
      }
    });
    const onClose = vi.fn(async () => {});

    const bound = bindPlatformTools({
      runId: "run-1",
      request: baseRequest(baseDefinition()),
      mcpTools: [customMcpTool],
      authorize,
      onClose,
    });
    const invokeTool: HarnessTurnHost["invokeTool"] = bound.invoke;

    // Unknown/revoked tool from an earlier session definition is rejected at invocation time.
    const unauthorizedTool = await invokeTool({
      toolCallId: "tc-0",
      toolName: "stale_tool_from_v1",
      args: {},
      signal: new AbortController().signal,
      onUpdate: () => {},
    });
    expect(unauthorizedTool.isError).toBe(true);
    expect(unauthorizedTool.result.content[0]).toEqual({
      type: "text",
      text: 'Tool "stale_tool_from_v1" is not available or not authorized for this run',
    });

    // Runtime invocation-time authorize hook rejects forbidden call before execution.
    const denied = await invokeTool({
      toolCallId: "tc-1",
      toolName: "mcp_step",
      args: { count: 403 },
      signal: new AbortController().signal,
      onUpdate: () => {},
    });
    expect(denied.isError).toBe(true);
    expect((denied.result.content[0] as { text: string }).text).toContain("Not allowed for this record");

    // Invalid schema arguments fail validation without calling tool.execute.
    const invalid = await invokeTool({
      toolCallId: "tc-2",
      toolName: "mcp_step",
      args: { count: "bad" },
      signal: new AbortController().signal,
      onUpdate: () => {},
    });
    expect(invalid.isError).toBe(true);
    expect((invalid.result.content[0] as { text: string }).text).toContain('Validation failed for tool "mcp_step"');

    // Valid call forwards progress updates and returns HarnessToolCallResult.
    const updates: unknown[] = [];
    const ok = await invokeTool({
      toolCallId: "tc-3",
      toolName: "mcp_step",
      args: { count: 7 },
      signal: new AbortController().signal,
      onUpdate: (partial) => updates.push(partial),
    });
    expect(updates).toEqual([{ text: "working", data: { pct: 50 } }]);
    expect(ok).toEqual({
      result: { content: [{ type: "text", text: "ok:7" }], details: {} },
      isError: false,
    });

    // Non-aborted execution error turns into settled isError tool result.
    const failed = await invokeTool({
      toolCallId: "tc-4",
      toolName: "mcp_step",
      args: { count: 500 },
      signal: new AbortController().signal,
      onUpdate: () => {},
    });
    expect(failed.isError).toBe(true);
    expect((failed.result.content[0] as { text: string }).text).toBe("downstream unavailable");

    // Aborted call rejects instead of returning a settled tool result.
    const controller = new AbortController();
    const pending = invokeTool({
      toolCallId: "tc-5",
      toolName: "mcp_step",
      args: { count: 999 },
      signal: controller.signal,
      onUpdate: () => {},
    });
    await startedInFlight;
    controller.abort(new Error("User interrupted"));
    await expect(pending).rejects.toThrow("aborted");

    await bound.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("excludes MCP tools from bound run when toolSurface is product", async () => {
    const mcpTool: PlatformTool = {
      declaration: { name: "mcp_only", description: "MCP", parameters: { type: "object" } },
      label: "MCP",
      execute: vi.fn(),
    };
    const bound = bindPlatformTools({
      runId: "run-2",
      request: baseRequest(baseDefinition({ toolSurface: "product" })),
      mcpTools: [mcpTool],
    });
    expect(bound.engineTools).toBe(false);
    expect(bound.declarations).toEqual([]);
    const res = await bound.invoke({
      toolCallId: "tc-1",
      toolName: "mcp_only",
      args: {},
      signal: new AbortController().signal,
      onUpdate: () => {},
    });
    expect(res.isError).toBe(true);
    expect(mcpTool.execute).not.toHaveBeenCalled();
  });

  it("throws if a declared tool has no matching implementation", () => {
    const misnamedChannelTool: PlatformTool = {
      declaration: { name: "not_agent", description: "Wrong name", parameters: { type: "object" } },
      label: "Wrong",
      execute: vi.fn(),
    };
    expect(() =>
      bindPlatformTools({
        runId: "run-3",
        request: baseRequest(baseDefinition()),
        channelTool: misnamedChannelTool,
      }),
    ).toThrow('Missing platform tool implementation for "agent"');
  });
});

describe("registerSkillCallbackRoutes", () => {
  it("mounts only the session-scoped skill command callback route", async () => {
    const sessionChannelCommand = vi.fn(async () => ({ agents: [] }));
    const app = express();
    app.use(express.json());
    registerSkillCallbackRoutes(app, { sessionChannelCommand });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const sessionId = "11111111-1111-4111-8111-111111111111";

    try {
      const ok = await fetch(
        `${baseUrl}/v1/channel/hosts/test-host/domains/a/sessions/${sessionId}/commands`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ontomato-Callback-Credential": "secret-1",
            "X-Ontomato-Session-Id": sessionId,
          },
          body: JSON.stringify({ op: "list" }),
        },
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ agents: [] });
      expect(sessionChannelCommand).toHaveBeenCalledWith(
        { hostId: "test-host", domainId: "a" },
        sessionId,
        "secret-1",
        undefined,
        { op: "list" },
      );

      for (const forbiddenPath of [
        "/v1/channel/commands",
        "/v1/sessions",
        "/v1/models/settings",
        "/v1/mcp/services",
      ]) {
        const blocked = await fetch(`${baseUrl}${forbiddenPath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        expect(blocked.status).toBe(404);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
