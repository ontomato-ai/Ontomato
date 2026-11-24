import path from "node:path";
import { z } from "zod";
import type { RuntimeAssistantMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeJsonObject, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeRunDetail } from "@ontomato/contracts/agent-runtime-details";
import type {
  HarnessAssistantMessageEvent, HarnessToolCallResult, HarnessToolPartialResult, HarnessTurnHost,
} from "../contract";
import { command, itemSchema, patch, patches, text, toolRequest } from "./items";
import type { CodexNotice } from "./transport";

const str = z.string();
const usageCount = z.object({
  inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative(),
  cacheWriteInputTokens: z.number().nonnegative().default(0), reasoningOutputTokens: z.number().nonnegative(),
}).transform(n => ({
  input: n.inputTokens, output: n.outputTokens, cacheRead: n.cachedInputTokens, cacheWrite: n.cacheWriteInputTokens,
  reasoning: n.reasoningOutputTokens, totalTokens: n.totalTokens,
}));
type Item = z.infer<typeof itemSchema>;
type Tool = { name: string; args: RuntimeJsonObject; output: string };

export class CodexEvents {
  private step = false;
  private stepHasTools = false;
  private readonly messages = new Map<string, "text" | "thinking">();
  private readonly tools = new Map<string, Tool>();
  private readonly results = new Map<string, HarnessToolCallResult>();
  private readonly consumed = new Set<string>();
  private detailNumber = 0;
  private final = false;
  failure: string | null = null;

  constructor(private readonly host: HarnessTurnHost, private readonly model: string, private readonly workspace: string) {}

  private async begin() {
    if (this.step) return;
    this.step = true;
    await this.host.emit({ type: "turn_start" });
  }

  async end() {
    if (!this.step) return;
    this.step = false;
    this.stepHasTools = false;
    await this.host.emit({ type: "turn_end" });
  }

  unsettled() {
    return [...this.tools.keys()].map(toolCallId => ({ toolCallId }));
  }

  terminal(status: string): RuntimeStopReason {
    if (status === "interrupted") return "aborted";
    if (status !== "completed" || this.failure) return "error";
    return this.final ? "stop" : "toolUse";
  }

  private assistant(stopReason: RuntimeAssistantMessage["stopReason"], content: RuntimeAssistantMessage["content"] = [],
    phase?: RuntimeAssistantMessage["phase"]): RuntimeAssistantMessage {
    return { role: "assistant", content, model: this.model, provider: "codex", api: "openai-responses",
      usage: null, stopReason, timestamp: Date.now(), ...(phase ? { phase } : {}) };
  }

  private delta(nativeId: string, assistantMessageEvent: HarnessAssistantMessageEvent) {
    return this.host.emit({ type: "message_update", nativeId, assistantMessageEvent });
  }

  private async startMessage(id: string, kind: "text" | "thinking") {
    if (this.messages.has(id)) return;
    if (this.stepHasTools && this.tools.size === 0) await this.end();
    await this.begin();
    this.messages.set(id, kind);
    await this.host.emit({ type: "message_start", nativeId: id, message: this.assistant("pending") });
    await this.delta(id, { type: kind === "text" ? "text_start" : "thinking_start", contentIndex: 0 });
  }

  private async finishMessage(id: string, kind: "text" | "thinking", value: string, phase?: RuntimeAssistantMessage["phase"]) {
    await this.startMessage(id, kind);
    await this.delta(id, kind === "text"
      ? { type: "text_end", contentIndex: 0, content: value }
      : { type: "thinking_end", contentIndex: 0, content: value });
    this.messages.delete(id);
    this.final ||= phase === "answer" && Boolean(value.trim());
    await this.host.emit({ type: "message_end", nativeId: id, message: this.assistant(
      phase === "answer" ? "stop" : "toolUse",
      [kind === "text" ? text(value) : { type: "thinking", thinking: value }], phase,
    ) });
  }

