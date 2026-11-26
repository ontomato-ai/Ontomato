import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessTurnHost } from "../adapters/contract";
import {
  bindPlatformTools,
  declarePlatformTools,
  type PlatformTool,
  registerSkillCallbackRoutes,
} from "../platform-tools";
import { RuntimeError } from "../errors";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("declarePlatformTools", () => {
  it("assembles session-open declarations once with engineTools=true for standard surfaces", () => {
    const surface = declarePlatformTools({
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

  it("rejects duplicate platform tool names and collisions with built-in engine tools", () => {
    expect(() =>
      declarePlatformTools({
        mcpTools: [{ name: "bash", description: "Collides with engine bash", parameters: { type: "object" } }],
        hasChannel: false,
        hasPresentation: false,
      }),
    ).toThrow("Exposed tool names must be unique");

    expect(() =>
      declarePlatformTools({
        mcpTools: [
          { name: "dup", description: "First", parameters: { type: "object" } },
          { name: "dup", description: "Second", parameters: { type: "object" } },
        ],
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

  it("throws if a declared tool has no matching implementation", () => {
    const misnamedChannelTool: PlatformTool = {
      declaration: { name: "not_agent", description: "Wrong name", parameters: { type: "object" } },
      label: "Wrong",
      execute: vi.fn(),
    };
    expect(() =>
      bindPlatformTools({
        runId: "run-3",
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
