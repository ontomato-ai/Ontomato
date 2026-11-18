import { createSchedulesApi, type SchedulesApi } from "./api";
import type { PlatformSchedulesHost } from "./host";

/** Pure owner request orchestration, shared by the browser panel and the server coordinator. */
export function scheduledTaskPanelOperations(host: Pick<PlatformSchedulesHost, "request">) {
  const api: SchedulesApi = createSchedulesApi({ ...host, applications: () => [], openResult: () => {} });
  return {
    async save(id: string, values: Readonly<Record<string, string>>, revision: number) {
      const task = await api.task(id);
      const form = await api.form(task.appId, { values, changedField: null, taskId: task.id, timeZone: task.timeZone });
      return api.update(task.id, {
        title: task.title, appId: task.appId, content: values, formRevision: form.formRevision,
        frequency: task.frequency, timeZone: task.timeZone, notifyEmail: task.notifyEmail,
        // The caller's observed revision survives the preparatory reads; a concurrent edit remains a conflict.
        revision,
      });
    },
    runNow: (id: string, intentId: string) => api.runNow(id, intentId),
  };
}
