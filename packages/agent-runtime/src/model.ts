import { logHeaders } from "@ontomato/service-logging";
import { runtimeLogger } from "./logging";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Model,
  Message,
  AssistantMessage,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { openSealedModelKey } from "@ontomato/contracts/model-key-seal";
import { RUNTIME_MODEL_NOT_CONFIGURED } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { RuntimeError } from "./errors";
import { RuntimeStore, type Scope } from "./store";
import type { StreamFn } from "./core/pi/types";

import { runtimeModelConfigurationSchema as modelSchema, runtimeModelTestRequestSchema } from "@ontomato/contracts/runtime-model-test";
import { normalizeContext } from "@earendil-works/pi-ai";

export type ResolvedModel = z.infer<typeof modelSchema> & { apiKey: string };

/** Temporary migration adapter. Remove after Java model configuration ownership is migrated. */
export async function resolveModel(options: {
  baseUrl: string;
  runtimeToken?: string;
  request: RuntimeStartRunRequest;
  correlationId: string;
  signal: AbortSignal;
}): Promise<ResolvedModel> {
  const credential = options.request.modelCredential;
  const headers: Record<string, string> = {
    ...logHeaders(),
    "X-Correlation-Id": options.correlationId,
    "X-Ontomato-Run-Id": options.correlationId,
  };
  if (credential.kind !== "none")
    headers[credential.kind === "token" ? "tk" : "X-API-Key"] =
      credential.value;
  const response = await fetch(
    `${options.baseUrl.replace(/\/$/, "")}/businessConfig/getModelSettings`,
    { headers, signal: options.signal },
  );
  if (!response.ok)
    throw new Error(`Model configuration read failed (${response.status})`);
  const body = z
    .object({
      success: z.boolean(),
      data: z
        .object({
          agents: z.record(
            z.object({ model: z.string().nullable() }).passthrough(),
          ),
          models: z.array(modelSchema),
          sealedApiKeys: z.record(z.array(z.string())),
        })
        .optional(),
    })
    .parse(await response.json());
  if (!body.success || !body.data)
    throw new Error("Model configuration read was rejected");
  const name = body.data.agents[options.request.definition.modelRole]?.model;
  if (!name)
    throw new RuntimeError(
      422,
      RUNTIME_MODEL_NOT_CONFIGURED,
      "No model is configured for this role",
    );
  const resolved = body.data.models.find((m) => m.name === name);
  if (!resolved)
    throw new Error("Model role references a missing model configuration");
  const sealed = body.data.sealedApiKeys[resolved.name]?.[0];
  return {
    ...resolved,
    apiKey: sealed ? openSealedModelKey(sealed, options.runtimeToken) : "",
  };
}

export function piModel(config: ResolvedModel): Model<"openai-completions"> {
  // The existing Java configuration describes an OpenAI-compatible endpoint; do not guess protocols.
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

/** pi-ai owns transport/retry behavior (including 429); records omit credentials and payloads. */
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
    const stream = streamSimple(model as Model<"openai-completions">, context, {
      ...options,
      apiKey: config.apiKey || "unused",
      timeoutMs: config.timeout
        ? parseIsoDurationSeconds(config.timeout) * 1000
        : undefined,
      maxRetries: config.maxRetries,
      maxTokens: options?.maxTokens ?? config.maxTokens,
      headers: { ...logHeaders(), "X-Correlation-Id": correlationId },
      onPayload: (payload) => ({
        ...(payload as Record<string, unknown>),
        ...(config.temperature === undefined
          ? {}
          : { temperature: config.temperature }),
        ...(config.topP === undefined ? {} : { top_p: config.topP }),
        ...config.customRequestParameters,
      }),
    });
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
export async function testModel(input: unknown, correlationId: string, signal: AbortSignal) {
  const { model: config, prompt } = runtimeModelTestRequestSchema.parse(input);
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
