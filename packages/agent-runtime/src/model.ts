import { logHeaders } from "@ontomato/service-logging";
import { runtimeLogger } from "./logging";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Model,
  Message,
  AssistantMessage,
  AssistantMessageEvent,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { RuntimeError } from "./errors";
import { RuntimeStore, type Scope } from "./store";
import type { StreamFn } from "./core/pi/types";

import { runtimeModelConfigurationSchema as modelSchema } from "@ontomato/contracts/runtime-model-test";
import { createAssistantMessageEventStream, normalizeContext } from "@earendil-works/pi-ai";

export type ResolvedModel = z.infer<typeof modelSchema> & { apiKey: string };

export function piModel(config: ResolvedModel): Model<"openai-completions"> {
  // The saved configuration describes an OpenAI-compatible endpoint; do not guess protocols.
  return {
    id: config.modelName,
    name: config.name,
    api: "openai-completions",
    provider: "configured",
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text", "image"],
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/** Retries when the model setting leaves them unset; one dropped connection should not end a run. */
const DEFAULT_MODEL_RETRIES = 3;

/**
 * pi-ai retries a request that fails before the response starts (connection errors, 429, 5xx).
 * A stream that breaks after the response starts but before any content was emitted is issued
 * again here; once content has reached the caller, a repeat would duplicate it, so the error
 * stands. Records omit credentials and payloads.
 */
export function modelStream(
  config: ResolvedModel,
  store: RuntimeStore,
  scope: Scope,
  runId: string,
  correlationId: string,
  purpose: "conversation" | "compaction",
): StreamFn {
  return (model, context, options) => {
    const start = Date.now();
    const retries = config.maxRetries ?? DEFAULT_MODEL_RETRIES;
    const request = () => streamSimple(model as Model<"openai-completions">, context, {
      ...options,
      apiKey: config.apiKey || "unused",
      timeoutMs: config.timeout
        ? parseIsoDurationSeconds(config.timeout) * 1000
        : undefined,
      maxRetries: retries,
      maxTokens: options?.maxTokens ?? config.maxTokens,
      headers: { ...logHeaders(), ...modelHeaders(config, correlationId) },
      onPayload: (payload) => modelPayload(config, payload),
    });
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          // "start" carries no content, so it is held until the first content event arrives.
          let held: AssistantMessageEvent | null = null;
          let emitted = false;
          let retry = false;
          for await (const event of request()) {
            if (!emitted && event.type === "start") { held = event; continue; }
            if (!emitted && event.type === "error" && event.reason === "error"
              && attempt < retries && !options?.signal?.aborted) {
              runtimeLogger.warn("model stream failed before content; retrying", { kind: "downstream",
                target: "model-provider", attempt: attempt + 1, errorMessage: event.error.errorMessage });
              retry = true;
              break;
            }
            if (!emitted && held) stream.push(held);
            emitted = true;
            stream.push(event);
          }
          if (!retry) return;
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
      } catch (error) {
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const failed: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, usage, stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now() };
        stream.push({ type: "error", reason: "error", error: failed });
      }
    })();
    const result = stream.result.bind(stream);
    let logged: Promise<AssistantMessage> | undefined;
    stream.result = () =>
      (logged ??= result().then(async (message) => {
        runtimeLogger.info("model call completed", { kind: "downstream", target: "model-provider",
          durationMs: Date.now() - start, outcome: message.stopReason === "error" ? "failure" : message.stopReason === "aborted" ? "cancelled" : "success" });
        await store.pool.query(
          `INSERT INTO ${store.table("model_calls")} VALUES($1,$2,$3,$4,$5)`,
          [
            randomUUID(),
            scope.hostId,
            scope.domainId,
            runId,
            {
              purpose,
              provider: model.provider,
              model: model.id,
              api: model.api,
              correlationId,
              startedAt: new Date(start).toISOString(),
              durationMs: Date.now() - start,
              usage: message.usage,
              outcome: message.stopReason,
            },
          ],
        );
        return message;
      }));
    return stream;
  };
}

export async function completeSummary(
  stream: StreamFn,
  model: Model<"openai-completions">,
  context: TranscriptContext,
  signal: AbortSignal,
  maxTokens?: number,
) {
  const response = await stream(model, context, { signal, maxTokens });
  for await (const _event of response) {
    signal.throwIfAborted();
  }
  const message = await response.result();
  if (message.stopReason === "error" || message.stopReason === "aborted")
    throw new Error("Compaction model call failed");
  const summary = message.content
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n");
  if (!summary.trim()) throw new Error("Compaction returned an empty summary");
  return summary;
}

export function recoverContext(messages: Message[]): Message[] {
  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (
      message.role === "assistant" &&
      (message as unknown as { origin?: string }).origin === "runtime"
    ) {
      result.push({
        role: "user",
        content: `Runtime notice: ${message.errorMessage ?? message.stopReason}`,
        timestamp: message.timestamp,
      });
      continue;
    }
    result.push(message);
    if (message.role !== "assistant") continue;
    const answered = new Set<string>();
    while (messages[i + 1]?.role === "toolResult") {
      const answer = messages[++i]! as Extract<Message, { role: "toolResult" }>;
      answered.add(answer.toolCallId);
      result.push(answer);
    }
    for (const part of message.content)
      if (part.type === "toolCall" && !answered.has(part.id))
        result.push({
          role: "toolResult",
          toolCallId: part.id,
          toolName: part.name,
          isError: true,
          timestamp: message.timestamp,
          content: [
            {
              type: "text",
              text: "Execution ended before its result was recorded. Its external outcome is unknown. Do not repeat this action automatically.",
            },
          ],
        });
  }
  return result;
}

/** The same provider mapping serves saved models and unsaved connection tests. */
export function modelHeaders(config: ResolvedModel, correlationId: string) {
  return {
    ...(config.organizationId ? { "OpenAI-Organization": config.organizationId } : {}),
    ...(config.projectId ? { "OpenAI-Project": config.projectId } : {}),
    ...config.customHeaders,
    "X-Correlation-Id": correlationId,
  };
}

export function modelPayload(config: ResolvedModel, payload: unknown) {
  const result = { ...(payload as Record<string, unknown>) };
  const fields = {
    temperature: config.temperature, top_p: config.topP, stop: config.stop,
    max_completion_tokens: config.maxCompletionTokens,
    presence_penalty: config.presencePenalty, frequency_penalty: config.frequencyPenalty,
    logit_bias: config.logitBias, seed: config.seed, user: config.user,
    parallel_tool_calls: config.parallelToolCalls, store: config.store,
    metadata: config.metadata, service_tier: config.serviceTier,
    reasoning_effort: config.reasoningEffort,
    response_format: config.responseFormat ? { type: config.responseFormat } : undefined,
  };
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined) result[key] = value;
  return { ...result, ...config.customRequestParameters };
}

/** One request, no agent session, persisted draft, model-call record or retry. */
export async function testModel(config: ResolvedModel, prompt: string, correlationId: string, signal: AbortSignal) {
  const stream = streamSimple(piModel(config), normalizeContext({
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }), {
    signal,
    apiKey: config.apiKey || "unused",
    maxRetries: 0,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeout ? parseIsoDurationSeconds(config.timeout) * 1000 : 30000,
    headers: modelHeaders(config, correlationId),
    onPayload: (payload) => modelPayload(config, payload),
  });
  for await (const _event of stream) signal.throwIfAborted();
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted")
    throw new RuntimeError(502, "MODEL_TEST_FAILED", "Model connection test failed");
  return { content: message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") };
}
