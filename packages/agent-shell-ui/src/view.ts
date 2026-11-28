import type { RuntimeRunDetail } from "@ontomato/contracts/agent-runtime-details";
import type { RuntimeUsageCount } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeJsonValue, RuntimeStopReason, RuntimeToolOutcome } from "@ontomato/contracts/agent-runtime-values";
import type { AgentTasksSnapshot, QualityResult, QualityTask,ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import { orderedMessages, type ConversationState, type RunDetailEntry } from "./conversation";
import { skillOfCommand } from "./tools";
import type { ProcessStepView } from "./types";

export type ProcessStep = ProcessStepView;

/**
 * One piece of a response's process: the agent's text that is not its answer, consecutive thinking and tool steps, a
 * generic engine process entry, or a task the reply delegated, placed after the work that started it.
 */
export type ProcessBlock =
  | { kind: "note"; key: string; text: string; final: boolean; runId: string }
  | { kind: "steps"; key: string; steps: ProcessStep[]; active: boolean }
  | { kind: "input"; key: string; messageId: string; text: string; source: "user"; replyTo?: string; question?: string; runId: string; final: true }
  | { kind: "task"; key: string; task: ChannelAgentTask }
  | { kind: "detail"; key: string; detail: RuntimeRunDetail };

/** Engine-neutral token usage reported for one response: either a standalone usage update or summed assistant messages. */
export interface ResponseUsage {
  counts: RuntimeUsageCount;
  /** Present when a standalone `usage_updated` event reported both a running total and a distinct last-call count. */
  last?: RuntimeUsageCount;
}

/** Another party's review of the reply's data: one quality check of the datasets the reply cited from one retrieval. */
export interface ResponseReview {
  task: QualityTask;
  result: QualityResult | null;
  /** The checked datasets, by the titles their delivery gave them. */
  datasets: { id: string; title: string }[];
}

export interface UserItem {
  kind: "user";
  key: string;
  text: string;
  /** The reader answered one of the agents' questions with it. */
  answer: boolean;
  /** The question this message answers, when the question it names is in the conversation. */
  question?: string;
  /** Accepted by the runtime and queued until the previous turn finishes. */
  queued?: boolean;
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
  /** Quality reviews of the data this reply's answer cited; shown after the answer, never part of it. */
  reviews: ResponseReview[];
  /** Token usage reported for this run, when any non-zero count is available. */
  usage?: ResponseUsage | null;
  /** Start and stop of this run, in ms. */
  startedAt: number | null;
  finishedAt: number | null;
}

/** Notifications other than questions stay plain text in the conversation. */
export type ConversationItem = UserItem | ResponseItem | { kind: "notification"; key: string; text: string; error?: boolean };

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

export function userText(content: string | { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

function answeredQuestion(state: ConversationState, replyTo: string | undefined): string | undefined {
  const message = replyTo === undefined ? undefined : state.messages[replyTo]?.message;
  return message?.role === "notification" && message.kind === "agent-question" ? message.content : undefined;
}

function hasUsageTokens(counts: RuntimeUsageCount): boolean {
  return (
    counts.totalTokens > 0 ||
    counts.input > 0 ||
    counts.output > 0 ||
    counts.cacheRead > 0 ||
    counts.cacheWrite > 0 ||
    (counts.reasoning ?? 0) > 0
  );
}

function sameUsageCounts(a: RuntimeUsageCount, b: RuntimeUsageCount): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    (a.reasoning ?? 0) === (b.reasoning ?? 0) &&
    a.totalTokens === b.totalTokens
  );
}

/**
 * Resolves one run's token usage without engine-specific branching. A standalone `usage_updated` report is used as-is
 * and never added to assistant-message usage; otherwise settled assistant messages of this run are summed.
 */
function runUsage(state: ConversationState, runId: string): ResponseUsage | null {
  const run = state.runs[runId];
  if (run?.usageUpdate) {
    const counts = run.usageUpdate.total ?? run.usageUpdate.last;
    if (!hasUsageTokens(counts)) return null;
    const last =
      run.usageUpdate.total &&
      hasUsageTokens(run.usageUpdate.last) &&
      !sameUsageCounts(run.usageUpdate.total, run.usageUpdate.last)
        ? run.usageUpdate.last
        : undefined;
    return last ? { counts, last } : { counts };
  }
  let found = false;
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0, totalTokens = 0;
  let hasReasoning = false;
  for (const entry of Object.values(state.messages)) {
    if (entry.runId !== runId || entry.messageSeq === null) continue;
    if (entry.message.role !== "assistant" || !entry.message.usage) continue;
    const usage = entry.message.usage;
    if (!hasUsageTokens(usage)) continue;
    found = true;
    input += usage.input;
    output += usage.output;
    cacheRead += usage.cacheRead;
    cacheWrite += usage.cacheWrite;
    totalTokens += usage.totalTokens;
    if (usage.reasoning !== undefined) {
      hasReasoning = true;
      reasoning += usage.reasoning;
    }
  }
  if (!found) return null;
  return {
    counts: {
      input,
      output,
      cacheRead,
      cacheWrite,
      ...(hasReasoning ? { reasoning } : {}),
      totalTokens,
    },
  };
}

/**
 * Projects runtime messages into user turns and assistant responses in chronological order, with the tasks each reply
 * delegated: a task joins its reply's process before the first message that began after it. A quality check is a
 * review of the reply that cited the checked data, which may be a later reply than the one that delegated it.
 */
export function conversationItems(state: ConversationState, tasks: AgentTasksSnapshot | null = null): ConversationItem[] {
  const items: ConversationItem[] = [];
  const queuedInputIds = new Set<string>();
  for (const queued of tasks?.queuedRuns ?? []) {
    if (state.runs[queued.runId]) continue;
    for (const inputId of queued.inputIds) queuedInputIds.add(inputId);
  }
  const delegated = new Map<string, Array<ChannelAgentTask>>();
  const reviews = new Map<string, ResponseReview[]>();
  for (const task of tasks?.tasks ?? []) {
    if (task.kind === "agent") {
      if (task.parentTaskId !== null) continue;
      delegated.set(task.root.runId, [...(delegated.get(task.root.runId) ?? []), task]);
      continue;
    }
    reviews.set(task.root.runId, [...(reviews.get(task.root.runId) ?? []), {
      task,
      result: tasks!.qualityResults.find((result) => result.taskId === task.id) ?? null,
      datasets: task.checks.datasets.map((dataset) => ({ id: dataset.id, title: dataset.title ?? dataset.id })),
    }]);
  }
  const pendingDetails = new Map<string, RunDetailEntry[]>();
  const messageDetails = new Map<string, RunDetailEntry[]>();
  for (const run of Object.values(state.runs)) {
    const entries = Object.values(run.details);
    if (!entries.length) continue;
    const chronological: RunDetailEntry[] = [];
    for (const entry of entries) {
      if (entry.detail.scope === "message" && entry.detail.ref) {
        const key = `${run.id}:${entry.detail.ref}`;
        messageDetails.set(key, [...(messageDetails.get(key) ?? []), entry]);
      } else {
        chronological.push(entry);
      }
    }
    if (chronological.length) pendingDetails.set(run.id, chronological);
  }
  /** Places the reply's delegated tasks and generic process details that started before `until` (all remaining without it). */
  const place = (response: ResponseItem, until: number | null) => {
    const pending = delegated.get(response.runId);
    while (pending?.length && (until === null || pending[0]!.createdAt === null || Date.parse(pending[0]!.createdAt) <= until)) {
      const task = pending.shift()!;
      response.process.push({ kind: "task", key: `task:${task.id}`, task });
    }
    const details = pendingDetails.get(response.runId);
    while (details?.length && (until === null || (details[0]!.timestamp !== null && details[0]!.timestamp <= until))) {
      const entry = details.shift()!;
      response.process.push({ kind: "detail", key: `detail:${response.runId}:${entry.detail.key}`, detail: entry.detail });
    }
  };
  let response: ResponseItem | null = null;
  const responses=new Map<string,ResponseItem>();
  const toolResults = new Map<string, { output: string; isError: boolean; outcome?: RuntimeToolOutcome }>();
  for (const entry of Object.values(state.messages)) {
    const message = entry.message;
    if (message.role === "toolResult")
      toolResults.set(message.toolCallId, {
        output: userText(message.content),
        isError: message.isError,
        outcome: message.outcome,
      });
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
      usage: null,
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
        const question = answeredQuestion(state, message.role === "notification" ? message.replyTo : undefined);
        current.process.push({kind:"input",key:entry.id,messageId:entry.id,text:userText(message.content),source:"user",...(message.role === "notification" ? {replyTo:message.replyTo}:{}),...(question === undefined ? {} : {question}),runId:current.runId,final:true});
      } else {
        const queued = entry.runId === null && queuedInputIds.has(entry.id);
        const question = answeredQuestion(state, message.role === "notification" ? message.replyTo : undefined);
        items.push({ kind: "user", key: entry.id, text: userText(message.content), answer: userAnswer, ...(question === undefined ? {} : { question }), ...(queued ? { queued: true } : {}) });
      }
      for (const failure of tasks?.preparationFailures ?? []) if (failure.inputId === entry.id) items.push({ kind: "notification",key: `preparation:${failure.runId}`,text: failure.error,error: true });
      continue;
    }
    if (message.role === "notification") {
      // A delegated agent's result or question is input to the requesting model, not a message in the main conversation;
      // a question to the reader waits in the questions panel instead.
      if (message.kind !== "agent-result" && message.kind !== "agent-question") {
        items.push({ kind: "notification", key: entry.id, text: message.content });
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
      const blocks = message.content.filter((block) => block.type === "text");
      current.answerMessageId = entry.id;
      current.answerText = blocks
        .map((block) => block.text)
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
      const result = block.id ? toolResults.get(block.id) : undefined;
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
        status:
          tool?.status ??
          (result
            ? result.outcome === "unknown"
              ? "unknown"
              : result.outcome === "failure"
                ? "failed"
                : result.outcome === "success"
                  ? "completed"
                  : result.isError
                    ? "failed"
                    : "completed"
            : run?.status === "stopped"
              ? "unknown"
              : "streaming"),
        output: tool?.output || result?.output || "",
      });
    });
    const attached = messageDetails.get(`${current.runId}:${entry.id}`);
    if (attached?.length) {
      messageDetails.delete(`${current.runId}:${entry.id}`);
      for (const detailEntry of attached) {
        current.process.push({
          kind: "detail",
          key: `detail:${current.runId}:${detailEntry.detail.key}`,
          detail: detailEntry.detail,
        });
      }
    }
  }

  for (const run of Object.values(state.runs)) {
    if (!responses.has(run.id) && Object.keys(run.details).length > 0) openResponse(run.id);
  }
  for (const [refKey, attached] of messageDetails.entries()) {
    const runId = refKey.slice(0, refKey.indexOf(":"));
    const target = responses.get(runId);
    if (!target) continue;
    for (const detailEntry of attached) {
      target.process.push({
        kind: "detail",
        key: `detail:${target.runId}:${detailEntry.detail.key}`,
        detail: detailEntry.detail,
      });
    }
  }
  for (const reply of responses.values()) place(reply, null);

  for (const item of items) {
    if (item.kind !== "response") continue;
    const run = state.runs[item.runId];
    item.running = run?.status === "running";
    place(item, null);
    item.workspaceCommit = run?.workspaceCommit ?? null;
    item.usage = runUsage(state, item.runId);
    item.startedAt = run?.createdAt ? Date.parse(run.createdAt) : null;
    item.finishedAt = run?.finishedAt ? Date.parse(run.finishedAt) : null;
    item.end = run && run.status === "stopped"
      ? { stopReason: run.stopReason, errorMessage: run.errorMessage }
      : null;
    // A step that started delegated work or received a generic detail stays the active one while it runs.
    const last = [...item.process].reverse().find((block) => block.kind !== "task" && block.kind !== "detail");
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
