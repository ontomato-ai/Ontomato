import prompt from "./agent-visibility-prompt.json" with { type: "json" };
import type { AgentRunContext } from "./agent-channel";

export const USER_VISIBILITY_PROMPT = prompt.user;
export const DELEGATED_VISIBILITY_PROMPT = prompt.delegated;
export const MID_ROUND_RESULT_NOTIFICATION_FACT = prompt.midRoundResultNotification;

export function isDirectUserRun(
  channel: Pick<AgentRunContext, "requestedBy" | "agent" | "userRecipient">,
  sessionId: string,
): boolean {
  const recipient = channel.userRecipient?.session;
  return !channel.requestedBy && recipient?.providerId === channel.agent.providerId &&
    recipient.sessionId === sessionId;
}
