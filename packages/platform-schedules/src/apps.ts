import type { Component } from "vue";
import type { PlatformScheduleApplications } from "@ontomato/contracts/platform-schedules";
import type { PlatformSchedulesHostApp } from "./host";

/** An application that can run on a schedule: the rail's name and icon joined with the service's answer for it. */
export interface ScheduleApp {
  id: string;
  label: string;
  icon: Component;
  /** What the application can do on a schedule, in its own words (its scheduling declaration's); null says nothing. */
  description: string | null;
  available: boolean;
  unavailableReason: string | null;
  taskCount: number;
}

/**
 * The service says which applications declare a schedule form; the host says what they are called, how they are drawn
 * and in which order the rail lists them. The two meet by ID, in the rail's order. An application the service declares
 * but the host does not know is an assembly fault: it is reported, never given a guessed name.
 */
export function joinApplications(
  host: readonly PlatformSchedulesHostApp[],
  served: PlatformScheduleApplications,
): { apps: ScheduleApp[]; missing: string[] } {
  const byId = new Map(served.applications.map((application) => [application.id, application]));
  const apps = host.flatMap((app): ScheduleApp[] => {
    const application = byId.get(app.id);
    return application
      ? [
          {
            id: app.id,
            label: app.label,
            icon: app.icon,
            description: application.description,
            available: application.available,
            unavailableReason: application.unavailableReason,
            taskCount: application.taskCount,
          },
        ]
      : [];
  });
  const known = new Set(host.map((app) => app.id));
  return { apps, missing: served.applications.filter((application) => !known.has(application.id)).map(({ id }) => id) };
}
