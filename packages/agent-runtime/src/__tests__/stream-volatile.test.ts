import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { runtimeStartRunRequestSchema, type RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type {
  RuntimeAgentEvent,
  RuntimeEventEnvelope,
  RuntimeStreamFrame,
  RuntimeToolResult,
} from "@ontomato/contracts/agent-runtime-events";
import type {
  RuntimeAssistantMessage,
  RuntimeMessage,
  RuntimeToolResultMessage,
} from "@ontomato/contracts/agent-runtime-messages";
import type { HarnessEvent } from "../adapters/contract";
import { createRuntimeHttp } from "../http";
import { AgentRuntime } from "../runtime";
import { canonical, type Scope } from "../store";

const scope: Scope = { hostId: "host", domainId: "domain" };
const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const streamId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const nativeId = "native-message";

const definition = runtimeStartRunRequestSchema.parse({
  language: "en",
  definition: { systemPrompt: "", modelId: null, skills: [], externalMcp: [], sandbox: { limits: {} } },
  input: { role: "user", content: "start", timestamp: 1 },
}).definition;
const run: RuntimeRun = {
  id: runId,
  sessionId,
  domainId: scope.domainId,
  correlationId: runId,
  language: "en",
  definition,
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

type Subscriber = (frame: RuntimeStreamFrame) => void;
interface ActiveFixture {
  scope: Scope;
  run: RuntimeRun;
  controller: AbortController;
  done: Promise<void>;
  frames: RuntimeEventEnvelope[];
  lostThrough: number;
  streamId: string;
  nextSeq: number;
  pending: Map<string, RuntimeMessage>;
  messageIds: Map<string, string>;
  turnToolResults: RuntimeToolResultMessage[];
  toolResults: Map<string, RuntimeToolResult>;
  sentInputs: Map<string, { message: RuntimeMessage; context: string | null }>;
  inputPending: boolean;
  steering: AbortController;
  skillCommands: Set<Promise<unknown>>;
  businessCallbacks: undefined;
  turnIndex: number;
  subscribers: Set<Subscriber>;
  outputBaseline: Map<string, string>;
  toolCalls: number;
  toolShapes: Map<string, number>;
  toolArgs: Map<string, unknown>;
  sealed: boolean;
}

function activeFixture(): ActiveFixture {
  const partial: RuntimeAssistantMessage = {
    role: "assistant",
    content: [],
    api: null,
    provider: null,
    model: null,
    usage: null,
    stopReason: "pending",
    timestamp: 1,
  };
  return {
    scope,
    run,
    controller: new AbortController(),
    done: Promise.resolve(),
    frames: [],
    lostThrough: 0,
    streamId,
    nextSeq: 3,
    pending: new Map([[messageId, partial]]),
    messageIds: new Map([[nativeId, messageId]]),
    turnToolResults: [],
    toolResults: new Map(),
    sentInputs: new Map(),
    inputPending: false,
    steering: new AbortController(),
    skillCommands: new Set(),
    businessCallbacks: undefined,
    turnIndex: 0,
    subscribers: new Set(),
    outputBaseline: new Map(),
    toolCalls: 0,
    toolShapes: new Map(),
    toolArgs: new Map(),
    sealed: false,
  };
}

function fixtureRuntime(store: unknown, active?: ActiveFixture): AgentRuntime {
  return Object.assign(Object.create(AgentRuntime.prototype), {
    options: {
      hosts: [{ id: scope.hostId, token: "test-host-token" }],
      eventBufferSize: 32,
    },
    store,
    locks: new Map(),
    active: new Map(active ? [[canonical([scope.hostId, scope.domainId, runId]), active]] : []),
    channel: { facts: { pendingQuestions: async () => [] } },
  }) as AgentRuntime;
}

type Receive = (
  this: unknown,
  active: ActiveFixture,
  event: HarnessEvent,
  beginTurn: (turn: number) => void,
) => Promise<void>;
const receive = (AgentRuntime.prototype as unknown as { receive: Receive }).receive;
type Settle = (
  this: unknown,
  active: ActiveFixture,
  reason: "stop",
  failure: string | null,
) => Promise<void>;
const settle = (AgentRuntime.prototype as unknown as { settle: Settle }).settle;
const beginTurn = () => {};

function envelope(event: RuntimeAgentEvent, sequence: number): RuntimeEventEnvelope {
  return {
    sessionId,
    cursor: { runId, seq: sequence, streamId },
    timestamp: new Date(0).toISOString(),
    event,
  };
}

async function receiveDelta(runtime: AgentRuntime, active: ActiveFixture, delta: string) {
  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
  }, beginTurn);
}

