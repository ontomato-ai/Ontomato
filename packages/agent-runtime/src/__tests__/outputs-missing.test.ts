import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema, type RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { RuntimeAgentEvent, RuntimeEventEnvelope, RuntimeToolResult } from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeMessage, RuntimeToolResultMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { HarnessPlugin } from "../adapters/contract";
import { ArtifactFiles } from "../files";
import { AgentRuntime } from "../runtime";
import type { Scope } from "../store";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const scope: Scope = { hostId: "host", domainId: "domain" };
const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const streamId = "33333333-3333-4333-8333-333333333333";

it("completes the run with a final reply when the model deletes workspace/outputs during execution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-missing-outputs-"));
  directories.push(root);
  const workspace = path.join(root, "session", "workspace");
  const outputs = path.join(workspace, "outputs");
  const state = path.join(root, "session", "native");
  await Promise.all([
    mkdir(outputs, { recursive: true }),
    mkdir(state, { recursive: true }),
  ]);

  const request = runtimeStartRunRequestSchema.parse({
    language: "en",
    definition: { systemPrompt: "", modelId: null, skills: [], externalMcp: [], sandbox: { limits: {} } },
    input: { role: "user", content: "How many object types are there?", timestamp: 1 },
  });
  const run: RuntimeRun = {
    id: runId,
    sessionId,
    domainId: scope.domainId,
    correlationId: runId,
    language: request.language,
    definition: request.definition,
    status: "running",
    createdAt: new Date(0).toISOString(),
    finishedAt: null,
    stopReason: null,
    errorMessage: null,
    answerMessageId: null,
    workspaceCommit: null,
    resolvedSkills: [],
    environment: { values: {}, secretNames: [] },
  };
  const active = {
    scope,
    run,
    controller: new AbortController(),
    done: Promise.resolve(),
    frames: [] as RuntimeEventEnvelope[],
    lostThrough: 0,
    streamId,
    nextSeq: 1,
    pending: new Map<string, RuntimeMessage>(),
    messageIds: new Map<string, string>(),
    turnToolResults: [] as RuntimeToolResultMessage[],
    toolResults: new Map<string, RuntimeToolResult>(),
    sentInputs: new Map<string, { message: RuntimeMessage; context: string | null }>(),
    inputPending: false,
    steering: new AbortController(),
    skillCommands: new Set<Promise<unknown>>(),
    businessCallbacks: undefined,
    turnIndex: -1,
    subscribers: new Set(),
    outputBaseline: new Map<string, string>(),
    toolCalls: 0,
    toolShapes: new Map<string, number>(),
    toolArgs: new Map<string, unknown>(),
    sealed: false,
  };

  const persisted: RuntimeEventEnvelope[] = [];
  const finish = vi.fn(async () => {});
  const store = {
    append: vi.fn(async (_scope: Scope, targetRunId: string, event: RuntimeAgentEvent, _internal: boolean, seq: number) => {
      const envelope: RuntimeEventEnvelope = {
        sessionId,
        cursor: { runId: targetRunId, seq, streamId },
        timestamp: new Date(0).toISOString(),
        event,
      };
      persisted.push(envelope);
      return envelope;
    }),
    run: async () => ({ run, seq: persisted.at(-1)?.cursor.seq ?? 0, streamId }),
    finish,
    events: async () => persisted,
  };

  const runtime = Object.assign(Object.create(AgentRuntime.prototype), {
    options: { hosts: [{ id: scope.hostId, token: "test-host-token" }], eventBufferSize: 32 },
    store,
    locks: new Map(),
    active: new Map(),
    waiters: new Map(),
    sessionRunSubscribers: new Map(),
    files: new ArtifactFiles(path.join(root, "artifacts")),
    mcp: { resolve: async () => [] },
    workspaces: { saveSession: async () => null },
    channel: {
      facts: { findIntent: async () => undefined },
      modelMessage: async (_domainId: string, message: RuntimeMessage) => message,
      nextLocked: async () => undefined,
      stopped: async () => {},
    },
    sessionEngines: {
      open: async () => ({
        sandbox: {
          hostWorkspace: workspace,
          hostState: state,
          directories: { workspace: "/workspace", state: "/native", skills: [] },
          gatewayBaseUrl: "http://127.0.0.1:0",
        },
        handle: {
          engineRef: "engine-ref",
          startTurn: async (turn: { host: { emit: (event: unknown) => Promise<void> } }) => {
            await turn.host.emit({ type: "turn_start" });
            await turn.host.emit({
              type: "message_start",
              nativeId: "m1",
              message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "call-rm", name: "bash", arguments: { command: "rmdir outputs" } }],
                api: null,
                provider: null,
                model: null,
                usage: null,
                stopReason: "toolUse",
                timestamp: 2,
              },
            });
            await turn.host.emit({
              type: "tool_execution_start",
              toolCallId: "call-rm",
              toolName: "bash",
              args: { command: "rmdir outputs" },
            });
            await rm(outputs, { recursive: true });
            await turn.host.emit({
              type: "tool_execution_end",
              toolCallId: "call-rm",
              toolName: "bash",
              isError: false,
              result: { content: [{ type: "text", text: "" }], details: {} },
            });
            await turn.host.emit({
              type: "message_end",
              nativeId: "m1",
              message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "call-rm", name: "bash", arguments: { command: "rmdir outputs" } }],
                api: null,
                provider: null,
                model: null,
                usage: null,
                stopReason: "toolUse",
                timestamp: 2,
              },
            });
            await turn.host.emit({
              type: "message_start",
              nativeId: "m2",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "There are 18 object types." }],
                api: null,
                provider: null,
                model: null,
                usage: null,
                stopReason: "stop",
                timestamp: 3,
              },
            });
            await turn.host.emit({
              type: "message_end",
              nativeId: "m2",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "There are 18 object types." }],
                api: null,
                provider: null,
                model: null,
                usage: null,
                stopReason: "stop",
                timestamp: 3,
              },
            });
            await turn.host.emit({ type: "turn_end" });
            return { stopReason: "stop", errorMessage: null, unsettledToolCalls: [] };
          },
        },
      }),
      beginRun: () => {},
      endRun: () => {},
      release: async () => {},
      idle: () => {},
    },
  });

  type Execute = (
    active: unknown,
    plugin: HarnessPlugin,
    config: undefined,
    openingInputId: string,
    request: unknown,
    skills: unknown[],
  ) => Promise<void>;
  const execute = (AgentRuntime.prototype as unknown as { execute: Execute }).execute;
  await execute.call(runtime, active, { id: "pi" } as HarnessPlugin, undefined, "input-1", request, []);

  expect(finish).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledWith(scope, runId, "stop", null, null, expect.any(Function));
  const toolEnd = persisted.find((entry) => entry.event.type === "tool_execution_end");
  expect(toolEnd?.event).toMatchObject({
    type: "tool_execution_end",
    toolCallId: "call-rm",
    outcome: "success",
  });
  const finalReply = persisted.find(
    (entry) =>
      entry.event.type === "message_end" &&
      entry.event.message.role === "assistant" &&
      entry.event.message.stopReason === "stop",
  );
  expect(finalReply?.event).toMatchObject({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "There are 18 object types." }],
    },
  });
});
