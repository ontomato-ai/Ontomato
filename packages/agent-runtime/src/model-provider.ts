import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelRetry } from "@ontomato/contracts/model-settings";
import type { RuntimeModelDiscoveryRequest } from "@ontomato/contracts/runtime-model-test";
import { runtimeEmbeddingsResponseSchema } from "@ontomato/contracts/runtime-embeddings";
import { RuntimeError } from "./errors";
import type { ResolvedModel } from "./model";

async function providerJson(url: string, init: NonNullable<Parameters<typeof fetch>[1]>, retry: ModelRetry, code: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let wait: number;
    try {
      const timeout = AbortSignal.timeout(retry.provider.timeoutMs);
      const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (response.ok) return await response.json();
      if (attempt >= retry.provider.maxRetries || (response.status !== 429 && response.status < 500))
        throw new RuntimeError(502, code, `Model provider returned HTTP ${response.status}`);
      const after = response.headers.get("retry-after");
      wait = after ? (/^\d+(\.\d+)?$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now())) : 1000 * (attempt + 1);
      await response.body?.cancel();
      if (!Number.isFinite(wait) || (retry.provider.maxRetryDelayMs > 0 && wait > retry.provider.maxRetryDelayMs))
        throw new RuntimeError(502, code, "Model provider retry delay exceeds the configured limit");
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if (signal?.aborted) throw signal.reason;
      if (attempt >= retry.provider.maxRetries) throw new RuntimeError(502, code, "Model provider request failed");
      wait = 1000 * (attempt + 1);
    }
    await delay(wait, undefined, { signal });
  }
}
const embeddingsSchema = z.object({ data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) })) });
export async function embedTexts(config: ResolvedModel, texts: string[], signal?: AbortSignal, test = false) {
  const code = test ? "MODEL_TEST_FAILED" : "MODEL_EMBEDDING_FAILED";
  // The previous Java OpenAI request always supplied dimensions, including for non-OpenAI gateways.
  const raw = await providerJson(config.baseUrl.replace(/\/$/, "") + "/embeddings", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, ...config.headers },
    body: JSON.stringify({ model: config.id, input: texts, dimensions: config.dimensions }),
  }, test ? { provider: { ...config.retry.provider, maxRetries: 0 } } : config.retry, code, signal);
  const parsed = embeddingsSchema.safeParse(raw);
  if (!parsed.success) throw new RuntimeError(502, code, "Invalid embedding response");
  const rows = parsed.data.data.sort((a, b) => a.index - b.index);
  if (rows.length !== texts.length || rows.some((r, index) => r.index !== index))
    throw new RuntimeError(502, code, "Embedding response does not match the input batch");
  const response = runtimeEmbeddingsResponseSchema.safeParse({ modelId: `${config.provider}/${config.id}`,
    dimensions: config.dimensions, vectors: rows.map(r => r.embedding) });
  if (!response.success) throw new RuntimeError(502, code, "Embedding dimensions do not match the configuration");
  return response.data;
}
const catalogSchema = z.object({ data: z.array(z.object({ id: z.string().min(1), display_name: z.string().optional() })),
  has_more: z.boolean().optional(), last_id: z.string().optional() });
const googleCatalogSchema = z.object({ models: z.array(z.object({ name: z.string().min(1), displayName: z.string().optional() })), nextPageToken: z.string().optional() });
export async function discoverModels(draft: RuntimeModelDiscoveryRequest, signal?: AbortSignal) {
  const { provider, retry } = draft;
  const google = provider.api === "google-generative-ai", anthropic = provider.api === "anthropic-messages";
  const base = provider.baseUrl.replace(/\/$/, "");
  const endpoint = google || anthropic ? base.replace(/\/v\d+(?:beta\d*)?$/, "") + (google ? "/v1beta/models" : "/v1/models") : base + "/models";
  const headers = { ...(google ? { "x-goog-api-key": provider.apiKey } : anthropic
    ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${provider.apiKey}` }), ...provider.headers };
  const models: { id: string; name?: string }[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set(google ? "pageToken" : anthropic ? "after_id" : "after", cursor);
    const raw = await providerJson(url.toString(), { headers }, retry, "MODEL_DISCOVERY_FAILED", signal);
    if (google) {
      const page = googleCatalogSchema.safeParse(raw);
      if (!page.success) throw new RuntimeError(502, "MODEL_DISCOVERY_FAILED", "Invalid Gemini model list");
      models.push(...page.data.models.map(m => ({ id: m.name.replace(/^models\//, ""), name: m.displayName })));
      cursor = page.data.nextPageToken;
    } else {
      const page = catalogSchema.safeParse(raw);
      if (!page.success) throw new RuntimeError(502, "MODEL_DISCOVERY_FAILED", "Invalid provider model list");
      models.push(...page.data.data.map(m => ({ id: m.id, name: m.display_name })));
      cursor = page.data.has_more ? page.data.last_id ?? page.data.data.at(-1)?.id : undefined;
      if (page.data.has_more && !cursor) throw new RuntimeError(502, "MODEL_DISCOVERY_FAILED", "Missing model-list cursor");
    }
    if (cursor && seen.has(cursor)) throw new RuntimeError(502, "MODEL_DISCOVERY_FAILED", "Repeated model-list cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { models };
}
