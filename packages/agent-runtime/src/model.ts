import { logHeaders } from "@ontomato/service-logging";
import { runtimeLogger, runtimeFailureMessage } from "./logging";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CHAT_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_RETRIES, DEFAULT_MODEL_TIMEOUT_SECONDS,
  type ModelConnection, type ModelEntry, type ModelEntryEmbedding, type ModelProvider,
} from "@ontomato/contracts/model-settings";
import type { Model, Message, AssistantMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { streamSimple as chatClient } from "@earendil-works/pi-ai/api/openai-completions";
import { RuntimeStore, type Scope } from "./store";
import type { StreamFn } from "./core/pi/types";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

/** One model as the gateway calls it: LiteLLM's own entry, with everything the runtime resolved. */
export interface LitellmEntry {
  litellm_params: {
    /** The provider prefix that decides how LiteLLM reaches the upstream, then the upstream's model name. */
    model: string;
    api_base?: string;
    api_key: string;
    extra_headers?: Record<string, string>;
    /** Seconds, as LiteLLM takes them. */
    timeout: number;
    max_retries: number;
    temperature?: number;
    top_p?: number;
  };
  model_info: {
    mode: "chat" | "embedding";
    max_input_tokens?: number;
    max_output_tokens?: number;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    dimensions?: number;
  };
}

/** A domain model, resolved from its connection, as the gateway needs it. */
interface ResolvedBase {
  /** The public name callers use; the lease's key and the gateway request's `model`. */
  name: string;
  connection: string;
  provider: ModelProvider;
  upstream: string;
  apiBase?: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
  timeoutSeconds: number;
  maxRetries: number;
  temperature?: number;
  topP?: number;
}

export interface ResolvedChatModel extends ResolvedBase {
  type: "chat";
  /** The length the loop plans against; 256k applies when the model sets none. */
  contextWindow: number;
  /** Unset sends no output limit at all, leaving the upstream's own default. */
  maxOutputTokens?: number;
  supportsVision: boolean;
  supportsReasoning: boolean;
}

export interface ResolvedEmbeddingModel extends ResolvedBase {
  type: "embedding";
  dimensions: number;
}

export type ResolvedModel = ResolvedChatModel | ResolvedEmbeddingModel;

/** The data-plane address one lease may call, and the token that identifies it there. */
export interface ModelLease {
  id: string;
  url: string;
  token: string;
}

/** The resolved shape of one entry: its type decides whether it has a context length or dimensions. */
export type ResolvedOf<M extends ModelEntry> = M extends ModelEntryEmbedding ? ResolvedEmbeddingModel : ResolvedChatModel;

/** A stored model and the connection it calls through, flattened into what the gateway is given. */
export function resolvedModel<M extends ModelEntry>(name: string, connectionName: string,
  connection: ModelConnection, model: M): ResolvedOf<M> {
  const base: ResolvedBase = {
    name, connection: connectionName, provider: connection.provider, upstream: model.model,
    ...(connection.apiBase ? { apiBase: connection.apiBase } : {}),
    apiKey: connection.apiKey,
    ...(connection.extraHeaders ? { extraHeaders: connection.extraHeaders } : {}),
    timeoutSeconds: model.timeoutSeconds ?? DEFAULT_MODEL_TIMEOUT_SECONDS,
    maxRetries: model.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES,
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.topP === undefined ? {} : { topP: model.topP }),
  };
  if (model.type === "embedding")
    return { ...base, type: "embedding", dimensions: model.dimensions } as ResolvedOf<M>;
  return {
    ...base, type: "chat",
    contextWindow: model.contextWindow ?? DEFAULT_CHAT_CONTEXT_WINDOW,
    ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
    supportsVision: model.supportsVision === true,
    supportsReasoning: model.supportsReasoning === true,
  } as ResolvedOf<M>;
}

