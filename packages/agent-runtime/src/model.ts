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
import { RUNTIME_MODEL_NOT_CONFIGURED } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { RuntimeError } from "./errors";
import { RuntimeStore, type Scope } from "./store";
import type { StreamFn } from "./core/pi/types";

// Java serializes unset optional fields as null; preserve configured zero values.
const javaOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    schema.optional(),
  );

const modelSchema = z.object({
  name: z.string(),
  baseUrl: z.string().url(),
  modelName: z.string(),
  apiKeys: z.array(z.string()),
  maxTokens: z.number().positive(),
  contextWindow: z.number().positive(),
  timeout: javaOptional(z.string()),
  maxRetries: javaOptional(z.number().int().nonnegative()),
  temperature: javaOptional(z.number()),
  topP: javaOptional(z.number()),
  customRequestParameters: javaOptional(z.record(z.unknown())),
});
export type ResolvedModel = z.infer<typeof modelSchema>;

/** Temporary migration adapter. Remove after Java model configuration ownership is migrated. */
export async function resolveModel(options: {
  baseUrl: string;
  runtimeToken?: string;
  request: RuntimeStartRunRequest;
  correlationId: string;
  signal: AbortSignal;
}): Promise<ResolvedModel> {
  const credential = options.request.privateContext.modelCredential;
  const headers: Record<string, string> = {
    "X-Correlation-Id": options.correlationId,
  };
  if (credential.kind !== "none")
    headers[credential.kind === "token" ? "tk" : "X-API-Key"] =
      credential.value;
  if (options.runtimeToken)
    headers["X-Ontomato-Model-Runtime-Token"] = options.runtimeToken;
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
  return resolved;
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
      apiKey: config.apiKeys[0] || "unused",
      timeoutMs: config.timeout
        ? parseIsoDurationSeconds(config.timeout) * 1000
        : undefined,
      maxRetries: config.maxRetries,
      maxTokens: options?.maxTokens ?? config.maxTokens,
      headers: { "X-Correlation-Id": correlationId },
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
