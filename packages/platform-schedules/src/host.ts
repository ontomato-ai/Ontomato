import type { Component } from "vue";
import type { PlatformScheduleResultLink } from "@ontomato/contracts/platform-schedules";

/** One of the platform's applications, named and drawn the way the rail draws it. */
export interface PlatformSchedulesHostApp {
  id: string;
  label: string;
  icon: Component;
}

/**
 * What a host supplies to show the scheduled tasks page. The page keeps no global state, reads no credential and knows
 * no router: the host answers every request, names the applications and opens results. Which applications can run on a
 * schedule, which tasks exist and what each application's form holds are the service's answers, so a host neither
 * filters nor vouches for any of them.
 */
export interface PlatformSchedulesHost {
  /**
   * Authenticated request to a path the contracts already spell in full, e.g.
   * `GET /api/data-query/platform/scheduled-tasks?appId=agents`. The path starts at the gateway's API root
   * (`platformSchedulesPath` includes `/api/data-query`), so the host adds only its deployment prefix — the page's base
   * path and any tenant segment — and never a second `/api/data-query`.
   *
   * A refusal either resolves with its non-2xx response or throws the host's own error carrying the HTTP `status` and
   * the parsed JSON body as `payload` (what the workbench's request layer throws). The page reads the service's error
   * body from either to tell a changed form from a field error or a running task. A request that got no answer from the
   * service throws without a status: the page then cannot know whether it happened.
   */
  request(path: string, init: RequestInit): Promise<Response>;
  /**
   * The platform's applications in rail order, with the name and icon the rail shows (the platform's application
   * declarations). The page lists the ones the service says can run on a schedule, in this order; it never names an
   * application itself.
   */
  applications(): readonly PlatformSchedulesHostApp[];
  /**
   * Opens a result where its application shows it. The link is an unprefixed same-origin path the application gave; the
   * host's router resolves it and adds the deployment prefix.
   */
  openResult(link: PlatformScheduleResultLink): void;
}
