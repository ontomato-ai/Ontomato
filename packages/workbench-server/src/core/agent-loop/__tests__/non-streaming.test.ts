import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runAgentLoop } from "../agent-loop";
import { streamChatCompletion } from "../llm-stream";
import type { AgentState, ModelConfig } from "../types";
import { installContentLayout } from "../../../content/layout";
import { saveSystemModelConfig } from "../../../config/system-model";


const tracker = vi.hoisted(() => ({
  success: vi.fn(), successFromChunks: vi.fn(), fail: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../../../logging/logger", () => ({
  createLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }),
}));
vi.mock("../../../logging/llm-logger", () => ({ startLlmLog: () => tracker }));
vi.mock("../../../i18n", () => ({ tApp: (key: string) => key }));
vi.mock("../compaction/compact-messages", () => ({
  compactContext: () => { throw new Error("This offline test does not use sessions"); },
}));

const context = vi.hoisted(() => ({ domainId: "harness-off" }));
vi.mock("../../../logging/log-context", () => ({ getLogContext: () => context }));
let runtimeRoot: string;
beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "independent-stream-test-"));
  installContentLayout({ runtimeRoot, prompts: [], publicSkillsRoot: path.join(runtimeRoot, "skills"), runtimeResources: [] });
});
beforeEach(() => {
  context.domainId = "harness-off";
  saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: false });
});
afterAll(() => { fs.rmSync(runtimeRoot, { recursive: true, force: true }); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const config: ModelConfig = {
  baseUrl: "https://fixture.invalid/v1", apiKey: "offline-only", modelName: "fixture-model",
};
const toolCall = (id: string, args: string) => ({
  id, type: "function", function: { name: "lookup", arguments: args },
});

function state(terminate = false) {
  const execute = vi.fn(async (_id: string, _args: unknown) => ({
    content: [{ type: "text" as const, text: "ok" }], terminate,
  }));
  const agent: AgentState = {
    systemPrompt: "Offline tool test", messages: [], isStreaming: false,
    tools: [{
      name: "lookup", description: "Look up a number",
      parameters: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] },
      execute,
    }],
  };
  return { agent, execute };
}

function jsonResponse(message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: "response-1", object: "chat.completion", created: 0, model: "fixture-model",
    choices: [{ index: 0, message: { role: "assistant", ...message },
      finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
      prompt_tokens_details: { cached_tokens: 2 } },
  }), { headers: { "content-type": "application/json" } });
}

function mockResponses(reply: (round: number) => Response) {
  const requests: Array<Record<string, unknown>> = [];
  const transport: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(init!.body as string));
    return reply(requests.length);
  };
  vi.stubGlobal("fetch", transport);
  return requests;
}

it("uses full responses for all rounds and dispatches every complete tool call", async () => {
  const requests = mockResponses(round => jsonResponse(round === 1 ? {
    content: "Checking", reasoning_content: "Need three lookups",
    tool_calls: [1, 2, 3].map(x => toolCall(`c${x}`, JSON.stringify({ x }))),
  } : { content: "Done" }));
  const { agent, execute } = state();
  const messages = await runAgentLoop("Look up 1, 2 and 3", agent, {
    ...config, modelKwargs: { stream: true, temperature: 0.2 },
    llmLog: { agentName: "fixture", agentRunId: "run-1" },
  }, () => {});

  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request).toMatchObject({ stream: false, temperature: 0.2 });
  }
  expect(execute.mock.calls.map(([id, args]) => [id, args])).toEqual([
    ["c1", { x: 1 }], ["c2", { x: 2 }], ["c3", { x: 3 }],
  ]);
  expect(requests[1]).toMatchObject({ messages: expect.arrayContaining([
    expect.objectContaining({ role: "tool", tool_call_id: "c1" }),
    expect.objectContaining({ role: "tool", tool_call_id: "c2" }),
    expect.objectContaining({ role: "tool", tool_call_id: "c3" }),
  ]) });
  expect(messages[1]).toMatchObject({
    stopReason: "tool_calls",
    usage: { input: 11, output: 7, cacheRead: 2, totalTokens: 18 },
    content: expect.arrayContaining([
      { type: "thinking", text: "Need three lookups" },
      { type: "text", text: "Checking" },
    ]),
  });
  expect(messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "Done" }] });
  expect(tracker.success).toHaveBeenCalledTimes(2);
  expect(tracker.successFromChunks).not.toHaveBeenCalled();
});

it.each([undefined, false, true])("keeps streaming when enabled, regardless of custom stream=%s", async stream => {
  saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: true });
  const frame = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "response-1", object: "chat.completion.chunk", created: 0,
      model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  const requests = mockResponses(() => new Response(
    frame({ role: "assistant", tool_calls: [{ index: 0, ...toolCall("c1", '{"x":') }] }) +
    frame({ tool_calls: [{ index: 0, id: "c1", function: { arguments: "1}" } }] }) +
    frame({}, "tool_calls") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  ));
  const { agent, execute } = state(true);
  await runAgentLoop("Look up 1", agent, {
    ...config, ...(stream === undefined ? {} : { modelKwargs: { stream } }),
  }, () => {});
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ stream: true });
  expect(execute.mock.calls[0]).toEqual(expect.arrayContaining(["c1", { x: 1 }]));
});

it("reports invalid complete tool arguments instead of silently dropping the call", async () => {
  mockResponses(() => jsonResponse({ content: null, tool_calls: [toolCall("c1", "{broken")] }));
  const { agent, execute } = state();
  const messages = await runAgentLoop("Look up 1", agent, {
    ...config, modelKwargs: { stream: false },
  }, () => {});
  expect(execute).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({
    stopReason: "error", errorMessage: "Invalid tool call arguments in non-streaming response",
  });
});

it("keeps provider failures visible in non-streaming mode", async () => {
  mockResponses(() => new Response(JSON.stringify({ error: {
    message: "fixture model refused the request", type: "invalid_request_error",
  } }), { status: 400, headers: { "content-type": "application/json" } }));
  const { agent, execute } = state();
  const messages = await runAgentLoop("Look up 1", agent, {
    ...config, modelKwargs: { stream: false },
  }, () => {});
  expect(execute).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({
    stopReason: "error", errorMessage: expect.stringContaining("fixture model refused the request"),
  });
});

it("cancels an in-flight full-response request through the existing signal", async () => {
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const transport: typeof fetch = async (_input, init) => {
    markStarted();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  };
  vi.stubGlobal("fetch", transport);
  const iterator = streamChatCompletion({ ...config, modelKwargs: { stream: false } },
    "Offline tool test", [], [], controller.signal);
  const result = iterator.next();
  await started;
  controller.abort();
  expect(await result).toMatchObject({ done: true, value: { stopReason: "aborted" } });
});

it("uses a saved policy change on the next tool round, without changing the in-flight request", async () => {
  const requests = mockResponses(round => {
    if (round === 1) return jsonResponse({ content: null, tool_calls: [toolCall("c1", '{"x":1}')] });
    return new Response(`data: ${JSON.stringify({ id: "r2", model: "fixture-model",
      choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } });
  });
  const { agent, execute } = state();
  execute.mockImplementationOnce(async () => {
    saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: true });
    return { content: [{ type: "text", text: "ok" }], terminate: false };
  });
  const messages = await runAgentLoop("Look up 1", agent, {
    ...config, modelKwargs: { stream: false },
  }, () => {});
  expect(requests.map(request => request.stream)).toEqual([false, true]);
  expect(messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "Done" }] });
});
