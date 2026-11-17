import { createSchedulesApi, type PlatformSchedulesHost } from "@ontomato/platform-schedules";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { randomId } from "@ontomato/contracts/random-id";
import { contextTransport, type AppContext } from "../context";
import { registerHandler } from "./handlers";
import { registerPlatformObject, type PlatformObjectRecord } from "./platform-objects";

/*
 * The scheduled tasks as a platform object a projection may bind (overall design 3.2, 10.1): reading one, listing the
 * reader's tasks, the application's own dynamic form for one, and writing it back. Every call goes through
 * `createSchedulesApi` over this frame's request path, so the scheduled-tasks service decides what the reader may see,
 * which fields an application's form has and whether a save is valid; nothing here reimplements any of it.
 *
 * The one operation this step's panels use — running a task now — is registered here too, as the handler a projection
 * bound to `schedules.runNow` reaches.
 */

/** The scheduled tasks' request path inside a panel frame: the SDK's own client, over this frame's credential. */
export function schedulesHost(context: AppContext): PlatformSchedulesHost {
  const transport = contextTransport(context);
  return {
    request: (path, init) => transport.request(path, init, "/data-query"),
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
 * Registers the scheduled tasks this version's panels read and write: the list, one task, its application's form (which
 * the application answers again when a field it depends on changes), and the save. Then `schedules.runNow`, which runs
 * one task now and leaves its schedule as it is.
 */
export function registerSchedulesPlatformObject(context: AppContext): void {
  const api = createSchedulesApi(schedulesHost(context));

  async function task(primaryKey: string): Promise<PlatformTask> {
    return api.task(primaryKey);
  }

  async function form(task: PlatformTask, values: Readonly<Record<string, string>>, changedField: string | null) {
    const answer = await api.form(task.appId, { values, changedField, taskId: task.id, timeZone: task.timeZone });
    return { fields: answer.fields, values: answer.values };
  }

  registerPlatformObject({
    objectType: "platform:ScheduledTask",
    async list() {
      return (await api.list(null)).tasks.map(record);
    },
    async read(primaryKey) {
      return record(await task(primaryKey));
    },
    async form(primaryKey) {
      // A task the reader selected: its own application answers, with its own current values.
      const current = await task(primaryKey!);
      return form(current, current.content, null);
    },
    async changed(primaryKey, values, field) {
      return form(await task(primaryKey!), values, field);
    },
    async save(primaryKey, values) {
      if (!primaryKey) throw new Error("The panels of this step change a task; they do not create one");
      const current = await task(primaryKey);
      const asked = await api.form(current.appId, { values, changedField: null, taskId: current.id, timeZone: current.timeZone });
      return record(
        await api.update(current.id, {
          title: current.title,
          appId: current.appId,
          content: values,
          formRevision: asked.formRevision,
          frequency: current.frequency,
          timeZone: current.timeZone,
          notifyEmail: current.notifyEmail,
          revision: current.revision,
        }),
      );
    },
  });

  registerHandler({
    handlerRef: "schedules.runNow",
    async invoke({ target }) {
      if (target?.kind !== "object") throw new Error("Run now acts on the selected task");
      // The service replays a repeated key with the run it created; this one is new per call, so this is a new run.
      const run = await api.runNow(target.primaryKey, randomId());
      return { runId: run.id, status: run.status, trigger: run.trigger };
    },
  });
}
