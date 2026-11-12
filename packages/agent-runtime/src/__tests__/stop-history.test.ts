import { readFileSync } from "node:fs";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { expect, it, vi } from "vitest";
import { Type } from "typebox";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import { modelStream, piModel, recoverContext, resolveModel } from "../model";
import { runAgentLoop } from "../core/pi/agent-loop";
import { RuntimeStore } from "../store";
import { runtimeLogger } from "../logging";

vi.mock("@earendil-works/pi-ai/api/openai-completions", async importOriginal => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai/api/openai-completions")>();
  return { ...actual, streamSimple: vi.fn(actual.streamSimple) };
});

const config = resolveModel("fixture", { api: "openai-completions", baseUrl: "http://fixture/v1", apiKey: "key" },
  { id: "fixture", type: "chat" }, { provider: { maxRetries: 0, timeoutMs: 5000, maxRetryDelayMs: 0 } });
const scope = { hostId: "host", domainId: "domain" };
const store = { pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }, table: () => "model_calls" } as unknown as RuntimeStore;
const user = (content: string): Message => ({ role: "user", content, timestamp: Date.now() });
const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const response = (text: string) => new Response(text + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

it("stops during a tool execution, persists its result, then sends a legal next request", async () => {
  const controller = new AbortController();
  const saved: Message[] = [];
  let executing!: () => void;
  const started = new Promise<void>(resolve => { executing = resolve; });
  const stream = modelStream(config, store, scope, "run", "correlation", "conversation");
  const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValueOnce(response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "wait", arguments: "{}" } }] }, "tool_calls")))
    .mockResolvedValue(response(chunk({ role: "assistant", content: "continued" }, "stop")));
  const loop = { model: piModel(config), convertToLlm: (m: unknown[]) => m as Message[], fetch: fetcher };
  const tool = { name: "wait", label: "wait", description: "Wait", parameters: Type.Object({}),
    execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
      executing();
      await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
      return { content: [{ type: "text" as const, text: "Cancelled" }], details: {} };
    } };
  const sink = (event: import("../core/pi/types").AgentEvent) => { if (event.type === "message_end") saved.push(structuredClone(event.message as Message)); };
  const running = runAgentLoop([user("start")], { messages: [], tools: [tool] }, loop, sink, controller.signal, stream);
  await started;
  controller.abort();
  await running;
  expect(saved.find(m => m.role === "toolResult")).toMatchObject({ toolCallId: "call-1" });
  await runAgentLoop([user("next")], { messages: recoverContext(saved), tools: [tool] }, loop, sink, undefined, stream);
  const body = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string);
  const resultIndex = body.messages.findIndex((m: { role: string }) => m.role === "tool");
  expect(body.messages[resultIndex - 1].tool_calls[0].id).toBe(body.messages[resultIndex].tool_call_id);
  expect(saved.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "continued" }] });
});

it("removes partial tool calls before an interrupted model response reaches persistence", async () => {
  const controller = new AbortController();
  const stream = modelStream(config, store, scope, "run", "correlation", "conversation");
  const output = await stream(piModel(config), normalizeContext({ messages: [user("start")] }), {
    signal: controller.signal,
    fetch: async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "half", type: "function", function: { name: "wait", arguments: '{"x":' } }] })));
      controller.signal.addEventListener("abort", () => c.error(new Error("aborted")), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } }),
  });
  for await (const event of output) if (event.type === "toolcall_delta") controller.abort();
  const message = await output.result();
  expect(message.stopReason).toBe("aborted");
  expect(message.content.some(part => part.type === "toolCall")).toBe(false);
  expect(recoverContext([message, user("next")]).some(m => m.role === "toolResult")).toBe(false);
});

