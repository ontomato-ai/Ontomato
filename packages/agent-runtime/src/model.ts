import { logHeaders } from "@ontomato/service-logging";
import { runtimeLogger, runtimeDiagnostic, runtimeFailureMessage } from "./logging";
import { randomUUID } from "node:crypto";
import type { ModelApi, ModelEntry, ModelProviderWrite, ModelRetry } from "@ontomato/contracts/model-settings";
import type {
  Model,
  Message,
  AssistantMessage,
  AssistantMessageEvent,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSimple as openaiCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as openaiResponses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as anthropicMessages } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as googleGenerativeAi } from "@earendil-works/pi-ai/api/google-generative-ai";
import { RuntimeError } from "./errors";
import { RuntimeStore, type Scope } from "./store";
import type { StreamFn } from "./core/pi/types";

import { createAssistantMessageEventStream, normalizeContext } from "@earendil-works/pi-ai";

export type ResolvedModel = Model<ModelApi> & { apiKey: string; retry: ModelRetry; kind: "chat" | "embedding"; dimensions?: number };
export function resolveModel(providerId: string, provider: Omit<ModelProviderWrite, "models">, model: ModelEntry, retry: ModelRetry): ResolvedModel {
  return { id: model.id, name: model.name ?? model.id, provider: providerId, api: provider.api,
    baseUrl: provider.baseUrl, headers: provider.headers, apiKey: provider.apiKey, retry, kind: model.type,
    dimensions: model.type === "embedding" ? model.dimensions : undefined,
    reasoning: model.reasoning ?? false, input: model.input ?? ["text"], contextWindow: model.contextWindow ?? 128000,
    maxTokens: model.maxTokens ?? 16384, samplingParams: model.samplingParams,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
export function piModel(config: ResolvedModel): Model<ModelApi> {
  const { apiKey: _key, retry: _retry, kind: _kind, dimensions: _dimensions, ...model } = config;
  return model;
}
const streamProvider: StreamFn = (model, context, options) => {
  switch (model.api) {
    case "openai-completions": return openaiCompletions(model as Model<"openai-completions">, context, options);
    case "openai-responses": return openaiResponses(model as Model<"openai-responses">, context, options);
    case "anthropic-messages": return anthropicMessages(model as Model<"anthropic-messages">, context, options);
    case "google-generative-ai": return googleGenerativeAi(model as Model<"google-generative-ai">, context, options);
    default: throw new RuntimeError(400, "INVALID_REQUEST", "Unsupported model API");
  }
};

/**
 * pi-ai retries requests that fail before a response (connection errors, 429, 5xx) and owns that
 * policy. The one case it cannot see is a 2xx stream that breaks before any content reached the
 * caller; only that is issued again here. Both draw on one budget of maxRetries + 1 HTTP requests,
 * counted at fetch. Records omit credentials and payloads.
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
    const budget = config.retry.provider.maxRetries + 1;
    let requests = 0;
    const baseFetch = options?.fetch ?? fetch;
    const countedFetch: typeof fetch = (input, init) => {
      requests++;
      return baseFetch(input, init);
    };
    const request = (responded: () => void) =>
      streamProvider(model, context, {
        ...options,
        apiKey: config.apiKey || "unused",
        timeoutMs: config.retry.provider.timeoutMs,
        maxRetryDelayMs: config.retry.provider.maxRetryDelayMs,
        maxRetries: Math.max(0, budget - requests - 1),
        maxTokens: options?.maxTokens ?? config.maxTokens,
        headers: { ...logHeaders(), ...modelHeaders(config, correlationId) },
        fetch: countedFetch,
        onResponse: async (response, responseModel) => {
          responded();
          await options?.onResponse?.(response, responseModel);
        },
      });
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for (let attempt = 1; ; attempt++) {
          let responded = false;
          // "start" carries no content and is held until content arrives. Its partial is the
          // provider's live message, so keep the state it had when "start" was sent.
          let held: AssistantMessageEvent | null = null;
          let emitted = false;
          let retry = false;
          for await (const event of await request(() => (responded = true))) {
            if (!emitted && event.type === "start") {
              held = { type: "start", partial: structuredClone(event.partial) };
              continue;
            }
            if (!emitted && event.type === "error" && event.reason === "error" && responded
              && requests < budget && !options?.signal?.aborted) {
              runtimeLogger.warn("model stream broke before content; retrying", { kind: "downstream",
                target: "model-provider", attempt, errorMessage: event.error.errorMessage });
              retry = true;
              break;
            }
            if (!emitted && held) stream.push(held);
            emitted = true;
            stream.push(event);
          }
          if (!retry) return;
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      } catch (error) {
        // Provider text can echo request bodies; keep it in the log and store only its class and status.
        runtimeLogger.error("model stream failed", runtimeDiagnostic(error));
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const failed: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, usage, stopReason: "error",
          errorMessage: runtimeFailureMessage(error), timestamp: Date.now() };
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
  model: Model<ModelApi>,
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

export function modelHeaders(config: ResolvedModel, correlationId: string) {
  return { ...config.headers, "X-Correlation-Id": correlationId };
}

/** One request, no agent session, persisted draft, model-call record or retry. */
export async function testModel(config: ResolvedModel, prompt: string, correlationId: string, signal: AbortSignal) {
  const stream = await streamProvider(piModel(config), normalizeContext({
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }), {
    signal,
    apiKey: config.apiKey || "unused",
    maxRetries: 0,
    maxTokens: config.maxTokens,
    timeoutMs: config.retry.provider.timeoutMs,
    headers: modelHeaders(config, correlationId),
  });
  for await (const _event of stream) signal.throwIfAborted();
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted")
    throw new RuntimeError(502, "MODEL_TEST_FAILED", "Model connection test failed");
  return { type: "chat" as const, content: message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") };
}
