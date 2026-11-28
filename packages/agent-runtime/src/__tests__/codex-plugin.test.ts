import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { expect, it, vi } from "vitest";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { NativeSessionMissing } from "../adapters/contract";
import type { HarnessEvent, HarnessOpenRequest, HarnessProcess, HarnessTurnHost, HarnessTurnInput } from "../adapters/contract";
import { codexPlugin } from "../adapters/codex";
import { deferred } from "../adapters/codex/transport";

type Frame = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } };
const recording: Frame[] = readFileSync(new URL("../adapters/codex/fixtures/steer-dynamic.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map(line => JSON.parse(line));
const input = (id: string, content: string): HarnessTurnInput => ({
  id, context: null, message: { role: "user", content, timestamp: 1 },
});

function fixture(onSend: (frame: Frame, send: (frame: Frame) => void) => void) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const done = deferred<number | null>();
  const frames: Frame[] = [];
  const process: HarnessProcess = {
    stdin, stdout, stderr: new PassThrough(), channel: new PassThrough(), exited: done.promise,
    kill() { stdin.end(); stdout.end(); done.resolve(null); },
  };
  const send = (frame: Frame) => stdout.write(JSON.stringify(frame) + "\n");
  createInterface({ input: stdin }).on("line", line => {
    const frame: Frame = JSON.parse(line);
    frames.push(frame);
    switch (frame.method) {
      case "initialize": send({ id: frame.id, result: {} }); break;
      case "thread/resume":
        if (frame.params?.threadId !== "thread") {
          send({ id: frame.id, error: frame.params?.threadId === "missing"
            ? { code: -32600, message: "no rollout found for thread id missing" }
            : { code: -32603, message: "failed to read thread" } });
          break;
        }
        // Fall through to return the reference from the available thread.
      case "thread/start":
        send({ id: frame.id, result: { thread: { id: "thread" } } });
        break;
      case "thread/inject_items": send({ id: frame.id, result: {} }); break;
      case "turn/start":
        send({ id: frame.id, result: { turn: { id: "turn", status: "inProgress", error: null } } });
        onSend(frame, send);
        break;
      default: onSend(frame, send);
    }
  });
  function open(engineRef: string | null = null, previousContext: HarnessOpenRequest["previousContext"] = null) {
    return codexPlugin.open({
      sessionId: "session", domainId: "domain", engineRef, previousContext,
      sandbox: { spawn: () => process },
      model: { model: "test", baseUrl: "http://127.0.0.1:9999/v1", contextWindow: 128000, maxOutputTokens: null, token: "lease" },
      directories: { workspace: "/workspace", state: "/state", skills: [] },
      prompt: { system: "Test prompt" }, engineTools: false, language: "en",
      tools: [{ name: "r14_platform", description: "Test", parameters: { type: "object" } }],
      limits: codeLimitsSchema.parse({}), signal: new AbortController().signal,
    });
  }
  return { open, frames, process };
}

it("persists database context before issuing any Codex turn", async () => {
  const subject = fixture(() => {});
  const engine = await subject.open(null, [input("consumed", "Existing model input").message]);
  try {
    expect(subject.frames.map(frame => frame.method)).toEqual(["initialize", "initialized", "thread/start", "thread/inject_items"]);
    expect(subject.frames.at(-1)?.params).toMatchObject({
      threadId: engine.engineRef, items: [{ role: "user", content: [{ type: "input_text", text: "Existing model input" }] }],
    });
  } finally {
    await engine.close();
  }
});

it("signals an absent Codex rollout and propagates other resume errors", async () => {
  await expect(fixture(() => {}).open("missing")).rejects.toBeInstanceOf(NativeSessionMissing);
  await expect(fixture(() => {}).open("unreadable")).rejects.toMatchObject({ code: -32603 });
});

it("replays Codex 0.171.0 parallel tool calls, consumes identical steers by client ID and uses the final item once", async () => {
  const opened = deferred<void>();
  const invoked = deferred<void>();
  const proceed = deferred<void>();
  const replies = new Set<number>();
  const order: (HarnessEvent | string)[] = [];
  const toolNames: string[] = [];
  const boundary = recording.findIndex(frame => frame.method === "item/completed" &&
    (frame.params?.item as { type: string }).type === "dynamicToolCall");
  const subject = fixture((frame, send) => {
    if (frame.method === "turn/start") {
      recording.slice(0, boundary).forEach(send);
      opened.resolve();
    } else if (frame.method === "turn/steer") {
      expect(frame.params?.expectedTurnId).toBe("turn");
      send({ id: frame.id, result: { turnId: "turn" } });
    } else if (frame.method === undefined && frame.id !== undefined) {
      replies.add(frame.id);
      if (replies.size === 2) recording.slice(boundary).forEach(send);
    }
  });
  const session = await subject.open();
  const host: HarnessTurnHost = {
    async emit(event) { order.push(event); },
    async consumed(id) { order.push(id); },
    async invokeTool(call) {
      toolNames.push(call.toolName);
      if (toolNames.length === 2) invoked.resolve();
      await proceed.promise;
      return { isError: false, result: { content: [{ type: "text", text: call.toolCallId }], details: {} } };
    },
  };
  try {
    const run = session.startTurn({ runId: "run", inputs: [input("input-original-dynamic", "Original")], context: null, host },
      new AbortController().signal);
    await opened.promise;
    await invoked.promise;
    expect(await session.steer(input("input-steer-dynamic-1", "Same"))).toEqual({ accepted: true });
    expect(await session.steer(input("input-steer-dynamic-2", "Same"))).toEqual({ accepted: true });
    expect(order).not.toContain("input-steer-dynamic-1");
    proceed.resolve();
    expect(await run).toEqual({ stopReason: "stop", errorMessage: null, unsettledToolCalls: [] });
    expect(toolNames).toEqual(["r14_platform", "r14_platform"]);
    expect([...replies].sort()).toEqual([0, 1]);
    expect(order.flatMap(event => typeof event === "string"
      ? [event] : event.type === "tool_execution_end" ? [event.toolCallId] : []))
      .toEqual(["input-original-dynamic", "dyn1", "dyn2", "input-steer-dynamic-1", "input-steer-dynamic-2"]);
    expect(order).toContainEqual(expect.objectContaining({
      type: "message_end", message: expect.objectContaining({ phase: "answer", content: [{ type: "text", text: "DYNAMIC_FINAL" }] }),
    }));
    expect(order).toContainEqual(expect.objectContaining({ type: "usage_updated", usage: expect.objectContaining({ nativeId: null }) }));
  } finally {
    await session.close();
  }
});

it("cleans the native terminals and reports a cancelled dynamic call as unsettled without sending the late result", async () => {
  const before = deferred<void>();
  const invoke = vi.fn(async ({ signal }: Parameters<HarnessTurnHost["invokeTool"]>[0]) => {
    before.resolve();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { result: { content: [], details: {} }, isError: false };
  });
  const events: HarnessEvent[] = [];
  const subject = fixture((frame, send) => {
    switch (frame.method) {
      case "turn/start":
        send({ id: 0, method: "item/tool/call", params: { threadId: "thread", turnId: "turn",
          callId: "pending", tool: "r14_platform", arguments: {} } });
        break;
      case "turn/interrupt":
        send({ id: frame.id, result: {} });
        send({ method: "item/completed", params: { threadId: "thread", turnId: "turn",
          item: { type: "dynamicToolCall", id: "pending", status: "failed", success: false } } });
        send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "interrupted" } } });
        break;
      case "thread/backgroundTerminals/clean":
        send({ id: frame.id, result: {} });
        break;
    }
  });
  const session = await subject.open("thread");
  const cancel = new AbortController();
  try {
    const run = session.startTurn({ runId: "run", inputs: [input("user", "Stop")], context: null, host: {
      emit: async event => { events.push(event); }, consumed: vi.fn(), invokeTool: invoke,
    } }, cancel.signal);
    await before.promise;
    cancel.abort();
    expect(await run).toMatchObject({ stopReason: "aborted", unsettledToolCalls: [{ toolCallId: "pending" }] });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_execution_end" }));
    expect(subject.frames).toContainEqual(expect.objectContaining({ method: "thread/backgroundTerminals/clean" }));
    expect(subject.frames).toContainEqual(expect.objectContaining({ method: "thread/resume",
      params: { cwd: "/workspace", model: "test", baseInstructions: "Test prompt", threadId: "thread", excludeTurns: true } }));
    expect(subject.frames.find(frame => frame.id === 0)).toBeUndefined();
  } finally {
    await session.close();
  }
});
