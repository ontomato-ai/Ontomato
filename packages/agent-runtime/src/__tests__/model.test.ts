import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { modelStream, piModel, resolveModel, testModel } from "../model";
import type { RuntimeStore } from "../store";
import { createRuntimeHttp } from "../http";
import type { AgentRuntime } from "../runtime";
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
let modelPayload: Record<string, unknown> = {};
let modelCalls = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/v1/chat/completions") {
    modelHeaders = req.headers;
    modelCalls++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    modelPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

it("tests unsaved models once with the same headers and final custom request overrides", async () => {
  const before = modelCalls;
  const result = await testModel({ model: {
    ...javaModel, baseUrl: baseUrl + "/v1", apiKey: "draft-key",
    organizationId: "org-fixture", projectId: "project-fixture",
    customHeaders: { "X-Deployment": "fixture" },
    temperature: 0, topP: 0, maxRetries: 8,
    customRequestParameters: { temperature: 0.25, seed: 0, vendor: { enabled: false } },
  }, prompt: "draft probe" }, "test-correlation", new AbortController().signal);
  expect(result).toEqual({ content: "ok" });
  expect(modelCalls - before).toBe(1);
  expect(modelHeaders).toMatchObject({ authorization: "Bearer draft-key", "openai-organization": "org-fixture", "openai-project": "project-fixture", "x-deployment": "fixture" });
  expect(modelPayload).toMatchObject({ temperature: 0.25, top_p: 0, seed: 0, vendor: { enabled: false } });
  expect(JSON.stringify(modelPayload)).not.toContain("draft-key");
});
it("rejects invalid model test drafts before contacting a provider", async () => {
  const before = modelCalls;
  await expect(testModel({ model: { ...javaModel, baseUrl: "invalid", apiKey: "secret" } }, "test", new AbortController().signal)).rejects.toThrow();
  expect(modelCalls).toBe(before);
});

it("exposes the model gateway only to authenticated domain-scoped hosts without a runtime store", async () => {
  const gateway = createServer(createRuntimeHttp({ options: {
    hosts: [{ id: "ontology", token: "fixture-host-token" }],
  } } as AgentRuntime));
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1/models/test`;
  const body = JSON.stringify({ model: { ...javaModel, baseUrl: baseUrl + "/v1", apiKey: "gateway-key" } });
  try {
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(401);
    const response = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json", authorization: "Bearer fixture-host-token",
      "x-domain-id": "fixture-domain", "x-correlation-id": "gateway-fixture",
    }, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: "ok" });
  } finally {
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  }
});
