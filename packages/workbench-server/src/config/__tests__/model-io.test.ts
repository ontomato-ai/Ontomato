import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { createModel } from "../model-factory";
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
const captured = vi.hoisted(() => {
  const trackerCalls: Array<{ agentName: unknown; meta: unknown }> = [];
  const tracker = { success: vi.fn(), successFromChunks: vi.fn(), fail: vi.fn() };
  return {
    trackerCalls,
    tracker,
  };
});
vi.mock("../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));
vi.mock("../../logging/llm-logger", () => ({
  startLlmLog: (agentName: unknown, _prompt: unknown, meta: unknown) => {
    captured.trackerCalls.push({ agentName, meta });
    return captured.tracker;
  },
}));
vi.mock("../../config/model-resolver", () => ({
  resolveModelForRole: async () => ({
    baseUrl: "http://model.test",
    apiKey: "t5l-key",
    modelName: "t5l-model",
    timeoutSeconds: 12,
    maxRetries: 0,
    maxTokens: 4096,
    contextWindow: 128000,
    customRequestParameters: {},
  }),
}));
const COMPLETION_BODY = {
  id: "t5l-1",
  object: "chat.completion",
  created: 0,
  model: "t5l-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
function chunkEvent(text: string): string {
  return `data: ${JSON.stringify({
    id: "t5l-1",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: text } }],
  })}\n\n`;
}
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      if (lines.length) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
function stubModelFetch(handler: (input: unknown) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => handler(input))
  );
}
beforeEach(() => { vi.clearAllMocks(); captured.trackerCalls.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });
describe("model IO and execution identity", () => {
  it("preserves the model result and tracking identity", async () => {
    stubModelFetch(async () => Response.json(COMPLETION_BODY));
    const model = await createModel({ agentName: "fixture-agent", agentRunId: "run-t5l" });
    const result = await model.invoke([{ role: "user", content: "hi" }]);
    expect(String(result.content)).toBe("ok");

    expect(captured.tracker.success).toHaveBeenCalled();
    expect(captured.trackerCalls[0]).toMatchObject({
      agentName: "fixture-agent",
      meta: { agentRunId: "run-t5l" },
    });
  });
  it("propagates invoke failure", async () => {
    stubModelFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "t5l-invoke-boom" } }), { status: 500 })
    );
    const model = await createModel({ agentName: "fixture-agent" });
    await expect(model.invoke([{ role: "user", content: "hi" }])).rejects.toThrow();

    expect(captured.tracker.fail).toHaveBeenCalled();
  });
  it("preserves streaming chunk delivery", async () => {
    stubModelFetch(async () => sseResponse([chunkEvent("a"), chunkEvent("b")]));
    const model = await createModel({ agentName: "fixture-agent" });
    const stream = await model.stream([{ role: "user", content: "hi" }]);
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(String(chunk.content));
    expect(chunks).toEqual(["a", "b"]);

    expect(captured.tracker.successFromChunks).toHaveBeenCalled();
  });
  it("propagates stream connection failure", async () => {
    stubModelFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "t5l-conn-boom" } }), { status: 503 })
    );
    const model = await createModel({ agentName: "fixture-agent" });
    await expect(model.stream([{ role: "user", content: "hi" }])).rejects.toThrow();

    expect(captured.tracker.fail).toHaveBeenCalled();
  });
});
