import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ModelGatewayClient } from "../gateway-client";
import { litellmEntry, resolvedModel } from "../model";

/** What the runtime sends a lease, and what the data plane answers it with. */
let leased: unknown;
let revoked: string[] = [];
let embeddings: unknown;
let discovery: unknown;
let base = "";
const read = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
};
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = createServer(async (req, res) => {
  const body = await read(req);
  if (req.url === "/leases" && req.method === "POST") {
    leased = body;
    return json(res, 200, { id: "lease-1", token: "lease-token" });
  }
  if (req.url === "/leases/lease-1" && req.method === "DELETE") {
    if (req.headers.authorization) return json(res, 401, { error: { message: "The control plane takes no lease token" } });
    revoked.push("lease-1");
    res.writeHead(204);
    return res.end();
  }
  if (req.url === "/discover") return json(res, 200, { models: [{ id: "qwen-chat" }, { id: "qwen-embed" }] });
  if (req.url === "/v1/embeddings") {
    embeddings = body;
    return json(res, 200, { data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] });
  }
  if (req.url === "/v1/chat/completions") return json(res, 200, { choices: [{ message: { content: "ok" } }] });
  json(res, 404, { error: { message: "no such route" } });
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
const client = () => new ModelGatewayClient(base, base);
const connection = { provider: "custom_openai" as const, apiBase: "https://gateway.example/v1", apiKey: "upstream-key",
  extraHeaders: { "X-Deployment": "fixture" } };
const chat = (name = "qwen-chat") => resolvedModel(name, "qwen",
  { ...connection, apiKey: "******-key" }, { connection: "qwen", model: "qwen-max", type: "chat",
  contextWindow: 32000, maxOutputTokens: 2048, timeoutSeconds: 90, maxRetries: 1, temperature: 0.2, topP: 0.9,
  supportsVision: true, supportsReasoning: true });

it("hands the gateway one LiteLLM entry per model with the connection's resolved key", async () => {
  const model = chat();
  const lease = await client().lease({ [model.name]: litellmEntry(model) });
  expect(lease).toEqual({ id: "lease-1", token: "lease-token", url: base });
  expect(leased).toEqual({ models: { "qwen-chat": {
    litellm_params: { model: "custom_openai/qwen-max", api_base: "https://gateway.example/v1",
      api_key: "******-key", extra_headers: { "X-Deployment": "fixture" }, timeout: 90, max_retries: 1,
      temperature: 0.2, top_p: 0.9 },
    model_info: { mode: "chat", max_input_tokens: 32000, max_output_tokens: 2048,
      supports_vision: true, supports_reasoning: true },
  } } });
  await client().release(lease);
  expect(revoked).toEqual(["lease-1"]);
});

it("leaves out the output limit a model does not set, and carries an embedding model's dimensions", () => {
  const unlimited = resolvedModel("chat", "qwen", { ...connection, apiKey: "k" },
    { connection: "qwen", model: "qwen-max", type: "chat" });
  expect(litellmEntry(unlimited).model_info).toEqual({ mode: "chat", max_input_tokens: 262144 });
  const embedding = resolvedModel("embed", "qwen", { ...connection, apiKey: "k" },
    { connection: "qwen", model: "qwen-embed", type: "embedding", dimensions: 1024 });
  expect(litellmEntry(embedding).model_info).toEqual({ mode: "embedding", max_output_tokens: undefined, dimensions: 1024 });
});

it("tests a draft with one call and orders the batch's vectors by the input's own indexes", async () => {
  const model = chat();
  expect(await client().chat({ id: "l", token: "t", url: base }, model.name, "draft probe", "correlation", new AbortController().signal))
    .toEqual({ type: "chat", content: "ok" });
  const vectors = await client().embeddings({ id: "l", token: "t", url: base }, "qwen-embed", ["first", "second"], 2,
    new AbortController().signal);
  expect(vectors).toEqual({ modelId: "qwen-embed", dimensions: 2, vectors: [[1, 2], [3, 4]] });
  expect(embeddings).toEqual({ model: "qwen-embed", input: ["first", "second"] });
  await expect(client().embeddings({ id: "l", token: "t", url: base }, "qwen-embed", ["first", "second"], 3,
    new AbortController().signal)).rejects.toMatchObject({ code: "MODEL_EMBEDDING_FAILED" });
});

it("lists a connection's models through the gateway", async () => {
  discovery = await client().discover({ connectionName: "qwen", connection: { ...connection, apiKey: "upstream-key" } },
    new AbortController().signal);
  expect(discovery).toEqual({ models: [{ id: "qwen-chat" }, { id: "qwen-embed" }] });
});
