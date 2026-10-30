import type { AgentHostRunSnapshot, AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type {
  RuntimeEventEnvelope,
} from "@ontomato/contracts/agent-runtime-events";
import type {
  RuntimeAssistantStreamEvent,
  RuntimeMessage,
} from "@ontomato/contracts/agent-runtime-messages";
import type {
  RuntimeJsonValue,
  RuntimeRunStatus,
  RuntimeStopReason,
} from "@ontomato/contracts/agent-runtime-values";

export interface ConversationMessage {
  id: string;
  runId: string;
  /** Session message sequence once settled; pending partials sort after settled history. */
  messageSeq: number | null;
  arrival: number;
  message: RuntimeMessage;
}

export interface ToolExecutionView {
  toolCallId: string;
  toolName: string;
  args: Record<string, RuntimeJsonValue>;
  status: "running" | "completed" | "failed" | "unknown";
  output: string;
}

export interface RetrievalLink {
  retrievalId: string;
  runId: string;
}

export interface RunView {
  id: string;
  status: RuntimeRunStatus;
  stopReason: RuntimeStopReason | null;
  errorMessage: string | null;
  /** Run start and stop times (ISO), from the snapshot or the agent_start/agent_end envelopes. */
  createdAt: string | null;
  finishedAt: string | null;
  cursor: { seq: number; streamId: string } | null;
  artifacts: RuntimeArtifact[];
  tools: Record<string, ToolExecutionView>;
  retrievals: RetrievalLink[];
}

export interface ConversationState {
  sessionId: string | null;
  messages: Record<string, ConversationMessage>;
  runs: Record<string, RunView>;
  arrivals: number;
}

export function emptyConversation(sessionId: string | null = null): ConversationState {
  return { sessionId, messages: {}, runs: {}, arrivals: 0 };
}

function upsertMessage(
  state: ConversationState,
  id: string,
  runId: string,
  message: RuntimeMessage,
  messageSeq: number | null,
) {
  const existing = state.messages[id];
  if (existing) {
    existing.message = message;
    if (messageSeq !== null) existing.messageSeq = messageSeq;
    return;
  }
  state.messages[id] = { id, runId, messageSeq, arrival: state.arrivals++, message };
}

function ensureRun(state: ConversationState, runId: string): RunView {
  return (state.runs[runId] ??= {
    id: runId,
    status: "running",
    stopReason: null,
    errorMessage: null,
    createdAt: null,
    finishedAt: null,
    cursor: null,
    artifacts: [],
    tools: {},
    retrievals: [],
  });
}

function addArtifact(run: RunView, artifact: RuntimeArtifact) {
  if (!run.artifacts.some((known) => known.id === artifact.id && known.seq === artifact.seq))
    run.artifacts.push(artifact);
}

function toolOutput(content: { type: string; text?: string }[]): string {
  return content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("");
}

/** Replaces one run's live projection with an authoritative snapshot. */
export function applyRunSnapshot(state: ConversationState, snapshot: AgentHostRunSnapshot) {
  const run = ensureRun(state, snapshot.run.id);
  run.status = snapshot.run.status;
  run.stopReason = snapshot.run.stopReason;
  run.errorMessage = snapshot.run.errorMessage;
  run.createdAt = snapshot.run.createdAt;
  run.finishedAt = snapshot.run.finishedAt;
  run.cursor = { seq: snapshot.cursor.seq, streamId: snapshot.cursor.streamId };
  run.artifacts = [...snapshot.artifacts];
  run.tools = {};
  run.retrievals = snapshot.run.retrievals ?? [];
  for (const tool of snapshot.toolExecutions) {
    run.tools[tool.toolCallId] = {
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      args: tool.args,
      status: tool.status,
      output: tool.result ? toolOutput(tool.result.content) : "",
    };
  }
  for (const record of snapshot.messages)
    upsertMessage(state, record.id, record.runId, record.message, record.messageSeq);
  // A partial that settled or vanished between snapshots is replaced, never kept as a duplicate.
  for (const message of Object.values(state.messages)) {
    if (message.runId === snapshot.run.id && message.messageSeq === null)
      delete state.messages[message.id];
  }
  for (const pending of snapshot.pendingMessages)
    upsertMessage(state, pending.id, snapshot.run.id, pending.message, null);
}

/** Merge a bounded durable page without replacing newer live state during backward paging. */
export function applyHistoryPage(state: ConversationState, page: AgentHostSessionHistory, older = false) {
  state.sessionId = page.session.id;
  for (const value of page.runs) {
    const run = ensureRun(state, value.id);
    if (!older || !run.cursor) {
      run.status = value.status;
      run.stopReason = value.stopReason;
      run.errorMessage = value.errorMessage;
      run.retrievals = value.retrievals ?? [];
    }
  }
  for (const record of page.messages) {
    upsertMessage(state, record.id, record.runId, record.message, record.messageSeq);
    const run = ensureRun(state, record.runId), message = record.message;
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const tool = run.tools[block.id];
        run.tools[block.id] = {
          toolCallId: block.id, toolName: block.name, args: block.arguments,
          status: tool?.status ?? (run.status === "running" ? "running" : "unknown"),
          output: tool?.output ?? "",
        };
      }
    } else if (message.role === "toolResult") {
      run.tools[message.toolCallId] = {
        toolCallId: message.toolCallId, toolName: message.toolName,
        args: run.tools[message.toolCallId]?.args ?? {},
        status: message.isError ? "failed" : "completed", output: toolOutput(message.content),
      };
    }
  }
  if (!older) for (const value of page.runs) {
    if (value.status !== "stopped") continue;
    for (const message of Object.values(state.messages))
      if (message.runId === value.id && message.messageSeq === null) delete state.messages[message.id];
    for (const tool of Object.values(state.runs[value.id].tools))
      if (tool.status === "running") tool.status = "unknown";
  }
}

