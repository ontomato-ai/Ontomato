import { messageText } from "../../platform/agent-runtime/runtime";

type ConversationMessage = {
  runId: string;
  message: { role: string; content: unknown; timestamp: number };
};

/**
 * The host supplies the user's own words to the caller scope. The current turn is
 * not in the runtime session yet, so append it and keep only the last ten.
 */
export function recentUserMessages(
  messages: readonly ConversationMessage[],
  currentRunId: string,
  currentMessage: string,
  currentTimestamp: number,
): string[] {
  const quotes = messages
    .filter(
      (record) => record.message.role === "user" && record.runId !== currentRunId,
    )
    .map((record) => ({
      text: messageText(record.message),
      at: record.message.timestamp,
    }))
    .filter((record) => record.text.trim().length > 0);
  quotes.push({ text: currentMessage, at: currentTimestamp });
  return quotes
    .sort((left, right) => left.at - right.at)
    .slice(-10)
    .map((record) => record.text);
}
