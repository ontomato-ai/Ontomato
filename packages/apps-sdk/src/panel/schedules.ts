import { scheduledTaskPanelOperations } from "@ontomato/platform-schedules/panel-operations";
import { createSchedulesApi, scheduleFailure, type PlatformSchedulesHost } from "@ontomato/platform-schedules";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { formFieldKey } from "@ontomato/contracts/form-fields";
import { randomId } from "@ontomato/contracts/random-id";
import { contextTransport, type AppContext } from "../context";
import { registerHandler } from "./handlers";
import { PlatformObjectRefusal, registerPlatformObject, type PlatformObjectRecord } from "./platform-objects";
import { DATA_QUERY_GATEWAY, RUN_NOW, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";

/*
 * The scheduled tasks as a platform object a projection may bind (overall design 3.2, 10.1): reading one, listing the
 * reader's tasks, the application's own dynamic form for one, and writing it back. Every call goes through
 * `createSchedulesApi` over this frame's request path, so the scheduled-tasks service decides what the reader may see,
 * which fields an application's form has and whether a save is valid; nothing here reimplements any of it.
 *
 * A task's revision travels with the form it was read with: the save sends that revision, so a task somebody else
 * changed after the reader opened it is refused by the service (409) and the reader is told, rather than their change
 * silently replacing the other one. Nothing here re-reads and retries.
 *
 * The one operation this step's panels use — running a task now — is registered here too, as the handler a projection
 * bound to `schedules.runNow` reaches.
 *
 * The requests these send are declared in the contracts' `panel-client-requests.ts`, by binding: a request this client
 * starts sending must be declared there, or the platform refuses it from a panel's frame.
 */

/** The scheduled tasks' request path inside a panel frame: the SDK's own client, over this frame's credential. */
export function schedulesHost(context: AppContext): PlatformSchedulesHost {
  const transport = contextTransport(context);
  return {
    request: (path, init) => transport.request(path.slice(DATA_QUERY_GATEWAY.length), init, "/data-query"),
    // A panel shows tasks; the platform that mounts it owns the applications it names and where a result opens.
    applications: () => [],
    openResult: () => {},
  };
}

/**
 * The task as a summary shows it: the service's own summary lines, its schedule, and whether it is on, paused or off.
 * All of it is the service's, read as it is.
 */
function record(task: PlatformTask): PlatformObjectRecord {
  return {
    primaryKey: task.id,
    label: task.title,
    fields: {
      application: task.appId,
      settings: task.summary.map((item) => `${item.label}: ${item.value}`).join("; "),
      state: task.enabled ? (task.pause === null ? "on" : `paused: ${task.pause.message}`) : "off",
      nextRun: task.nextRunAt ?? "",
      lastRun: task.lastRun?.status ?? "",
    },
  };
}

/**
 * The service's refusal of a save, as a generic form shows it: the service's own reason, and the message for each of the
 * task's content fields it names (`/content/<key>`), by key. A failure the service did not answer is passed on as it is.
 */
function refused(error: unknown): unknown {
  const { refusal } = scheduleFailure(error);
  if (!refusal) return error;
  const fields = Object.fromEntries(
    (refusal.fields ?? []).flatMap((field) => {
      const key = formFieldKey(field.field, "/content/");
      return key === null ? [] : [[key, field.message]];
    }),
  );
  return new PlatformObjectRefusal(refusal.message, fields, { cause: error });
}

/**
 * Registers the scheduled tasks this version's panels read and write: the list, one task, its application's form (which
 * the application answers again when a field it depends on changes), and the save at the task's own revision. Then
 * `schedules.runNow`, which runs one task now and leaves its schedule as it is.
 */
export function registerSchedulesPlatformObject(context: AppContext): void {
  const host = schedulesHost(context);
  const api = createSchedulesApi(host);
  const operations = scheduledTaskPanelOperations(host);

  /** The task's application's form for the values it holds, with the task's revision. */
  async function form(task: PlatformTask, values: Readonly<Record<string, string>>, changedField: string | null) {
    const answer = await api.form(task.appId, { values, changedField, taskId: task.id, timeZone: task.timeZone });
    return { fields: answer.fields, values: answer.values, revision: task.revision };
  }

  registerPlatformObject({
    objectType: SCHEDULED_TASK,
    async list() {
      return (await api.list(null)).tasks.map(record);
    },
    async read(primaryKey) {
      return record(await api.task(primaryKey));
    },
    async form(primaryKey) {
      const task = await api.task(primaryKey);
      return form(task, task.content, null);
    },
    async changed(primaryKey, values, field) {
      return form(await api.task(primaryKey), values, field);
    },
    async save(primaryKey, values, revision) {
      try {
        return record(await operations.save(primaryKey, values, revision));
      } catch (error) {
        throw refused(error);
      }
    },
  });

  registerHandler({
    handlerRef: RUN_NOW,
    async invoke({ target }) {
      if (target?.kind !== "object") throw new Error("Run now acts on the selected task");
      // The service replays a repeated key with the run it created; this one is new per call.
      const run = await operations.runNow(target.primaryKey, randomId());
      return { runId: run.id, status: run.status, trigger: run.trigger };
    },
  });
}
