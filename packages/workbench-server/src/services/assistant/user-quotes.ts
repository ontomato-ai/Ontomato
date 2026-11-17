import type { RuntimeMessageRecord } from "@ontomato/contracts/agent-runtime";
import { messageText } from "../../platform/agent-runtime/runtime";

/** Receipt identity fixes the host's known-input boundary, including inputs in this run. */
export function recentUserMessages(messages: readonly RuntimeMessageRecord[], inputId: string): string[] {
  const through = messages.find(record => record.id === inputId)!.messageSeq;
  return messages.filter(record => record.messageSeq <= through && (record.message.role === "user" ||
    (record.message.role === "notification" && record.message.kind === "agent-answer" && "kind" in record.message.source && record.message.source.kind === "user")))
    .slice(-10).map(record => messageText(record.message));
}
