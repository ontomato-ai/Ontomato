import {
  agentResponseEventSchema,
  type AgentChatMessage,
  type AgentChatSegment as MessageSegment,
  type AgentChatToolSegment as ToolCallSegment,
  type AgentResponseEvent,
  type AgentResponseTerminalStatus,
} from "@ontomato/contracts/agent-chat";

/** Status the live tail itself can reach; owners may hold further history statuses. */
export type AgentLiveStatus = "idle" | "starting" | "running" | AgentResponseTerminalStatus;

/** Transient messages of the response in flight, rebuilt from the replayable event stream. */
export interface AgentLiveTail<Status extends string = AgentLiveStatus> {
  messages: AgentChatMessage[];
  status: Status;
}

export function parseAgentResponseEvent(value: unknown): AgentResponseEvent | undefined {
  const parsed = agentResponseEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The stream broke its own protocol; reconnecting would replay the same failure. */
export class SseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseProtocolError";
  }
}

// Connection control events named by `event:`; their data is not a business event.
const CONTROL_EVENTS = new Set(["open", "heartbeat"]);

/**
 * Read the events of an SSE body. Each business payload goes to `onData` with its id;
 * returns true once `onData` reports a final event, false when the body ends or the
 * reader is no longer current. Malformed business data throws {@link SseProtocolError}.
 */
export async function readSseData(
  response: Response,
  onData: (data: unknown, id: number | undefined) => boolean,
  isCurrent: () => boolean
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) throw new SseProtocolError("Response stream has no body");

  const decoder = new TextDecoder();
  let buffer = "";
  let pendingId: number | undefined;
  let eventName = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (!isCurrent()) return false;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line === "") {
          // Blank line ends one event and its fields.
          pendingId = undefined;
          eventName = "";
        } else if (line.startsWith("event: ")) {
          eventName = line.slice(7);
        } else if (line.startsWith("id: ")) {
          const id = Number(line.slice(4));
          pendingId = Number.isFinite(id) ? id : undefined;
        } else if (line.startsWith("data: ") && !CONTROL_EVENTS.has(eventName)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line.slice(6));
          } catch {
            throw new SseProtocolError("Response stream sent malformed data");
          }
          if (onData(parsed, pendingId)) return true;
        }
      }
    }
  } finally {
    // Release the body on every exit; cancelling an already finished body is a no-op.
    void reader.cancel().catch(() => {});
  }
}

function cloneSegments(segments: MessageSegment[] | undefined): MessageSegment[] {
  return (segments ?? []).map((segment) => ({ ...segment }));
}

function updateAssistant(
  messages: AgentChatMessage[],
  update: (assistant: AgentChatMessage, segments: MessageSegment[]) => void
): AgentChatMessage[] {
  const next = messages.map((message) => ({
    ...message,
    ...(message.segments ? { segments: cloneSegments(message.segments) } : {}),
  }));
  let index = next.length - 1;
  if (index < 0 || next[index]!.role !== "assistant") {
    next.push({ role: "assistant", content: "", segments: [] });
    index = next.length - 1;
  }
  const assistant = next[index]!;
  const segments = assistant.segments ?? (assistant.content ? [{ type: "text" as const, content: assistant.content }] : []);
  assistant.segments = segments;
  update(assistant, segments);
  return next;
}

function findTool(segments: MessageSegment[], toolCallId: string): ToolCallSegment | undefined {
  return segments.find(
    (segment): segment is ToolCallSegment =>
      segment.type === "tool_call" && segment.toolCallId === toolCallId
  );
}

function upsertTool(segments: MessageSegment[], toolCallId: string, tool: string): ToolCallSegment {
  const existing = findTool(segments, toolCallId);
  if (existing) return existing;
  const created: ToolCallSegment = {
    type: "tool_call",
    toolCallId,
    tool,
    args: "",
    status: "running",
  };
  segments.push(created);
  return created;
}

export function reduceAgentLiveTail<Status extends string>(
  state: AgentLiveTail<Status>,
  event: AgentResponseEvent
): AgentLiveTail<Status | AgentLiveStatus> {
  if (event.type === "response_started") {
    if (state.status === "running" && state.messages[0]?.content === event.message) return state;
    return {
      status: "running",
      messages: [
        { role: "user", content: event.message },
        { role: "assistant", content: "", segments: [] },
      ],
    };
  }

  if (event.type === "response_end") return { ...state, status: event.status };
  if (event.type === "error") return { ...state, status: "failed" };
  if (event.type === "response_unavailable") return { messages: [], status: "idle" };

  const messages = updateAssistant(state.messages, (assistant, segments) => {
    if (event.type === "token") {
      const last = segments[segments.length - 1];
      if (last?.type === "text") last.content += event.content;
      else segments.push({ type: "text", content: event.content });
      assistant.content += event.content;
    } else if (event.type === "thinking") {
      const last = segments[segments.length - 1];
      if (last?.type === "thinking") last.content += event.content;
      else segments.push({ type: "thinking", content: event.content });
    } else if (event.type === "tool_start") {
      const tool = upsertTool(segments, event.toolCallId, event.tool);
      tool.args = JSON.stringify(event.args, null, 2);
    } else if (event.type === "tool_end") {
      const tool = upsertTool(segments, event.toolCallId, event.tool);
      tool.result = event.result;
      tool.isError = event.isError;
      tool.status = "done";
    }
  });

  return { messages, status: state.status === "starting" ? "running" : state.status };
}

/**
 * Display shape of a transcript: one assistant message per user turn, as the live tail builds it.
 * Settled history keeps one assistant message per model iteration; joining adjacent ones here
 * makes a turn read the same before and after it settles. Segment order is kept and adjacent
 * text or thinking joins exactly as streamed deltas do; user messages always start a new turn.
 */
export function joinAssistantTurns(messages: readonly AgentChatMessage[]): AgentChatMessage[] {
  const result: AgentChatMessage[] = [];
  for (const message of messages) {
    const last = result[result.length - 1];
    if (message.role !== "assistant" || last?.role !== "assistant") {
      result.push(message);
      continue;
    }
    const segments = cloneSegments(
      last.segments ?? (last.content ? [{ type: "text" as const, content: last.content }] : [])
    );
    const incoming =
      message.segments ?? (message.content ? [{ type: "text" as const, content: message.content }] : []);
    for (const segment of incoming) {
      const tail = segments[segments.length - 1];
      if (segment.type !== "tool_call" && tail?.type === segment.type) tail.content += segment.content;
      else segments.push({ ...segment });
    }
    result[result.length - 1] = { role: "assistant", content: last.content + message.content, segments };
  }
  return result;
}
