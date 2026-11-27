import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  call, config, invoke, createBashToolDefinition, createEditToolDefinition,
  createReadToolDefinition, createWriteToolDefinition,
} from "./import.mjs";

const inputType = "ontomato.input";
const unknownText = "Execution ended before its result was recorded. Its external outcome is unknown. Do not repeat this action automatically.";
const text = value => ({ type: "text", text: value });

export default function (pi) {
  const { model, directories, definition } = config;
  pi.registerProvider("ontomato", {
    baseUrl: model.baseUrl,
    api: "openai-completions",
    apiKey: model.token,
    models: [{
      id: model.model, name: model.model, type: "chat", reasoning: true, input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxOutputTokens ?? Math.min(16384, model.contextWindow),
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true },
    }],
  });

  pi.on("before_provider_request", ({ payload }) => {
    if (model.maxOutputTokens === null) {
      delete payload.max_tokens;
      delete payload.max_completion_tokens;
    }
  });

  const calls = new Map();
  let assistantId;
  let messageSequence = 0;

  // Send ordered lifecycle events on the same channel as the awaited tool
  // hooks. RPC stdout repeats them and is used for settlement and diagnostics.
  pi.on("turn_start", () => call("event", { type: "turn_start" }));
  pi.on("turn_end", () => call("event", { type: "turn_end" }));
  for (const eventType of ["message_start", "message_update", "message_end"]) {
    pi.on(eventType, async (event, ctx) => {
      const { message } = event;
      if (message.role === "assistant") {
        if (eventType === "message_start") assistantId = `${ctx.sessionManager.getSessionId()}:message:${++messageSequence}`;
        if (eventType === "message_update") {
          const change = event.assistantMessageEvent;
          const { type, contentIndex, delta, reason, content, toolCall } = change;
          const callStart = type === "toolcall_start" ? change.partial.content[contentIndex] : undefined;
          await call("event", {
            type: eventType, nativeId: assistantId,
            assistantMessageEvent: { type, contentIndex, delta, reason, content, toolCall, id: callStart?.id, toolName: callStart?.name },
          });
        } else {
          await call("event", { type: eventType, nativeId: assistantId, message });
        }
      } else if (message.role === "toolResult") {
        const record = calls.get(message.toolCallId);
        if (!record.unknown) await call("event", { ...event, nativeId: `tool-result:${message.toolCallId}` });
      }
    });
  }
  for (const tool of definition.tools) {
    pi.registerTool({
      ...tool, label: tool.name, executionMode: "sequential",
      async execute(toolCallId, args, signal, onUpdate, ctx) {
        const result = await invoke(
          { toolCallId, toolName: tool.name, args }, signal,
          update => onUpdate?.({ content: [text(update.text)], structuredContent: update.data }),
        );
        calls.get(toolCallId).platformResult = result;
        if (result === null) ctx.abort();
        return result === null
          ? { content: [text(unknownText)] }
          : { content: result.result.content, structuredContent: result.result.details.data };
      },
    });
  }

  if (definition.engineTools) {
    const cwd = directories.workspace;
    for (const tool of [
      createReadToolDefinition(cwd),
      createBashToolDefinition(cwd, {
        exposeSessionEnvironment: false,
        spawnHook(context) {
          const env = { ...context.env };
          delete env.ONTOMATO_RUN_ID;
          try {
            const runId = readFileSync(join(directories.state, "ontomato-run-id"), "utf8").trim();
            if (runId) env.ONTOMATO_RUN_ID = runId;
          } catch {}
          return { ...context, env };
        },
      }),
      createEditToolDefinition(cwd),
      createWriteToolDefinition(cwd),
    ]) pi.registerTool({ ...tool, executionMode: "sequential" });
  }

  const pendingInputs = new Set();
  pi.on("input", async (event, ctx) => {
    if (event.source !== "rpc") return;
    const input = JSON.parse(event.text);
    if (input.type === "steer") {
      const accepted = event.streamingBehavior !== undefined && !ctx.signal?.aborted;
      if (accepted) {
        pendingInputs.add(input.id);
        pi.sendMessage({
          customType: inputType, display: false, content: input.content, details: { ids: [input.id] },
        }, { triggerTurn: true, deliverAs: "steer" });
      }
      await call("steer", { id: input.id, accepted });
    } else if (input.type === "startTurn") {
      for (const id of input.ids) pendingInputs.add(id);
      pi.sendMessage({
        customType: inputType, display: false, content: input.content, details: { ids: input.ids },
      }, { triggerTurn: true });
    } else {
      throw new Error("Unknown PI input");
    }
    return { action: "handled" };
  });

  pi.on("context", async ({ messages }, ctx) => {
    if (ctx.signal?.aborted) return;
    const ids = messages.flatMap(message =>
      message.role === "custom" && message.customType === inputType
        ? message.details.ids.filter(id => pendingInputs.delete(id))
        : [],
    );
    if (ids.length) await call("consume", ids);
  });
  pi.on("agent_settled", () => {
    pendingInputs.clear();
    calls.clear();
  });

  pi.on("tool_execution_start", event => {
    calls.set(event.toolCallId, {
      toolCallId: event.toolCallId, toolName: event.toolName, args: event.args,
      started: false, settled: false,
    });
  });
  pi.on("tool_call", async (event, ctx) => {
    const record = calls.get(event.toolCallId);
    record.args = event.input;
    record.started = true;
    const { allowed } = await call("toolStart", toolCall(record));
    record.dispatched = allowed;
    if (!allowed) {
      ctx.abort();
      return { block: true, reason: "The turn was interrupted" };
    }
  });
  pi.on("tool_result", async (event, ctx) => {
    const record = calls.get(event.toolCallId);
    const result = record.platformResult === undefined
      ? {
          result: { content: event.content, details: { data: event.structuredContent } },
          isError: record.dispatched && event.isError && ctx.signal?.aborted ? null : event.isError,
        }
      : record.platformResult ?? { result: { content: [text(unknownText)], details: {} }, isError: null };
    await call("toolEnd", { ...toolCall(record), ...result });
    record.settled = true;
    record.unknown = result.isError === null;
    return {
      content: result.isError === null ? [text(unknownText)] : result.result.content,
      structuredContent: result.result.details.data,
      isError: result.isError ?? true,
    };
  });
  pi.on("tool_execution_update", event => {
    const output = event.partialResult.content.filter(part => part.type === "text").map(part => part.text).join("");
    return call("toolUpdate", {
      toolCallId: event.toolCallId,
      partialResult: { text: output, data: event.partialResult.structuredContent },
    });
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    const record = calls.get(event.toolCallId);
    if (record.settled) return;
    // Validation failures can bypass both execution hooks. PI still ends them
    // before proceeding, so report the pair here without authorizing an action.
    if (!record.started) await call("toolStart", toolCall(record));
    record.unknown = Boolean(record.dispatched && ctx.signal?.aborted);
    await call("toolEnd", {
      ...toolCall(record),
      result: { content: event.result.content, details: { data: event.result.structuredContent } },
      isError: record.unknown ? null : event.isError,
    });
  });
}

function toolCall(record) {
  return { toolCallId: record.toolCallId, toolName: record.toolName, args: record.args };
}
