import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";

/**
 * The only rule for which message is a run's final answer. On a normal stop it is the run's last model
 * assistant message, provided it has text and no tool call; no earlier message stands in for it. A run that
 * stopped for any other reason has no answer: its text stays process.
 */
export function answerMessageId(
  stopReason: RuntimeStopReason | null,
  messages: { id: string; message: RuntimeMessage }[],
): string | null {
  if (stopReason !== "stop") return null;
  const last = [...messages].reverse().find(({ message }) => message.role === "assistant" && message.origin !== "runtime");
  if (last?.message.role !== "assistant") return null;
  const content = last.message.content;
  return content.some((part) => part.type === "toolCall") ||
    !content.some((part) => part.type === "text" && part.text.trim())
    ? null
    : last.id;
}
