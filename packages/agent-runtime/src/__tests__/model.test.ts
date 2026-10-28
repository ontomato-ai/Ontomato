import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { modelStream, piModel, resolveModel } from "../model";
import type { RuntimeStore } from "../store";
import { normalizeContext } from "@earendil-works/pi-ai";

// The same Java-produced wire fixture is pinned by BusinessConfigControllerModelKeyWriteOnlyTest.
const runtimeToken = "fixture-runtime-token";
const sealedKey = "enc:v1:mzjUpW4OVVjLMPmxcmMcyop5LFN8VSJ_7lUGPppYXDK_UDNjyKAlYAL7vVwOMOI";

// Java's read DTO includes null optional fields; this is the temporary adapter's boundary.
const javaModel = {
  name: "fixture",
  displayName: "Local fixture",
  baseUrl: "http://127.0.0.1:9/v1",
  modelName: "fixture-model",
  apiKeys: ["******1234"],
  maxTokens: 4096,
  contextWindow: 32000,
  timeout: null,
  maxRetries: null,
  temperature: null,
  topP: null,
  customRequestParameters: null,
  organizationId: null,
  projectId: null,
};
let fields: Record<string, unknown> = {};
let sealedApiKeys: Record<string, string[]> | undefined;
let settingsHeaders: IncomingHttpHeaders;
let modelHeaders: IncomingHttpHeaders;
const server = createServer((req, res) => {
  if (req.url === "/v1/chat/completions") {
    modelHeaders = req.headers;
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      model: javaModel.modelName,
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    })}\n\ndata: [DONE]\n\n`);
    return;
  }
  settingsHeaders = req.headers;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      success: true,
      data: {
        models: [{ ...javaModel, baseUrl: baseUrl + "/v1", ...fields }],
        agents: { knowledgeGovernance: { model: "fixture", skilldir: null } },
        sealedApiKeys,
      },
    }),
  );
});
let baseUrl = "";
beforeEach(() => {
  fields = {};
  sealedApiKeys = { fixture: [sealedKey] };
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const request: RuntimeStartRunRequest = {
  language: "en",
  input: { role: "user", content: "fixture", timestamp: 1 },
  definition: {
    modelRole: "knowledgeGovernance",
    systemPrompt: "",
    skills: [],
    externalMcp: [],
    sandbox: { limits: codeLimitsSchema.parse({}) },
    compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" },
  },
  modelCredential: { kind: "none" },
  environment: { values: {}, secrets: {} },
};
const read = () =>
  resolveModel({
    baseUrl,
    request: { ...request, modelCredential: { kind: "token", value: "fixture-user-token" } },
    runtimeToken,
    correlationId: "fixture-correlation",
    signal: new AbortController().signal,
  });

it("opens Java's sealed key for the model without sending the seal token to Java", async () => {
  const resolved = await read();
  const stream = modelStream(
    resolved,
    { pool: { query: async () => ({ rows: [] }) }, table: () => "unused" } as unknown as RuntimeStore,
    { hostId: "fixture", domainId: "fixture" },
    "fixture-run", "fixture-correlation", "conversation",
  );
  const result = await stream(piModel(resolved), normalizeContext({
    messages: [{ role: "user", content: "hello", timestamp: 1 }],
  }));
  for await (const _event of result) { /* Drain the provider stream. */ }
  expect((await result.result()).stopReason).toBe("stop");
  expect(modelHeaders.authorization).toBe("Bearer sk-fixture-key-1234");
  expect(settingsHeaders.tk).toBe("fixture-user-token");
  expect(settingsHeaders["x-ontomato-model-runtime-token"]).toBeUndefined();
});

it("rejects the retired plaintext-only settings response", async () => {
  fields = { apiKeys: ["plaintext-key-must-not-be-used"] };
  sealedApiKeys = undefined;
  await expect(read()).rejects.toThrow();
});

it("treats Java's null optional model fields as unset", async () => {
  fields = {};
  const resolved = await read();
  for (const key of [
    "timeout",
    "maxRetries",
    "temperature",
    "topP",
    "customRequestParameters",
  ] as const)
    expect(resolved[key]).toBeUndefined();
  expect(resolved.maxTokens).toBe(4096);
  expect(resolved.contextWindow).toBe(32000);
});
it("preserves explicit zero values and custom parameters", async () => {
  fields = {
    timeout: "PT30S",
    maxRetries: 0,
    temperature: 0,
    topP: 0,
    customRequestParameters: { seed: 0 },
  };
  expect(await read()).toMatchObject(fields);
});
it("still rejects invalid required model settings", async () => {
  fields = { maxTokens: null };
  await expect(read()).rejects.toThrow();
});
