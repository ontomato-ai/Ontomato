import type { RuntimeJsonValue, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import { orderedMessages, type ConversationState, type RetrievalLink } from "./conversation";
import { skillOfCommand } from "./tools";
import type { ProcessStepView } from "./types";

export type ProcessStep = ProcessStepView;

export type ResponseBlock =
  | { kind: "text"; key: string; text: string; final: boolean; runId: string }
  | { kind: "process"; key: string; steps: ProcessStep[]; active: boolean };

export interface UserItem {
  kind: "user";
  key: string;
  text: string;
}

export interface ResponseItem {
  kind: "response";
  key: string;
  runId: string;
  blocks: ResponseBlock[];
  running: boolean;
  /** Present once the run stopped; rendering decides how each PI reason is shown. */
  end: { stopReason: RuntimeStopReason | null; errorMessage: string | null } | null;
  /** Last settled assistant message, the feedback and copy target. */
  answerMessageId: string | null;
  answerText: string;
  /** Retrieval associations for activity rendering; stable across continuations. */
  retrievals: RetrievalLink[];
}

export type ConversationItem = UserItem | ResponseItem;

/** Generic one-line summary of a tool call: the first short string argument. */
export function toolSummary(args: Record<string, RuntimeJsonValue>): string {
  for (const key of ["command", "path", "file_path", "query", "url"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0]!;
  }
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0]!;
  }
  return "";
}

function userText(content: string | { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

/** Projects runtime messages into user turns and assistant responses in chronological order. */
export function conversationItems(state: ConversationState): ConversationItem[] {
  const items: ConversationItem[] = [];
  let response: ResponseItem | null = null;
  const toolResults = new Map<string, string>();
  for (const entry of Object.values(state.messages)) {
    const message = entry.message;
    if (message.role === "toolResult")
      toolResults.set(message.toolCallId, userText(message.content));
  }

  const openResponse = (runId: string): ResponseItem => {
    if (response && response.runId === runId) return response;
    response = {
      kind: "response",
      key: runId,
      runId,
      blocks: [],
      running: false,
      end: null,
      answerMessageId: null,
      answerText: "",
      retrievals: [],
    };
    items.push(response);
    return response;
  };

  for (const entry of orderedMessages(state)) {
    const message = entry.message;
    if (message.role === "system" || message.role === "toolResult") continue;
    if (message.role === "user") {
      response = null;
      items.push({ kind: "user", key: entry.id, text: userText(message.content) });
      continue;
    }
    const current = openResponse(entry.runId);
    const run = state.runs[entry.runId];
    const settled = entry.messageSeq !== null;
    message.content.forEach((block, index) => {
      const key = `${entry.id}:${index}`;
      if (block.type === "text") {
        if (!block.text) return;
        current.blocks.push({
          kind: "text",
          key,
          text: block.text,
          final: settled,
          runId: entry.runId,
        });
        return;
      }
      let process = current.blocks.at(-1);
      if (process?.kind !== "process") {
        process = { kind: "process", key, steps: [], active: false };
        current.blocks.push(process);
      }
      if (block.type === "thinking") {
        if (!block.thinking.trim() && settled) return;
        process.steps.push({
          key,
          kind: "thinking",
          text: block.thinking,
          toolName: "",
          skill: null,
          args: {},
          status: settled ? "done" : "streaming",
          output: "",
        });
        return;
      }
      const tool = block.id ? run?.tools[block.id] : undefined;
      const args = tool?.args ?? block.arguments;
      const toolName = tool?.toolName ?? block.name;
      const command = toolName === "bash" && typeof args.command === "string" ? args.command : "";
      process.steps.push({
        key,
        kind: "tool",
        text: toolSummary(args),
        toolName,
        skill: command ? skillOfCommand(command) : null,
        args,
        status: tool?.status ?? (block.id && toolResults.has(block.id) ? "completed" : "streaming"),
        output: tool?.output || (block.id ? (toolResults.get(block.id) ?? "") : ""),
      });
    });
    if (settled && message.stopReason === "stop") {
      current.answerMessageId = entry.id;
      current.answerText = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n\n")
        .trim();
    }
  }

  for (const item of items) {
    if (item.kind !== "response") continue;
    const run = state.runs[item.runId];
    item.running = run?.status === "running";
    item.retrievals = run?.retrievals ?? [];
    item.end = run && run.status === "stopped"
      ? { stopReason: run.stopReason, errorMessage: run.errorMessage }
      : null;
    const last = item.blocks.at(-1);
    for (const block of item.blocks) {
      if (block.kind !== "process") continue;
      block.active =
        item.running &&
        block === last &&
        block.steps.some((step) => step.status === "running" || step.status === "streaming");
    }
  }
  return items;
}
