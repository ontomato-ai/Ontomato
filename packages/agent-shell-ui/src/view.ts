import type { RuntimeJsonValue, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import type { AgentTasksSnapshot, QualityResult, QualityTask,ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import { orderedMessages, type ConversationState } from "./conversation";
import { skillOfCommand } from "./tools";
import type { ProcessStepView } from "./types";

export type ProcessStep = ProcessStepView;

/**
 * One piece of a response's process: the agent's text that is not its answer, consecutive thinking and tool steps, or
 * a retrieval the reply delegated, placed after the work that started it.
 */
export type ProcessBlock =
  | { kind: "note"; key: string; text: string; final: boolean; runId: string }
  | { kind: "steps"; key: string; steps: ProcessStep[]; active: boolean }
  | { kind: "input"; key: string; messageId: string; text: string; source: "user"; replyTo?: string; runId: string; final: true }
  | { kind: "task"; key: string; task: ChannelAgentTask };

/** Another party's review of the reply's data: one quality check of one retrieval branch. */
export interface ResponseReview {
  task: QualityTask;
  result: QualityResult | null;
  /** The checked datasets, as the parent retrieval delivered them. */
  datasets: { id: string; title: string }[];
}

export interface UserItem {
  kind: "user";
  key: string;
  text: string;
  /** The reader answered one of the agents' questions with it. */
  answer: boolean;
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
  /** Quality reviews of the data this reply delegated for; shown after the answer, never part of it. */
  reviews: ResponseReview[];
  /** The run's start and stop times in ms, for the elapsed-time line. */
  startedAt: number | null;
  finishedAt: number | null;
}

/** A question an agent asked is model-written Markdown, rendered within the run that holds it; other notifications stay plain text. */
export type ConversationItem = UserItem | ResponseItem | { kind: "notification"; key: string; text: string; error?: boolean; markdownRunId?: string };

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

/**
 * Projects runtime messages into user turns and assistant responses in chronological order, with the tasks each reply
 * delegated: a retrieval joins its reply's process before the first message that began after it, a quality check is
 * a review of that reply.
 */
export function conversationItems(state: ConversationState, tasks: AgentTasksSnapshot | null = null): ConversationItem[] {
  const items: ConversationItem[] = [];
  const retrievals = new Map<string, Array<ChannelAgentTask>>();
  const reviews = new Map<string, ResponseReview[]>();
  for (const task of tasks?.tasks ?? []) {
    if (task.kind === "agent") {
      if (task.kind === "agent" && task.parentTaskId !== null) continue;
      retrievals.set(task.root.runId, [...(retrievals.get(task.root.runId) ?? []), task]);
      continue;
    }
    const parent = tasks!.tasks.find((candidate) => candidate.id === task.parentTaskId);
    const delivered = parent?.kind === "agent" && parent.retrieval ? parent.retrieval.branches.flatMap((branch) => branch.datasets) : [];
    reviews.set(task.root.runId, [...(reviews.get(task.root.runId) ?? []), {
      task,
      result: tasks!.qualityResults.find((result) => result.taskId === task.id) ?? null,
      datasets: task.checks.datasetIds.map((id) => ({ id, title: delivered.find((dataset) => dataset.id === id)?.title ?? id })),
    }]);
  }
  /** Places the reply's retrievals that started before `until` (all remaining ones without it). */
  const place = (response: ResponseItem, until: number | null) => {
    const pending = retrievals.get(response.runId);
    while (pending?.length && (until === null || pending[0]!.createdAt === null || Date.parse(pending[0]!.createdAt) <= until)) {
      const task = pending.shift()!;
      response.process.push({ kind: "task", key: `task:${task.id}`, task });
    }
  };
  let response: ResponseItem | null = null;
  const responses=new Map<string,ResponseItem>();
  const toolResults = new Map<string, string>();
  for (const entry of Object.values(state.messages)) {
    const message = entry.message;
    if (message.role === "toolResult")
      toolResults.set(message.toolCallId, userText(message.content));
  }

  const openResponse = (runId: string): ResponseItem => {
    const known=responses.get(runId);
    if(known) return response=known;
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
      reviews: reviews.get(runId) ?? [],
      startedAt: null,
      finishedAt: null,
    };
    items.push(response);
    responses.set(runId,response);
    return response;
  };

  for (const entry of orderedMessages(state)) {
    const message = entry.message;
    if (message.role === "system" || message.role === "toolResult") continue;
    const userAnswer=message.role === "notification" && message.kind === "agent-answer" && "kind" in message.source && message.source.kind === "user";
    if (message.role === "user" || userAnswer) {
      const current=entry.runId ? responses.get(entry.runId) : undefined;
      if(current && entry.contextSeq !== null) {
        place(current,message.timestamp);
        current.process.push({kind:"input",key:entry.id,messageId:entry.id,text:userText(message.content),source:"user",...(message.role === "notification" ? {replyTo:message.replyTo}:{}),runId:current.runId,final:true});
      } else items.push({ kind: "user", key: entry.id, text: userText(message.content), answer: userAnswer });
      for (const failure of tasks?.preparationFailures ?? []) if (failure.inputId === entry.id) items.push({ kind: "notification",key: `preparation:${failure.runId}`,text: failure.error,error: true });
      continue;
    }
    if (message.role === "notification") {
      // A delegated agent's result or model-directed question is input to the requesting model, not a message in the main conversation.
      const userQuestion =
        message.kind === "agent-question" &&
        (message.recipient === "user" ||
          ("session" in message.source && message.source.session.sessionId === state.sessionId));
      if (message.kind !== "agent-result" && (message.kind !== "agent-question" || userQuestion)) {
        items.push({ kind: "notification", key: entry.id, text: message.content,
          ...(userQuestion && "session" in message.source ? { markdownRunId: entry.runId ?? message.source.runId } : {}) });
      }
      for (const failure of tasks?.preparationFailures ?? []) if (failure.inputId === entry.id) items.push({ kind: "notification",key: `preparation:${failure.runId}`,text: failure.error,error: true });
      continue;
    }
    if (!entry.runId) continue;
    const current = openResponse(entry.runId);
    place(current, message.timestamp);
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
        current.process.push({ kind: "note", key, text: block.text, final: settled, runId: current.runId });
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
    place(item, null);
    item.workspaceCommit = run?.workspaceCommit ?? null;
    item.startedAt = run?.createdAt ? Date.parse(run.createdAt) : null;
    item.finishedAt = run?.finishedAt ? Date.parse(run.finishedAt) : null;
    item.end = run && run.status === "stopped"
      ? { stopReason: run.stopReason, errorMessage: run.errorMessage }
      : null;
    // A step that started a retrieval stays the active one while the retrieval's card follows it.
    const last = [...item.process].reverse().find((block) => block.kind !== "task");
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
