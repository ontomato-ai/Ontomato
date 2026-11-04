import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { testModel, resolveModel } from "../model";
let modelHeaders: IncomingHttpHeaders;
let modelPayload: Record<string, unknown> = {};
let modelCalls = 0;
let baseUrl = "";
const server = createServer(async (req, res) => {
  modelHeaders = req.headers;
  modelCalls++;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  modelPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model",
    choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  })}\n\ndata: [DONE]\n\n`);
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
it("tests unsaved models once with the same headers and final custom request overrides", async () => {
  const before = modelCalls;
  const result = await testModel(resolveModel("fixture", {
    baseUrl: baseUrl + "/v1", apiKey: "draft-key", api: "openai-completions",
    headers: { "OpenAI-Organization": "org-fixture", "OpenAI-Project": "project-fixture", "X-Deployment": "fixture" },
  }, { id: "fixture-model", type: "chat", maxTokens: 4096, contextWindow: 32000,
    samplingParams: { temperature: 0.25, top_p: 0, seed: 0, vendor: { enabled: false } },
  }, { provider: { timeoutMs: 30000, maxRetries: 8, maxRetryDelayMs: 60000 } }), "draft probe", "test-correlation", new AbortController().signal);
  expect(result).toEqual({ type: "chat", content: "ok" });
  expect(modelCalls - before).toBe(1);
  expect(modelHeaders).toMatchObject({ authorization: "Bearer draft-key", "openai-organization": "org-fixture", "openai-project": "project-fixture", "x-deployment": "fixture" });
  expect(modelPayload).toMatchObject({ temperature: 0.25, top_p: 0, seed: 0, vendor: { enabled: false } });
  expect(JSON.stringify(modelPayload)).not.toContain("draft-key");
});
