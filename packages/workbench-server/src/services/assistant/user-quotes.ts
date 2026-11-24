import type { RuntimeMessageRecord } from "@ontomato/contracts/agent-runtime";
import { messageText } from "../../platform/agent-runtime/runtime";

function isUserQuoteRecord(record: RuntimeMessageRecord): boolean {
  return (
    record.message.role === "user" ||
    (record.message.role === "notification" &&
      record.message.kind === "agent-answer" &&
      "kind" in record.message.source &&
      record.message.source.kind === "user")
  );
}

/**
 * Receipt identity fixes the host's known-input boundary for this turn: only messages already consumed
 * by a run (`runId !== null`) and the current input (`inputId`) belong to this turn's conversation
 * context. Queued, unclaimed messages (`runId === null`) waiting for other turns are excluded.
 */
export function recentUserMessages(messages: readonly RuntimeMessageRecord[], inputId: string): string[] {
  const target = messages.find((record) => record.id === inputId)!;
  if (target.runId !== null) {
    return messages
      .filter((record) => record.runId !== null && record.messageSeq <= target.messageSeq && isUserQuoteRecord(record))
      .slice(-10)
      .map((record) => messageText(record.message));
  }
  const consumed = messages
    .filter((record) => record.runId !== null && isUserQuoteRecord(record))
    .sort((a, b) => (a.contextSeq ?? a.messageSeq) - (b.contextSeq ?? b.messageSeq) || a.messageSeq - b.messageSeq);
  const included = isUserQuoteRecord(target) ? [...consumed, target] : consumed;
  return included.slice(-10).map((record) => messageText(record.message));
}
