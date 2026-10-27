import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer } from "node:http";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { resolveModel } from "../model";

// Java's read DTO includes null optional fields; this is the temporary adapter's boundary.
const javaModel = {
  name: "fixture", displayName: "Local fixture", baseUrl: "http://127.0.0.1:9/v1",
  modelName: "fixture-model", apiKeys: ["fixture-model-secret"],
  maxTokens: 4096, contextWindow: 32000,
  timeout: null, maxRetries: null, temperature: null, topP: null,
  customRequestParameters: null, organizationId: null, projectId: null,
};
let fields: Record<string, unknown> = {};
const server = createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ success: true, data: {
    models: [{ ...javaModel, ...fields }],
    agents: { knowledgeGovernance: { model: "fixture", skilldir: null } },
  } }));
});
let baseUrl = "";
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
const request: RuntimeStartRunRequest = {
  language: "en", input: { role: "user", content: "fixture", timestamp: 1 },
  definition: { modelRole: "knowledgeGovernance", systemPrompt: "", skills: [],
    externalMcp: [], builtinTools: { workspaceFiles: false },
    compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" } },
  privateContext: { credential: { kind: "none" }, skillBindings: [] },
};
const read = () => resolveModel({ baseUrl, request, correlationId: "fixture-correlation", signal: new AbortController().signal });

it("treats Java's null optional model fields as unset", async () => {
  fields = {};
  const resolved = await read();
  for (const key of ["timeout", "maxRetries", "temperature", "topP", "customRequestParameters"] as const)
    expect(resolved[key]).toBeUndefined();
  expect(resolved.maxTokens).toBe(4096);
  expect(resolved.contextWindow).toBe(32000);
});
it("preserves explicit zero values and custom parameters", async () => {
  fields = { timeout: "PT30S", maxRetries: 0, temperature: 0, topP: 0, customRequestParameters: { seed: 0 } };
  expect(await read()).toMatchObject(fields);
});
it("still rejects invalid required model settings", async () => {
  fields = { maxTokens: null };
  await expect(read()).rejects.toThrow();
});
