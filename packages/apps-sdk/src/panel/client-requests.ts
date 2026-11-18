import { platformSchedulesPath } from "@ontomato/contracts/platform-schedules";

/*
 * The requests the SDK's platform clients send, by the binding that reaches each client (overall design 3.2, 5.1). A
 * projection binds a platform object type or a platform operation, and the client this version registers for that
 * binding (`schedules.ts`) is what a panel's components read and write through. This is the one place that says which
 * requests those clients make: the clients send nothing else, and the platform admits a panel frame's request only when
 * a binding of one of the panel's own projections declares it (`platform-web/src/app-host.ts`).
 *
 * It is plain data with no Vue and no edition, so the platform's host imports it from here rather than writing its own
 * list of these paths.
 */

/** The platform object type of the scheduled tasks, as a projection binds it. */
export const SCHEDULED_TASK = "platform:ScheduledTask";
/** The platform operation that runs one scheduled task now, as a projection binds it. */
export const RUN_NOW = "schedules.runNow";

/**
 * The gateway prefix the scheduled tasks' contract spells its paths with. A frame's request names the service and the
 * path inside it, as the platform's app host takes them, so the prefix becomes the service.
 */
export const DATA_QUERY_GATEWAY = "/api/data-query";

/** One request a client sends: its method, the platform service it goes to and the path inside that service. */
export interface ClientRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  service: "" | "/data-query";
  path: RegExp;
}

/** A binding as a projection record names it, `<kind>:<id>`: `PlatformObjectType:platform:ScheduledTask`. */
export const bindingKey = (binding: { kind: string; id: string }) => `${binding.kind}:${binding.id}`;

const tasks = platformSchedulesPath.slice(DATA_QUERY_GATEWAY.length);
/** A task's ID is a UUID, so no other segment of the service (`applications`, `credential`) reads as a task. */
const task = `${tasks}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;

/** Each binding's requests: what its client sends, and nothing more. */
export const clientRequests: Readonly<Record<string, readonly ClientRequest[]>> = {
  [bindingKey({ kind: "PlatformObjectType", id: SCHEDULED_TASK })]: [
    // The reader's tasks, one task, its application's form for given values, and the save at the task's revision.
    { method: "GET", service: "/data-query", path: new RegExp(`^${tasks}$`) },
    { method: "GET", service: "/data-query", path: new RegExp(`^${task}$`) },
    { method: "POST", service: "/data-query", path: new RegExp(`^${tasks}/applications/[^/?]+/form$`) },
    { method: "PUT", service: "/data-query", path: new RegExp(`^${task}$`) },
  ],
  [bindingKey({ kind: "PlatformOperation", id: RUN_NOW })]: [
    { method: "POST", service: "/data-query", path: new RegExp(`^${task}/runs$`) },
  ],
};

/** Whether one of the given bindings' clients sends this request. */
export function clientSends(bindings: Iterable<string>, method: string, service: string, path: string): boolean {
  for (const binding of bindings)
    if (clientRequests[binding]?.some((request) => request.method === method && request.service === service && request.path.test(path)))
      return true;
  return false;
}