  async startTool(id: string, name: string, args: RuntimeJsonObject) {
    if (this.tools.has(id)) return;
    if (this.stepHasTools && this.tools.size === 0) await this.end();
    await this.begin();
    this.stepHasTools = true;
    const nativeId = `call:${id}`;
    const call = { type: "toolCall" as const, id, name, arguments: args };
    await this.host.emit({ type: "message_start", nativeId, message: this.assistant("pending") });
    await this.delta(nativeId, { type: "toolcall_start", contentIndex: 0, id, toolName: name });
    await this.delta(nativeId, { type: "toolcall_end", contentIndex: 0, toolCall: call });
    await this.host.emit({ type: "message_end", nativeId, message: this.assistant("toolUse", [call], "process") });
    await this.host.emit({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
    this.tools.set(id, { name, args, output: "" });
  }

  async progress(id: string, partialResult: HarnessToolPartialResult) {
    const tool = this.tools.get(id);
    if (tool) await this.host.emit({ type: "tool_execution_update", toolCallId: id, toolName: tool.name,
      args: tool.args, partialResult });
  }

  reply(id: string, result: HarnessToolCallResult) {
    this.results.set(id, result);
  }

  private async finishTool(id: string, outcome: HarnessToolCallResult, durationMs?: number | null) {
    const tool = this.tools.get(id);
    if (!tool) return;
    await this.host.emit({ type: "tool_execution_end", toolCallId: id, toolName: tool.name, ...outcome });
    const message = {
      role: "toolResult" as const, toolCallId: id, toolName: tool.name,
      content: outcome.result.content, isError: outcome.isError, timestamp: Date.now(),
      ...(durationMs == null ? {} : { durationMs }),
    };
    const nativeId = `result:${id}`;
    await this.host.emit({ type: "message_start", nativeId, message });
    await this.host.emit({ type: "message_end", nativeId, message });
    this.tools.delete(id);
  }

  private async item(item: Item, done: boolean) {
    const { id } = item;
    switch (item.type) {
      case "userMessage": {
        const clientId = str.nullish().parse(item.clientId);
        if (done && clientId && !this.consumed.has(clientId)) {
          if (this.stepHasTools && !this.tools.size) await this.end();
          this.consumed.add(clientId);
          await this.host.consumed(clientId);
        }
        break;
      }
      case "agentMessage": {
        const phase = item.phase === "commentary" ? "process" : "answer";
        if (done) await this.finishMessage(id, "text", str.parse(item.text), phase);
        else await this.startMessage(id, "text");
        break;
      }
      case "reasoning": {
        if (!done) break;
        const { summary, content } = z.object({
          summary: z.array(str).default([]), content: z.array(str).default([]),
        }).parse(item);
        const value = (summary.length ? summary : content).join("\n\n");
        if (value || this.messages.has(id)) await this.finishMessage(id, "thinking", value, "process");
        break;
      }
      case "dynamicToolCall": {
        if (done) {
          const result = this.results.get(id);
          if (result) {
            await this.finishTool(id, result, z.number().nullish().parse(item.durationMs));
            this.results.delete(id);
          }
        } else {
          const tool = toolRequest.omit({ turnId: true, callId: true }).parse(item);
          await this.startTool(id, tool.tool, tool.arguments);
        }
        break;
      }
      case "commandExecution": {
        const n = command.parse(item);
        await this.startTool(id, "exec_command", { command: n.command, cwd: n.cwd });
        if (done) await this.finishTool(id, {
          isError: n.status !== "completed",
          result: { content: [text(n.aggregatedOutput ?? "")], details: { data: {
            command: n.command, cwd: n.cwd, status: n.status, exitCode: n.exitCode ?? null,
          } } },
        }, n.durationMs);
        break;
      }
      case "fileChange": {
        const n = patch.parse(item);
        await this.startTool(id, "apply_patch", { changes: n.changes });
        if (done) {
          await this.finishTool(id, { isError: n.status !== "completed", result: {
            content: n.changes.map(change => text(change.diff)), details: { data: { status: n.status, changes: n.changes } },
          } });
          await this.fileChanges(n.changes);
        }
        break;
      }
      case "contextCompaction":
        await this.detail({ category: "compaction", key: `compaction:${id}`, scope: "run", ref: null,
          status: done ? "completed" : "started", text: done ? "Context compacted" : "Compacting context" });
        break;
      case "functionCallOutput": {
        if (!done) break;
        const name = str.parse(item.name);
        const body = z.union([str, z.array(z.object({ type: str, text: str.optional() }))]).parse(item.output);
        const shown = typeof body === "string" ? body : body.filter(part => part.type === "input_text").map(part => part.text).join("\n");
        if (shown) await this.diagnostic("info", `${name}: ${shown}`);
        break;
      }
      case "enteredReviewMode":
      case "exitedReviewMode": {
        const status = item.type === "enteredReviewMode" ? "started" : "completed";
        if (done) await this.detail({ category: "review", key: "review", scope: "run", ref: null,
          name: "Review", status, text: str.parse(item.review) || `Review ${status}` });
        break;
      }
      case "hookPrompt":
        if (done) await this.diagnostic("info", "Codex added a hook prompt");
        break;
    }
  }

  private async fileChanges(changes: z.infer<typeof patches>) {
    const operations = { add: "added", delete: "deleted", update: "modified" } as const;
    for (const change of changes) {
      const relative = path.posix.relative(this.workspace, path.posix.resolve(this.workspace, change.path));
      if (!relative || relative === ".." || relative.startsWith("../")) continue;
      const operation = operations[change.kind.type];
      await this.detail({ category: "file_change", key: `patch:${relative}`, scope: "run", ref: null,
        path: relative, operation, patch: change.diff, text: `${operation}: ${relative}` });
    }
  }

  diagnostic(level: "info" | "warning" | "error", message: string) {
    return this.detail({ category: "diagnostic", key: `diagnostic:${++this.detailNumber}`, scope: "run", ref: null,
      level, text: message, action: null });
  }

  private detail(detail: RuntimeRunDetail) {
    return this.host.emit({ type: "run_detail", detail });
  }

  async notification({ method, params }: CodexNotice) {
    switch (method) {
      case "item/started":
      case "item/completed":
        await this.item(itemSchema.parse(params.item), method === "item/completed");
        break;
      case "item/agentMessage/delta":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const { itemId, delta } = z.object({ itemId: str, delta: str }).parse(params);
        const kind = method === "item/agentMessage/delta" ? "text" : "thinking";
        await this.startMessage(itemId, kind);
        await this.delta(itemId, { type: kind === "text" ? "text_delta" : "thinking_delta", contentIndex: 0, delta });
        break;
      }
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta": {
        const { itemId, delta } = z.object({ itemId: str, delta: str }).parse(params);
        const tool = this.tools.get(itemId);
        if (tool) {
          tool.output += delta;
          await this.progress(itemId, { text: tool.output });
        }
        break;
      }
      case "item/fileChange/patchUpdated":
        await this.fileChanges(patches.parse(params.changes));
        break;
      case "item/commandExecution/terminalInteraction": {
        const { itemId, processId } = z.object({ itemId: str, processId: str }).parse(params);
        await this.diagnostic("info", `Terminal interaction for ${itemId} (process ${processId})`);
        break;
      }
      case "thread/attachment/updated": {
        const { attachmentId, attachmentType, operation } = z.object({
          attachmentId: str, attachmentType: str, operation: str,
        }).parse(params);
        await this.detail({ category: "attachment", key: `attachment:${attachmentId}`, scope: "run", ref: null,
          object: attachmentId, operation, text: `${attachmentType} attachment ${operation}` });
        break;
      }
      case "thread/settings/updated":
        await this.detail({ category: "attachment", key: "thread-settings", scope: "run", ref: null,
          object: "thread-settings", operation: "updated", text: "Thread settings updated" });
        break;
      case "hook/started":
      case "hook/completed": {
        const { id, eventName, statusMessage } = z.object({ id: str, eventName: str, statusMessage: str.nullish() }).parse(params.run);
        const status = method === "hook/started" ? "started" : "completed";
        await this.detail({ category: "hook", key: `hook:${id}`, scope: "run", ref: null,
          name: eventName, status, text: statusMessage || `${eventName} hook ${status}` });
        break;
      }
      case "model/verification": {
        const verifications = z.array(str).parse(params.verifications);
        if (verifications.length) await this.detail({ category: "model", key: "model-verification", scope: "run", ref: null,
          model: this.model, text: `Model verification: ${verifications.join(", ")}` });
        break;
      }
      case "turn/moderationMetadata":
        await this.detail({ category: "moderation", key: "moderation", scope: "run", ref: null,
          stage: "reported", reason: null, text: "Model moderation reported" });
        break;
      case "model/safetyBuffering/updated": {
        const { showBufferingUi, reasons } = z.object({ showBufferingUi: z.boolean(), reasons: z.array(str) }).parse(params);
        await this.detail({ category: "moderation", key: "safety-buffer", scope: "run", ref: null,
          stage: showBufferingUi ? "waiting" : "completed", reason: reasons.join(", ") || null,
          text: showBufferingUi ? "Model response is waiting for review" : "Model response review wait ended" });
        break;
      }
      case "thread/tokenUsage/updated": {
        const { turnId, tokenUsage } = z.object({
          turnId: str, tokenUsage: z.object({ last: usageCount, total: usageCount }),
        }).parse(params);
        await this.host.emit({ type: "usage_updated", usage: { ...tokenUsage, turn: turnId, nativeId: null } });
        break;
      }
      case "turn/diff/updated":
        await this.detail({ category: "diagnostic", key: "turn-diff", scope: "run", ref: null,
          level: "info", action: null, text: str.parse(params.diff) || "No outstanding file changes" });
        break;
      case "thread/compacted":
        await this.detail({ category: "compaction", key: "compaction", scope: "run", ref: null,
          status: "completed", text: "Context compacted" });
        break;
      case "model/rerouted": {
        const model = str.parse(params.toModel);
        await this.detail({ category: "model", key: "model-rerouted", scope: "run", ref: null, model,
          text: `Model changed to ${model}` });
        break;
      }
      case "error": {
        const error = z.object({ message: str }).parse(params.error);
        if (!params.willRetry) this.failure = error.message;
        await this.diagnostic(params.willRetry ? "warning" : "error", error.message);
        break;
      }
      case "warning":
      case "guardianWarning":
      case "configWarning":
      case "deprecationNotice":
        await this.diagnostic("warning", str.parse(params.message ?? params.summary));
        break;
    }
  }
}