export function litellmEntry(model: ResolvedModel): LitellmEntry {
  return {
    litellm_params: {
      model: `${model.provider}/${model.upstream}`,
      ...(model.apiBase ? { api_base: model.apiBase } : {}),
      api_key: model.apiKey,
      ...(model.extraHeaders ? { extra_headers: model.extraHeaders } : {}),
      timeout: model.timeoutSeconds,
      max_retries: model.maxRetries,
      ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
      ...(model.topP === undefined ? {} : { top_p: model.topP }),
    },
    model_info: model.type === "embedding"
      ? { mode: "embedding", dimensions: model.dimensions }
      : {
        mode: "chat",
        max_input_tokens: model.contextWindow,
        ...(model.maxOutputTokens === undefined ? {} : { max_output_tokens: model.maxOutputTokens }),
        ...(model.supportsVision ? { supports_vision: true } : {}),
        ...(model.supportsReasoning ? { supports_reasoning: true } : {}),
      },
  };
}

/**
 * pi's client view of a leased model: the standard Chat API at the gateway, addressed by the public name. The lease
 * token is the only credential the loop holds; timeout and retries belong to the gateway, so nothing is retried here.
 */
export function piModel(model: ResolvedChatModel, lease: ModelLease): Model<"openai-completions"> {
  return {
    id: model.name,
    name: model.name,
    api: "openai-completions",
    provider: "ontomato",
    baseUrl: `${lease.url}/v1`,
    input: model.supportsVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? DEFAULT_CHAT_CONTEXT_WINDOW,
    // A zero cap is how pi sends no output limit; the upstream's own default then applies.
    maxTokens: model.maxOutputTokens ?? 0,
    reasoning: model.supportsReasoning,
  };
}

export function modelStream(
  config: ResolvedChatModel,
  lease: ModelLease,
  store: RuntimeStore,
  scope: Scope,
  runId: string,
  correlationId: string,
  purpose: "conversation" | "compaction",
  language = "en",
): StreamFn {
  return (model, context, options) => {
    const start = Date.now();
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const response = await chatClient(model as Model<"openai-completions">, context, {
          ...options,
          apiKey: lease.token,
          maxRetries: 0,
          headers: { ...logHeaders(), "X-Correlation-Id": correlationId },
        });
        for await (const event of response) {
          if (event.type !== "error") {
            stream.push(event);
            continue;
          }
          if (event.reason === "error")
            runtimeLogger.error("model provider failed", { errorMessage: event.error.errorMessage });
          stream.push({ ...event, error: {
            ...event.error,
            // No tool from an interrupted response has been dispatched.
            content: event.error.content.filter(part => part.type !== "toolCall"),
            errorMessage: event.reason === "error" ? runtimeFailureMessage(event.error.errorMessage, language) : "Request was aborted",
          } });
        }
      } catch (error) {
        // Provider text can echo request bodies; keep it in the log and expose only readable text and HTTP status.
        runtimeLogger.error("model stream failed", { errorMessage: error instanceof Error ? error.message : String(error) });
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const failed: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, usage, stopReason: "error",
          errorMessage: runtimeFailureMessage(error, language), timestamp: Date.now() };
        stream.push({ type: "error", reason: "error", error: failed });
      }
    })();
    const result = stream.result.bind(stream);
    let logged: Promise<AssistantMessage> | undefined;
    stream.result = () =>
      (logged ??= result().then(async (message) => {
        runtimeLogger.info("model call completed", { kind: "downstream", target: "model-gateway",
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
              connection: config.connection,
              provider: config.provider,
              model: config.name,
              upstream: config.upstream,
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
    // Older persisted responses can contain calls whose arguments were still streaming.
    // The provider omits failed assistant messages, so they must never gain tool results.
    if (message.role === "assistant" && (message.stopReason === "aborted" || message.stopReason === "error")) {
      result.push({ ...message, content: message.content.filter(part => part.type !== "toolCall") });
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
