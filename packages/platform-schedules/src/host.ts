import type { AgentHostAgent } from "@ontomato/contracts/agent-host";

/**
 * What a host supplies to show the platform scheduled tasks page. The page keeps no global state and reads no
 * credential itself: the host answers every request through `request`, exactly like the conversation shell's
 * `createAgentHostClient({ request })`.
 */
export interface PlatformSchedulesHost {
  /**
   * Authenticated request to a path relative to the platform inside the gateway, e.g.
   * `GET /platform/scheduled-tasks?appId=agents`. Resolves only for 2xx responses and throws the host's own error
   * otherwise, so error display stays with the host. The paths are those of
   * `@ontomato/contracts/platform-schedules` (`platformSchedulesPath` plus a sub-path).
   */
  request(path: string, init: RequestInit): Promise<Response>;
  /** The agents a scheduled task may run, with the name the list shows. Same list the conversation shell offers. */
  agents(): Promise<AgentHostAgent[]>;
  /**
   * The zero-parameter write functions a scheduled task may run. The data engine refuses anything else, so hosts list
   * only what it accepts (`OPERATION_WRITE` with no parameters, in the current domain).
   */
  functions(): Promise<readonly PlatformScheduleFunction[]>;
  /**
   * Opens the conversation a scheduled agent run started. Runs read from the host's own session list; a host without
   * this opens nothing and the run row shows the session ID instead.
   */
  openSession?(sessionId: string): void;
  /** The page's current language, used to name weekdays; omitted reads English. */
  locale?(): string;
}

/** One function a task can call, as the function picker shows it. */
export interface PlatformScheduleFunction {
  id: string;
  name: string;
  description?: string | null;
}
