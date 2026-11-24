import {
  DEFAULT_CHAT_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_RETRIES, DEFAULT_MODEL_TIMEOUT_SECONDS,
  type ModelConnection, type ModelEntry, type ModelEntryEmbedding, type ModelProvider,
} from "@ontomato/contracts/model-settings";

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
