import { runtimeEmbeddingsResponseSchema, type RuntimeEmbeddingsResponse } from "@ontomato/contracts/runtime-embeddings";
import type { RuntimeModelDiscoveryRequest, RuntimeModelDiscoveryResponse } from "@ontomato/contracts/runtime-model-test";
import { RuntimeError } from "./errors";
import type { LitellmEntry, ModelLease } from "./model";

/**
 * The runtime's side of the model gateway. Every model call of a domain goes through it: a lease names the models the
 * caller may use and holds their resolved parameters, and the gateway answers the three OpenAI APIs with them.
 * Nothing here retries or times out — the gateway does both from each model's own settings.
 */
export class ModelGatewayClient {
  constructor(private readonly controlUrl: string, private readonly dataUrl: string) {}

  /** One lease for one caller; it is revoked when the caller is done, cancelled calls included. */
  async lease(models: Record<string, LitellmEntry>): Promise<ModelLease> {
    const body = await this.reply(await fetch(`${this.controlUrl}/leases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    }), "MODEL_GATEWAY_FAILED") as { id: string; token: string };
    return { id: body.id, token: body.token, url: this.dataUrl };
  }

  async release(lease: ModelLease): Promise<void> {
    const response = await fetch(`${this.controlUrl}/leases/${lease.id}`, { method: "DELETE" });
    if (!response.ok) throw new RuntimeError(502, "MODEL_GATEWAY_FAILED", `Model gateway returned HTTP ${response.status}`);
  }

  /** One minimal Chat call; the answer is the model's reply text. */
  async chat(lease: ModelLease, model: string, prompt: string, correlationId: string, signal: AbortSignal) {
    const body = await this.reply(await this.call(lease, "/v1/chat/completions",
      { model, messages: [{ role: "user", content: prompt }] }, correlationId, signal), "MODEL_TEST_FAILED") as {
      choices?: { message?: { content?: string | null } }[];
    };
    return { type: "chat" as const, content: body.choices?.map(choice => choice.message?.content ?? "").join("\n") ?? "" };
  }

  async embeddings(lease: ModelLease, model: string, texts: string[], dimensions: number,
    signal: AbortSignal, code = "MODEL_EMBEDDING_FAILED"): Promise<RuntimeEmbeddingsResponse> {
    const body = await this.reply(await this.call(lease, "/v1/embeddings", { model, input: texts }, "", signal), code) as {
      data?: { index?: number; embedding?: number[] }[];
    };
    const rows = [...(body.data ?? [])].sort((a, b) => a.index! - b.index!);
    if (rows.length !== texts.length || rows.some((row, index) => row.index !== index))
      throw new RuntimeError(502, code, "Embedding response does not match the input batch");
    if (rows.some(row => row.embedding?.length !== dimensions))
      throw new RuntimeError(502, code, "Embedding dimensions do not match the configuration");
    return runtimeEmbeddingsResponseSchema.parse({ modelId: model, dimensions, vectors: rows.map(row => row.embedding) });
  }

  /** The connection's own model list, for the administrator to pick from. */
  async discover(draft: RuntimeModelDiscoveryRequest, signal: AbortSignal): Promise<RuntimeModelDiscoveryResponse> {
    return await this.reply(await fetch(`${this.controlUrl}/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection: draft.connection }),
      signal,
    }), "MODEL_DISCOVERY_FAILED") as RuntimeModelDiscoveryResponse;
  }

  private call(lease: ModelLease, path: string, body: unknown, correlationId: string, signal: AbortSignal) {
    return fetch(`${lease.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lease.token}`, "X-Correlation-Id": correlationId },
      body: JSON.stringify(body),
      signal,
    });
  }

  /** The body of a successful answer; the gateway's own error text and status otherwise. */
  private async reply(response: Response, code: string): Promise<unknown> {
    if (response.ok) return await response.json();
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new RuntimeError(response.status, code, body?.error?.message ?? `Model gateway returned HTTP ${response.status}`);
  }
}
