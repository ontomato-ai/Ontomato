import type { Message } from "@earendil-works/pi-ai";

/** Port of the existing Harness character estimate and provider-usage policy for PI messages. */
export function estimateTokens(message: Message): number {
  if (typeof message.content === "string")
    return Math.ceil(message.content.length / 4);
  let chars = 0;
  for (const part of message.content) {
    if (part.type === "text") chars += part.text.length;
    else if (part.type === "image") chars += 4800;
    else if (part.type === "thinking") chars += part.thinking.length;
    else if (part.type === "toolCall")
      chars += part.name.length + JSON.stringify(part.arguments).length;
  }
  return Math.ceil(chars / 4);
}
export function contextTokens(
  messages: Message[],
  system: string,
  tools: unknown,
  ignoreUsageBefore: number,
) {
  const heuristic = messages.reduce(
    (sum, m) => sum + estimateTokens(m),
    Math.ceil((system.length + JSON.stringify(tools).length) / 4),
  );
  // Retained pre-compaction usage describes the old, larger request and cannot size the new context.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.role === "assistant" &&
      m.timestamp > ignoreUsageBefore &&
      m.stopReason !== "error" &&
      m.stopReason !== "aborted"
    )
      return Math.max(
        heuristic,
        m.usage.totalTokens +
          messages
            .slice(i + 1)
            .reduce((sum, row) => sum + estimateTokens(row), 0),
      );
  }
  return heuristic;
}
/** Same recent-window budget and tool-pair cut boundary as the existing persistent Harness. */
export function cutPoint(messages: Message[], contextWindow: number) {
  const keep = Math.min(20000, Math.max(1, Math.floor(contextWindow * 0.2)));
  let tokens = 0,
    threshold = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    tokens += estimateTokens(messages[i]!);
    if (tokens >= keep) {
      threshold = i;
      break;
    }
  }
  while (threshold > 0 && messages[threshold]?.role === "toolResult")
    threshold--;
  return threshold;
}
export function serializeConversation(messages: Message[]) {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .flatMap((p) => (p.type === "text" ? [p.text] : []))
              .join("");
      if (text) parts.push(`[User]: ${text}`);
    } else if (message.role === "assistant") {
      const text: string[] = [],
        thinking: string[] = [],
        calls: string[] = [];
      for (const block of message.content) {
        if (block.type === "text") text.push(block.text);
        else if (block.type === "thinking") thinking.push(block.thinking);
        else if (block.type === "toolCall")
          calls.push(
            `${block.name}(${Object.entries(block.arguments)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")})`,
          );
      }
      if (thinking.length)
        parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      if (text.length) parts.push(`[Assistant]: ${text.join("\n")}`);
      if (calls.length)
        parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    } else if (message.role === "toolResult") {
      const text = message.content
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("");
      if (text)
        parts.push(
          `[Tool result]: ${text.length <= 2000 ? text : `${text.slice(0, 2000)}\n\n[... ${text.length - 2000} more characters truncated]`}`,
        );
    }
  }
  return parts.join("\n\n");
}
