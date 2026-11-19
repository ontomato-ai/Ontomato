import { scheduledTaskPanelOperations, scheduledTaskPanelSaveSchema, scheduledTaskSaveDescription } from "@ontomato/platform-schedules/panel-operations";
import { createSchedulesApi, scheduleFailure, type PlatformSchedulesHost } from "@ontomato/platform-schedules";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { formFieldKey, formFieldPointer, formValuesSchema, type FormField, type FormFieldError } from "@ontomato/contracts/form-fields";
import { randomId } from "@ontomato/contracts/random-id";
import type { PanelFormDescription, PanelFormField, PanelFormRequest, PanelFormSaveInput } from "@ontomato/contracts/panel-projection";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import { contextTransport, type AppContext } from "../context";
import { registerHandler } from "./handlers";
import { PlatformObjectRefusal, type PlatformObjectAdapterFactory, type PlatformObjectRecord } from "./platform-objects";
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
function fieldErrors(errors: readonly FormFieldError[], fieldPath: (key: string) => string) {
  return Object.fromEntries(errors.flatMap((field) => {
    const key = formFieldKey(field.field, "/content/") ?? formFieldKey(field.field, "/values/");
    return key === null ? [] : [[fieldPath(key), field.message]];
  }));
}
function refused(error: unknown, fieldPath: (key: string) => string): unknown {
  const { refusal } = scheduleFailure(error);
  if (!refusal) return error;
  return new PlatformObjectRefusal(refusal.message, fieldErrors(refusal.fields ?? [], fieldPath), { cause: error });
}

/** The scheduled tasks' owner requests, as the typed adapter sends them. */
function schedulesResource(host: PlatformSchedulesHost, fieldPath: (key: string) => string) {
  const api = createSchedulesApi(host);
  const operations = scheduledTaskPanelOperations(host);
  return {
    async list() {
      return (await api.list(null)).tasks.map(record);
    },
    async read(primaryKey: string) {
      return record(await api.task(primaryKey));
    },
    async form(primaryKey: string, values: Record<string, string> | undefined, changedField: string | null) {
      const task = await api.task(primaryKey);
      const answer = await api.form(task.appId, {
        values: values ?? task.content, changedField, taskId: task.id, timeZone: task.timeZone,
      });
      return { answer, revision: task.revision };
    },
    async save(primaryKey: string, values: Record<string, string>, revision: number) {
      try {
        return record(await operations.save(primaryKey, values, revision));
      } catch (error) {
        throw refused(error, fieldPath);
      }
    },
  };
}

function typedField(field: FormField): PanelFormField {
  const { key, label, required, defaultValue, help } = field;
  const common = { path: formFieldPointer("/", key), label, required, defaultValue, help, readOnly: false };
  return field.type === "select"
    ? { ...common, control: { kind: "select", options: field.options }, valueSchema: { type: "string" },
      refreshOnChange: field.refreshOnChange }
    : { ...common, control: { kind: "text", multiline: field.multiline, placeholder: field.placeholder, maxLength: field.maxLength },
      valueSchema: { type: "string", maxLength: field.maxLength } };
}

const taskId = (target: PanelFormTarget) => {
  if (target.kind !== "object" || target.objectType !== SCHEDULED_TASK) throw new Error("Select a scheduled task");
  return target.primaryKey;
};

const taskFieldPath = (key: string) => formFieldPointer("/", key);

/** The typed panel adapter keeps the application's original string values and the actual task revision. */
export const scheduledTaskAdapters: PlatformObjectAdapterFactory = requests => {
  const resource = schedulesResource({
    request: (path, init) => requests.request(path.slice(DATA_QUERY_GATEWAY.length), init, "/data-query"),
    applications: () => [],
    openResult: () => {},
  }, taskFieldPath);
  const forms = {
    async describe({ target, values, changedField }: PanelFormRequest): Promise<PanelFormDescription> {
      const id = taskId(target);
      const { answer, revision } = await resource.form(
        id, values === undefined ? undefined : formValuesSchema.parse(values),
        changedField === null ? null : formFieldKey(changedField, "/"),
      );
      if (values !== undefined && changedField === null && !answer.submittable) {
        throw new PlatformObjectRefusal(
          answer.errors[0]?.message ?? "The scheduled task form is incomplete",
          fieldErrors(answer.errors, taskFieldPath),
        );
      }
      return { fields: answer.fields.map(typedField), values: answer.values, revision, save: scheduledTaskSaveDescription(id) };
    },
    save(target: PanelFormTarget, input: PanelFormSaveInput) {
      const { values, revision } = scheduledTaskPanelSaveSchema.parse(input);
      return resource.save(taskId(target), values, revision);
    },
  };
  return [{ objectType: SCHEDULED_TASK, list: resource.list, read: resource.read, forms }];
};

export function registerScheduledTaskRunNow(context: AppContext): void {
  const { runNow } = scheduledTaskPanelOperations(schedulesHost(context));
  registerHandler({
    handlerRef: RUN_NOW,
    async invoke({ target }) {
      if (target?.kind !== "object") throw new Error("Run now acts on the selected task");
      const run = await runNow(target.primaryKey, randomId());
      return { runId: run.id, status: run.status, trigger: run.trigger };
    },
  });
}