/** The live remainder is an authoritative cut; settled tool results stay with their loaded pages. */
export function applyHistoryLive(state: ConversationState, snapshot: AgentHostRunSnapshot) {
  const run = ensureRun(state, snapshot.run.id);
  const tools = run.tools, artifacts = run.artifacts;
  applyRunSnapshot(state, snapshot);
  run.tools = { ...tools, ...run.tools };
  run.artifacts = artifacts;
}

function applyDelta(message: RuntimeMessage, event: RuntimeAssistantStreamEvent) {
  if (message.role !== "assistant") return;
  const content = message.content;
  switch (event.type) {
    case "text_start":
      content[event.contentIndex] = { type: "text", text: "" };
      return;
    case "text_delta": {
      const block = content[event.contentIndex];
      if (block?.type === "text") block.text += event.delta;
      else content[event.contentIndex] = { type: "text", text: event.delta };
      return;
    }
    case "thinking_start":
      content[event.contentIndex] = { type: "thinking", thinking: "" };
      return;
    case "thinking_delta": {
      const block = content[event.contentIndex];
      if (block?.type === "thinking") block.thinking += event.delta;
      else content[event.contentIndex] = { type: "thinking", thinking: event.delta };
      return;
    }
    case "toolcall_start":
      // Name and arguments arrive with tool_execution_start; until then the block is a placeholder.
      content[event.contentIndex] ??= { type: "toolCall", id: "", name: "", arguments: {} };
      return;
    case "done":
      message.stopReason = event.reason;
      return;
    case "error":
      message.stopReason = event.reason;
      return;
    default:
      return;
  }
}

/**
 * Applies one event of a run. Returns false when the event was already applied (replay overlap).
 * Callers must have applied the run snapshot that established the cursor first.
 */
export function applyEnvelope(state: ConversationState, envelope: RuntimeEventEnvelope): boolean {
  const run = ensureRun(state, envelope.cursor.runId);
  if (run.cursor && envelope.cursor.streamId === run.cursor.streamId && envelope.cursor.seq <= run.cursor.seq)
    return false;
  run.cursor = { seq: envelope.cursor.seq, streamId: envelope.cursor.streamId };
  const event = envelope.event;
  switch (event.type) {
    case "agent_start":
      run.status = "running";
      run.createdAt ??= envelope.timestamp;
      break;
    case "message_start":
      upsertMessage(state, event.messageId, run.id, structuredClone(event.message), null);
      break;
    case "message_update": {
      const message = state.messages[event.messageId];
      if (message) applyDelta(message.message, event.assistantMessageEvent);
      break;
    }
    case "message_end":
      upsertMessage(state, event.messageId, run.id, event.message, event.messageSeq);
      break;
    case "tool_execution_start":
      run.tools[event.toolCallId] = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: "running",
        output: "",
      };
      break;
    case "tool_execution_update": {
      const tool = run.tools[event.toolCallId];
      if (tool) tool.output = event.partialResult.text;
      break;
    }
    case "tool_execution_end":
      run.tools[event.toolCallId] = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: run.tools[event.toolCallId]?.args ?? {},
        status: event.isError ? "failed" : "completed",
        output: toolOutput(event.result.content),
      };
      break;
    case "artifact_registered":
      addArtifact(run, event.artifact);
      break;
    case "agent_end":
      run.status = event.status;
      run.stopReason = event.stopReason;
      run.errorMessage = event.errorMessage;
      run.finishedAt = envelope.timestamp;
      for (const tool of Object.values(run.tools))
        if (tool.status === "running") tool.status = "unknown";
      break;
    default:
      break;
  }
  return true;
}

/** The run's latest version of a path, matching the host's run-granularity resolution. */
export function findArtifact(run: RunView | undefined, path: string) {
  if (!run) return null;
  let found: RuntimeArtifact | null = null;
  for (const artifact of run.artifacts) {
    if (artifact.path === path && (!found || artifact.seq >= found.seq)) found = artifact;
  }
  return found;
}

export function orderedMessages(state: ConversationState): ConversationMessage[] {
  return Object.values(state.messages).sort((a, b) => {
    if (a.messageSeq !== null && b.messageSeq !== null) return a.messageSeq - b.messageSeq;
    if (a.messageSeq !== null) return -1;
    if (b.messageSeq !== null) return 1;
    return a.arrival - b.arrival;
  });
}
