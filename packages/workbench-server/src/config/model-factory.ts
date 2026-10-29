import { ChatOpenAI } from "@langchain/openai";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import type { ModelRole } from "@ontomato/contracts/model-settings";
import { useApproximateTokenCounter } from "../utils/langchain-token-counter.js";
import {
  createChatCompletionsOverrideFetch,
  createEmptyChatStreamError,
} from "../utils/chat-completions-body-override.js";
import { resolveModelForRole } from "./model-resolver";


export type ModelOptions = {
  role?: ModelRole;
  baseURL?: string;
  modelName?: string;
  temperature?: number;
  agentName?: string;
  agentRunId?: string;
  stream?: boolean;
};

export async function createModel(opts?: number | ModelOptions): Promise<ChatOpenAI> {
  const options: ModelOptions = typeof opts === "number" ? { temperature: opts } : (opts ?? {});
  const entry = await resolveModelForRole(options.role ?? "general");

  const temperature = options.temperature ?? 0;
  // Custom parameters override the final Chat Completions body at the fetch
  // boundary, so they are never passed as modelKwargs for the SDK to reinterpret.
  const overrideFetch = createChatCompletionsOverrideFetch(entry.customRequestParameters);

  const model = useApproximateTokenCounter(
    new ChatOpenAI({
      model: options.modelName || entry.modelName,
      configuration: {
        baseURL: options.baseURL || entry.baseUrl,
        apiKey: entry.apiKey,
        defaultHeaders: {
          "Content-Type": "application/json",
        },
        ...(overrideFetch ? { fetch: overrideFetch } : {}),
      },
      temperature,
      maxTokens: entry.maxTokens,
      ...(entry.maxRetries !== undefined ? { maxRetries: entry.maxRetries } : {}),
      ...(entry.timeoutSeconds !== undefined ? { timeout: entry.timeoutSeconds * 1000 } : {}),
    })
  );

  // A normally-ended stream without any chunk is an error on every path.
  // Args (including abort signals) pass through; an early consumer break or
  // an SDK error skips the check, preserving break/cancel semantics.
  const guardStream = model.stream.bind(model);
  model.stream = async function wrappedEmptyGuard(...args: Parameters<typeof guardStream>) {
    const stream = await guardStream(...args);
    return IterableReadableStream.fromAsyncGenerator(
      (async function* () {
        let chunkCount = 0;
        for await (const chunk of stream) {
          chunkCount += 1;
          yield chunk;
        }
        if (chunkCount === 0) throw createEmptyChatStreamError();
      })()
    );
  };

  return model;
}
