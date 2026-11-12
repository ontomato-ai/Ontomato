import type { RuntimeJsonValue, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import { orderedMessages, type ConversationState, type RetrievalLink } from "./conversation";
import { runsAnalystAsk, skillOfCommand } from "./tools";
import type { ProcessStepView } from "./types";

export type ProcessStep = ProcessStepView;

/** One piece of a response's process: the agent's text that is not its answer, or consecutive thinking and tool steps. */
export type ProcessBlock =
  | { kind: "note"; key: string; text: string; final: boolean; runId: string }
  | { kind: "steps"; key: string; steps: ProcessStep[]; active: boolean };

export interface UserItem {
  kind: "user";
  key: string;
  text: string;
}

export interface ResponseItem {
  kind: "response";
  key: string;
  runId: string;
  workspaceCommit: string | null;
  /** Everything the run did except its answer's text, in order; it streams here while the run is active. */
  process: ProcessBlock[];
  running: boolean;
  /** Present once the run stopped; rendering decides how each PI reason is shown. */
  end: { stopReason: RuntimeStopReason | null; errorMessage: string | null } | null;
  /** The message the runtime named as the run's answer: the body, and the copy, feedback and action target. */
  answerMessageId: string | null;
  answerText: string;
  /** Retrieval associations for activity rendering; stable across continuations. */
  retrievals: RetrievalLink[];
  /** The run's start and stop times in ms, for the elapsed-time line. */
  startedAt: number | null;
  finishedAt: number | null;
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
      workspaceCommit: null,
      process: [],
      running: false,
      end: null,
      answerMessageId: null,
      answerText: "",
      retrievals: [],
      startedAt: null,
      finishedAt: null,
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
    // Only the answer's text leaves the process; its thinking stays there with the rest of the work.
    const answer = entry.id === run?.answerMessageId;
    if (answer) {
      current.answerMessageId = entry.id;
      current.answerText = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n\n")
        .trim();
    }
    message.content.forEach((block, index) => {
      const key = `${entry.id}:${index}`;
      if (block.type === "text") {
        if (!block.text || answer) return;
        current.process.push({ kind: "note", key, text: block.text, final: settled, runId: entry.runId });
        return;
      }
      let process = current.process.at(-1);
      if (process?.kind !== "steps") {
        process = { kind: "steps", key, steps: [], active: false };
        current.process.push(process);
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
  }

  for (const item of items) {
    if (item.kind !== "response") continue;
    const run = state.runs[item.runId];
    item.running = run?.status === "running";
    item.retrievals = run?.retrievals ?? [];
    // Associated retrievals own the business activity; keep unassociated or failed calls visible.
    if (item.retrievals.length) {
      for (const block of item.process) {
        if (block.kind !== "steps") continue;
        block.steps = block.steps.filter((step) => !(
          step.kind === "tool" && step.toolName === "bash" && step.status !== "failed" &&
          typeof step.args.command === "string" && runsAnalystAsk(step.args.command)
        ));
      }
      item.process = item.process.filter((block) => block.kind !== "steps" || block.steps.length > 0);
    }
    item.workspaceCommit = run?.workspaceCommit ?? null;
    item.startedAt = run?.createdAt ? Date.parse(run.createdAt) : null;
    item.finishedAt = run?.finishedAt ? Date.parse(run.finishedAt) : null;
    item.end = run && run.status === "stopped"
      ? { stopReason: run.stopReason, errorMessage: run.errorMessage }
      : null;
    const last = item.process.at(-1);
    for (const block of item.process) {
      if (block.kind !== "steps") continue;
      block.active =
        item.running &&
        block === last &&
        block.steps.some((step) => step.status === "running" || step.status === "streaming");
    }
  }
  return items;
}
