import { agentHostAgentListSchema } from "@ontomato/contracts/agent-host";
import type { PlatformSchedulesHost } from "@ontomato/platform-schedules";
import { nodeApiGet, nodeApiRequest } from "./api";

/**
 * The host the scheduled-tasks page reads through, built once for every place that shows the page.
 *
 * Two places show it — the platform's own scheduled-tasks page and the agent platform's entry — and both talk to the same
 * two interfaces, so the wiring lives here rather than in each caller:
 *
 * - The page's paths are spelled whole by the contracts (`/api/data-query/platform/scheduled-tasks`) and start at the
 *   gateway's `/api`. `nodeApiRequest` adds this deployment's prefix and the session's credential, and strips that one
 *   segment so it is not doubled.
 * - The agents a task may run come from the Node API (`/assistant/agents`), the same list the conversation shell offers.
 *   The data-query API does not serve it, so asking there answers nothing and the picker stays empty.
 */
export function schedulesHost(options: {
  /** Opens the conversation a run started; a caller without a conversation shows the session id instead. */
  openSession?: (sessionId: string) => void;
  /** The page's language, for weekday names. */
  locale?: () => string;
} = {}): PlatformSchedulesHost {
  return {
    request: (path, init) => nodeApiRequest(path, init),
    agents: async () => agentHostAgentListSchema.parse(await nodeApiGet("/assistant/agents")).agents,
    openSession: options.openSession,
    locale: options.locale,
  };
}
