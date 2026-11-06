import type { PlatformSchedulesHost } from "@ontomato/platform-schedules";
import { nodeApiRequest } from "./api";

/**
 * The host the scheduled tasks page reads through.
 *
 * The page's paths are spelled whole by the contracts (`/api/data-query/platform/scheduled-tasks`) and start at the
 * gateway's `/api`. `nodeApiRequest` adds this deployment's prefix and the session's credential, and strips that one
 * segment so it is not doubled. A refusal comes back as the request layer's error, which carries the HTTP status and the
 * parsed body (`status`, `payload`): the page reads the service's error code from it to tell a changed form or a
 * running task from a failure.
 *
 * The applications and the way to a result belong to the platform that mounts the page (the rail's partition and its
 * router), which hands them in.
 */
export function schedulesHost(options: Pick<PlatformSchedulesHost, "applications" | "openResult">): PlatformSchedulesHost {
  return {
    request: (path, init) => nodeApiRequest(path, init),
    applications: options.applications,
    openResult: options.openResult,
  };
}
