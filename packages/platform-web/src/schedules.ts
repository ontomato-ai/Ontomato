import { nodeApiRequest } from "@ontomato/workbench-ui";
import type { PlatformSchedulesHost } from "@ontomato/platform-schedules";

/**
 * The platform's scheduled tasks, reached through the data engine's gateway resource.
 *
 * The contracts spell the whole path (`/api/data-query/platform/scheduled-tasks`), so the request adds only this
 * deployment's prefix and never a second `/api/data-query`: the platform is served under one prefix and the gateway holds
 * the rest.
 */
export function schedulesHost(options: {
  /** The shell's session list, so a run can open the conversation it started. */
  openSession?: (sessionId: string) => void;
  agents: PlatformSchedulesHost["agents"];
  locale?: () => string;
}): PlatformSchedulesHost {
  return {
    // The contract's path starts at the gateway's `/api`; the app's request helper adds this deployment's prefix and the
    // session's credential, and strips that first segment so it is not doubled.
    request: (path, init) => nodeApiRequest(path, init),
    agents: options.agents,
    openSession: options.openSession,
    locale: options.locale,
  };
}
