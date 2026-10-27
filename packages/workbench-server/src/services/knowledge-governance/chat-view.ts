import type {
  AgentChatMessage,
  AgentChatToolSegment,
} from "@ontomato/contracts/agent-chat";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";

/** One governance projection for settled history and snapshot rehydration; thinking is always omitted. */
export function governanceChatMessages(
  messages: RuntimeMessage[],
  tools: RuntimeRunSnapshot["toolExecutions"] = [],
) {
  const result: AgentChatMessage[] = [];
  const calls = new Map<string, AgentChatToolSegment>();
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      result.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content
                .flatMap((p) => (p.type === "text" ? [p.text] : []))
                .join(""),
      });
      continue;
    }
    if (message.role === "assistant") {
      const view: AgentChatMessage = {
        role: "assistant",
        content: "",
        segments: [],
      };
      for (const part of message.content) {
        if (part.type === "text") {
          view.content += part.text;
          view.segments!.push({ type: "text", content: part.text });
        } else if (part.type === "toolCall") {
          const call: AgentChatToolSegment = {
            type: "tool_call",
            toolCallId: part.id,
            tool: part.name,
            args: JSON.stringify(part.arguments, null, 2),
            status: "running",
          };
          calls.set(part.id, call);
          view.segments!.push(call);
        }
      }
      if (view.content || view.segments!.length) result.push(view);
      continue;
    }
    const call = calls.get(message.toolCallId);
    if (call) {
      call.result = { content: message.content };
      call.isError = message.isError;
      call.status = "done";
    }
  }
  // A completed tool event can survive a crash before its PI message is appended.
  for (const tool of tools) {
    const call = calls.get(tool.toolCallId);
    if (call && tool.result) {
      call.result = { content: tool.result.content };
      call.isError = tool.status === "failed";
      call.status = "done";
    }
  }
  return result;
}
export function governanceLiveSnapshot(snapshot: RuntimeRunSnapshot) {
  const settled = snapshot.messages.map((m) => m.message),
    ids = new Set(snapshot.messages.map((m) => m.id));
  return governanceChatMessages(
    [
      ...settled,
      ...snapshot.pendingMessages
        .filter((m) => !ids.has(m.id))
        .map((m) => m.message),
    ],
    snapshot.toolExecutions,
  );
}
