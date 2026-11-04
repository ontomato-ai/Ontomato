import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer } from "node:http";
import { discoverModels, embedTexts } from "../model-provider";
import { resolveModel } from "../model";
import { defaultModelRetry } from "../model-migration";
let baseUrl = "", observed: unknown, calls = 0;
const server = createServer(async (req, res) => {
  calls++;
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (req.url?.endsWith("/embeddings")) {
    observed = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] }));
  } else if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "chat" }], has_more: true, last_id: "chat" }));
  } else if (req.url === "/v1/models?after_id=chat" || req.url === "/v1/models?after=chat") {
    res.end(JSON.stringify({ data: [{ id: "embed" }], has_more: false }));
  } else if (req.url === "/v1beta/models") {
    res.end(JSON.stringify({ models: [{ name: "models/gemini", displayName: "Gemini" }] }));
  } else { res.writeHead(401); res.end("secret-provider-message"); }
});
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0,"127.0.0.1",r));
  baseUrl = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
it("keeps Java's OpenAI dimensions/input payload and orders vectors by input index", async () => {
  const config = resolveModel("gateway", { api: "openai-completions", apiKey: "key", baseUrl: baseUrl + "/v1" },
    { id: "embed", type: "embedding", dimensions: 2 }, defaultModelRetry());
  expect(await embedTexts(config,["first","second"])).toEqual({ modelId: "gateway/embed", dimensions: 2, vectors: [[1,2],[3,4]] });
  expect(observed).toEqual({ model: "embed", input: ["first","second"], dimensions: 2 });
  await expect(embedTexts({ ...config, dimensions: 3 }, ["first","second"])).rejects.toMatchObject({ code: "MODEL_EMBEDDING_FAILED" });
});
it("lists all pages for OpenAI and Anthropic and normalizes Gemini model names", async () => {
  for (const api of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const) {
    const result = await discoverModels({ providerId: "gateway", provider: { api, apiKey: "key", baseUrl: baseUrl + (api === "google-generative-ai" ? "/v1beta" : "/v1") }, retry: defaultModelRetry() });
    expect(result.models.map(m => m.id)).toEqual(api === "google-generative-ai" ? ["gemini"] : ["chat","embed"]);
  }
});
it("reports discovery failures without returning an empty list or leaking provider response text", async () => {
  const before = calls;
  await expect(discoverModels({ providerId:"gateway", provider:{api:"openai-completions",apiKey:"key",baseUrl:baseUrl+"/wrong"},retry:defaultModelRetry() }))
    .rejects.toMatchObject({code:"MODEL_DISCOVERY_FAILED",message:"Model provider returned HTTP 401"});
  expect(calls-before).toBe(1);
});