it("forwards streaming deltas from memory without store writes", async () => {
  const append = vi.fn();
  const runtime = fixtureRuntime({ append });
  const active = activeFixture();

  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  }, beginTurn);
  await receiveDelta(runtime, active, "he");
  await receive.call(runtime, active, {
    type: "tool_execution_update",
    toolCallId: "call_query",
    toolName: "query",
    args: { sql: "select 1" },
    partialResult: { text: "working" },
  }, beginTurn);

  expect(append).not.toHaveBeenCalled();
  expect(active.frames.map(frame => frame.cursor.seq)).toEqual([3, 4, 5]);
  expect(active.frames.map(frame => frame.event.type)).toEqual([
    "message_update",
    "message_update",
    "tool_execution_update",
  ]);
  const partial = active.pending.get(messageId);
  if (partial?.role !== "assistant") throw new Error("Missing assistant partial");
  expect(partial.content[0]).toEqual({ type: "text", text: "he" });
});

it("keeps persisted events monotonic after volatile positions", async () => {
  const append = vi.fn(async (...args: unknown[]) =>
    envelope(args[2] as RuntimeAgentEvent, args[4] as number),
  );
  const runtime = fixtureRuntime({ append });
  const active = activeFixture();

  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  }, beginTurn);
  await receive.call(runtime, active, {
    type: "message_end",
    nativeId,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: null,
      provider: null,
      model: null,
      usage: null,
      stopReason: "stop",
      timestamp: 2,
    },
  }, beginTurn);

  expect(append).toHaveBeenCalledTimes(1);
  expect(append.mock.calls[0]?.[4]).toBe(4);
  expect(active.frames.map(frame => frame.cursor.seq)).toEqual([3, 4]);
});

it("publishes settlement events after volatile positions", async () => {
  const active = activeFixture();
  const persisted: RuntimeEventEnvelope[] = [];
  const state = { run, seq: 2, streamId };
  const store = {
    run: async () => state,
    finish: async (...args: unknown[]) => {
      const nextSequence = args[5] as (() => number) | undefined;
      if (!nextSequence) throw new Error("Settlement did not receive the live sequence");
      persisted.push(envelope({
        type: "agent_end",
        messages: [],
        status: "stopped",
        stopReason: "stop",
        errorMessage: null,
        answerMessageId: null,
        workspaceCommit: null,
      }, nextSequence()));
      state.run = { ...run, status: "stopped", stopReason: "stop", finishedAt: new Date(1).toISOString() };
      state.seq = persisted.at(-1)!.cursor.seq;
    },
    events: async () => persisted,
  };
  const runtime = fixtureRuntime(store, active);
  Object.assign(runtime, {
    workspaces: { saveSession: async () => null },
    sessionEngines: { settled: async () => {} },
    channel: { nextLocked: async () => undefined, stopped: async () => {} },
    waiters: new Map(),
    sessionRunSubscribers: new Map(),
  });

  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  }, beginTurn);
  await settle.call(runtime, active, "stop", null);

  expect(active.frames.map(frame => frame.cursor.seq)).toEqual([3, 4]);
  expect(active.frames[1]?.event.type).toBe("agent_end");
});

it("returns the live partial in the snapshot and continues a reconnected stream", async () => {
  const append = vi.fn();
  const active = activeFixture();
  const store = {
    append,
    run: async () => ({ run, seq: 2, streamId }),
    toolEvents: async () => [],
    runPresentation: async () => new Map(),
    messages: async () => [],
    consumedInputs: async () => [],
    artifacts: async () => [],
  };
  const runtime = fixtureRuntime(store, active);

  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  }, beginTurn);
  await receiveDelta(runtime, active, "he");

  const snapshot = await runtime.snapshot(scope, runId);
  expect(snapshot.cursor).toEqual({ runId, seq: 4, streamId });
  expect(snapshot.pendingMessages).toHaveLength(1);
  const pending = snapshot.pendingMessages[0]!.message;
  if (pending.role !== "assistant") throw new Error("Missing assistant partial");
  expect(pending.content[0]).toEqual({ type: "text", text: "he" });

  const frames: RuntimeStreamFrame[] = [];
  const detach = await runtime.subscribe(scope, runId, snapshot.cursor.seq, snapshot.cursor.streamId, frame => frames.push(frame));
  expect(frames).toEqual([]);

  await receiveDelta(runtime, active, "l");
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({
    type: "event",
    envelope: {
      cursor: { runId, seq: 5, streamId },
      event: { type: "message_update", messageId },
    },
  });
  detach();
  expect(append).not.toHaveBeenCalled();
});

it("accepts an HTTP cursor at the live position beyond the persisted sequence", async () => {
  const active = activeFixture();
  const store = {
    append: vi.fn(),
    run: async () => ({ run, seq: 2, streamId }),
    toolEvents: async () => [],
    runPresentation: async () => new Map(),
    messages: async () => [],
    consumedInputs: async () => [],
    artifacts: async () => [],
  };
  const runtime = fixtureRuntime(store, active);
  await receive.call(runtime, active, {
    type: "message_update",
    nativeId,
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  }, beginTurn);
  await receiveDelta(runtime, active, "he");

  const server = createRuntimeHttp(runtime).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/runs/${runId}/events?afterSeq=4&streamId=${streamId}`,
      { headers: { authorization: "Bearer test-host-token", "x-domain-id": scope.domainId, "x-correlation-id": "fixture" } },
    );
    expect(response.status).toBe(200);
    await response.body!.getReader().cancel();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});
