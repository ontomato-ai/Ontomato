import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createModel } from "../model-factory";
import { installContentLayout } from "../../content/layout";
import { saveSystemModelConfig } from "../../config/system-model";


const { entry, tracker } = vi.hoisted(() => ({
  entry: {
    baseUrl: "https://fixture.invalid/v1", apiKey: "offline-only", modelName: "fixture-model",
    maxTokens: 1000, contextWindow: 8000, maxRetries: 0,
    customRequestParameters: {} as Record<string, unknown>,
  },
  tracker: { success: vi.fn(), successFromChunks: vi.fn(), fail: vi.fn() },
}));
vi.mock("../model-resolver", () => ({ resolveModelForRole: async () => entry }));
vi.mock("../../logging/llm-logger", () => ({ startLlmLog: () => tracker }));
vi.mock("../../logging/logger", () => ({
  createLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }),
}));
vi.mock("../../i18n", () => ({ tApp: (key: string) => key }));

beforeEach(() => { entry.customRequestParameters = {}; });
const context = vi.hoisted(() => ({ domainId: "factory-off" }));
vi.mock("../../logging/log-context", () => ({ getLogContext: () => context }));
let runtimeRoot: string;
beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "independent-stream-test-"));
  installContentLayout({ runtimeRoot, prompts: [], publicSkillsRoot: path.join(runtimeRoot, "skills"), runtimeResources: [] });
});
beforeEach(() => {
  context.domainId = "factory-off";
  saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: false });
});
afterAll(() => { fs.rmSync(runtimeRoot, { recursive: true, force: true }); });

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function mockResponse(response: Response) {
  const requests: Array<Record<string, unknown>> = [];
  const transport: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(init!.body as string));
    return response;
  };
  vi.stubGlobal("fetch", transport);
  return requests;
}

it.each([undefined, "report"])("reads a full response through stream(), with agent %s", async agentName => {
  entry.customRequestParameters = { stream: true, temperature: 0.3 };
  const requests = mockResponse(new Response(JSON.stringify({
    id: "r1", object: "chat.completion", created: 0, model: "fixture-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Complete answer" } }],
  }), { headers: { "content-type": "application/json" } }));
  const model = await createModel({ agentName });
  const chunks = [];
  for await (const chunk of await model.stream("Write an answer")) chunks.push(chunk);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ stream: false, temperature: 0.3 });
  expect(chunks.map(chunk => chunk.content)).toEqual(["Complete answer"]);
  expect(tracker.successFromChunks).toHaveBeenCalledTimes(agentName ? 1 : 0);
  expect(tracker.success).not.toHaveBeenCalled();
});

it.each([undefined, false, true])("keeps streaming when enabled, regardless of custom stream=%s", async stream => {
  saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: true });
  if (stream !== undefined) entry.customRequestParameters = { stream };
  const frame = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "r1", object: "chat.completion.chunk", created: 0,
      model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  const requests = mockResponse(new Response(
    frame({ role: "assistant", content: "First" }) + frame({ content: " second" }) +
    frame({}, "stop") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  ));
  const model = await createModel();
  let text = "";
  for await (const chunk of await model.stream("Write an answer")) text += chunk.content;
  expect(requests[0]).toMatchObject({ stream: true });
  expect(text).toBe("First second");
});

it("propagates a full-response provider failure to streaming callers", async () => {
  entry.customRequestParameters = { stream: false };
  mockResponse(new Response(JSON.stringify({ error: { message: "fixture rejection", type: "invalid_request_error" } }),
    { status: 400, headers: { "content-type": "application/json" } }));
  const model = await createModel({ agentName: "report" });
  await expect(model.stream("Write an answer")).rejects.toThrow("fixture rejection");
  expect(tracker.fail).toHaveBeenCalledTimes(1);
});

it("passes cancellation to the full-response request", async () => {
  entry.customRequestParameters = { stream: false };
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
  const model = await createModel();
  const pending = model.stream("Write an answer", { signal: controller.signal });
  const assertion = expect(pending).rejects.toThrow();
  await started;
  controller.abort();
  await assertion;
});

it("reads the current domain policy for every request on an existing model", async () => {
  saveSystemModelConfig("factory-on", { nodeModelStreamingEnabled: true });
  entry.customRequestParameters = { stream: false };
  const requests: boolean[] = [];
  const transport: typeof fetch = async (_input, init) => {
    const body = JSON.parse(init!.body as string);
    requests.push(body.stream);
    if (body.stream) {
      return new Response(`data: ${JSON.stringify({ id: "r1", model: "fixture-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "streamed" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ id: "r1", model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: "complete" }, finish_reason: "stop" }] }),
    { headers: { "content-type": "application/json" } });
  };
  vi.stubGlobal("fetch", transport);
  const model = await createModel();
  const consume = async () => {
    let result = "";
    for await (const chunk of await model.stream("answer")) result += chunk.content;
    return result;
  };
  expect(await consume()).toBe("complete");
  context.domainId = "factory-on";
  expect(await consume()).toBe("streamed");
  saveSystemModelConfig("factory-on", { nodeModelStreamingEnabled: false });
  expect(await consume()).toBe("complete");
  expect(requests).toEqual([false, true, false]);
});

it("keeps invoke non-streaming even when the switch and custom stream are true", async () => {
  saveSystemModelConfig(context.domainId, { nodeModelStreamingEnabled: true });
  entry.customRequestParameters = { stream: true };
  const requests = mockResponse(new Response(JSON.stringify({ id: "r1", model: "fixture-model",
    choices: [{ index: 0, message: { role: "assistant", content: "complete" }, finish_reason: "stop" }] }),
  { headers: { "content-type": "application/json" } }));
  const model = await createModel();
  expect((await model.invoke("answer")).content).toBe("complete");
  expect(requests[0].stream).toBe(false);
});