it.each(["zh-CN", "en"])("keeps provider JSON in logs and presents readable %s failures", async language => {
  const log = vi.spyOn(runtimeLogger, "error");
  const stream = modelStream(config, store, scope, "run", "correlation", "conversation", language);
  const output = await stream(piModel(config), normalizeContext({ messages: [user("start")] }), {
    fetch: async () => new Response('{"error":{"message":"private upstream JSON"}}', { status: 400 }),
  });
  for await (const _event of output) { /* Consume the provider stream. */ }
  const message = await output.result();
  expect(message.errorMessage).toContain(language === "en" ? "model service" : "模型服务");
  expect(message.errorMessage).not.toContain("private upstream JSON");
  expect(message.errorMessage).toContain("HTTP 400");
  expect(JSON.stringify(log.mock.calls)).toContain("private upstream JSON");
  log.mockRestore();
});

it("writes an unknown outcome for an unfinished dispatched call before closing the run", async () => {
  const messages: Array<{ message: unknown }> = [{ message: { role: "assistant", stopReason: "toolUse", content: [
    { type: "toolCall", id: "dispatched", name: "wait", arguments: {} },
  ] } }];
  const append = vi.fn(async (_scope, _id, event) => {
    if (event.type === "message_end") messages.push({ message: event.message });
    return { event };
  });
  const fakeStore = { pool: {}, run: async () => ({ run: { sessionId: "session", workspaceCommit: null } }),
    messages: async () => messages, append };
  await RuntimeStore.prototype.finish.call(fakeStore as unknown as RuntimeStore, scope, "run", "aborted", "Run cancelled");
  expect(append.mock.calls.map(call => call[2].type)).toEqual(["message_end", "message_end", "agent_end"]);
  expect(append.mock.calls[2][2]).toMatchObject({ stopReason: "aborted", answerMessageId: null });
  expect(messages[1].message).toMatchObject({ role: "toolResult", toolCallId: "dispatched", isError: true });
  expect(JSON.stringify(messages[1])).toContain("Do not repeat this action automatically");
});

// Captured on 128: session.json messages 11–15, without persistence envelopes.
it("continues after the real persisted partial-call, cancellation notice and upstream 400", async () => {
  const persisted: Message[] = JSON.parse(readFileSync(new URL("./fixtures/interrupted-history.json", import.meta.url), "utf8"));
  const original = JSON.stringify(persisted);
  const recovered = recoverContext(persisted);
  expect(JSON.stringify(persisted)).toBe(original);
  expect(recovered.some(message => message.role === "toolResult")).toBe(false);
  expect(recovered.flatMap(message => message.role === "assistant" ? message.content : [])
    .some(part => part.type === "toolCall")).toBe(false);
  const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
    response(chunk({ role: "assistant", content: "continued" }, "stop")),
  );
  const stream = modelStream(config, store, scope, "next", "correlation", "conversation");
  const output = await stream(piModel(config), normalizeContext({ messages: [...recovered, user("next")] }), { fetch: fetcher });
  for await (const _event of output) { /* Consume the next model request. */ }
  const payload = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(payload.messages.some((message: { role: string }) => message.role === "tool")).toBe(false);
  expect((await output.result()).stopReason).toBe("stop");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([400, 401, 429])("preserves HTTP %s on the thrown-exception path without exposing its body", async status => {
  const failure = Object.assign(new Error("private upstream body"), { status });
  vi.mocked(completions.streamSimple).mockImplementationOnce(() => { throw failure; });
  const log = vi.spyOn(runtimeLogger, "error");
  try {
    const stream = modelStream(config, store, scope, "run", "correlation", "conversation", "zh-CN");
    const output = await stream(piModel(config), normalizeContext({ messages: [user("start")] }));
    for await (const _event of output) { /* Consume the failed request. */ }
    const message = await output.result();
    expect(message.errorMessage).toContain(`HTTP ${status}`);
    expect(message.errorMessage).toContain("模型服务");
    expect(message.errorMessage).not.toContain("private upstream body");
    expect(JSON.stringify(log.mock.calls)).toContain("private upstream body");
  } finally {
    log.mockRestore();
  }
});
