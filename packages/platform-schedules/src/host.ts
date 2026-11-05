import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PlatformTaskFunctionTarget } from "@ontomato/contracts/platform-schedules";

/**
 * What a host supplies to show the platform scheduled tasks page. The page keeps no global state and reads no
 * credential itself: the host answers every request through `request`, exactly like the conversation shell's
 * `createAgentHostClient({ request })`. Everything the page shows beyond the agents is the service's answer — which
 * tasks exist, who may see them, which functions a task may run — so a host does not filter or vouch for any of it.
 */
export interface PlatformSchedulesHost {
  /**
   * Authenticated request to a path the contracts already spell in full, e.g.
   * `GET /api/data-query/platform/scheduled-tasks?appId=agents`. The path starts with the gateway's API root
   * (`platformSchedulesPath` includes `/api/data-query`), so the host adds only its deployment prefix — the page's base
   * path and any tenant segment — and never a second `/api/data-query`. Resolves only for 2xx responses and throws its
   * own error otherwise, so error display stays with the host; the page reads a refusal's status when it needs to tell
   * "not allowed" from "failed".
   */
  request(path: string, init: RequestInit): Promise<Response>;
  /** The agents a scheduled task may run, with the name the list shows. Same list the conversation shell offers. */
  agents(): Promise<AgentHostAgent[]>;
  /**
   * Opens the conversation a scheduled agent run started. Runs read from the host's own session list; a host without
   * this opens nothing and the run row shows the session ID instead.
   */
  openSession?(sessionId: string): void;
  /** The page's current language, used to name weekdays; omitted reads English. */
  locale?(): string;
}

/** One function a task can call, as the picker shows it: what the service's function-targets answer carries. */
export type PlatformScheduleFunction = PlatformTaskFunctionTarget;
