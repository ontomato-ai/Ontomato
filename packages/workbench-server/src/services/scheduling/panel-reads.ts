import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import {
  platformScheduleApplicationsSchema,
  platformScheduleFormRequestSchema,
  platformScheduleFormSchema,
  platformSchedulesPath,
  platformTaskListSchema,
  platformTaskRunPageSchema,
  platformTaskRunSchema,
  platformTaskSchema,
} from "@ontomato/contracts/platform-schedules";
import { createScheduledTaskReads } from "@ontomato/platform-schedules/panel-reads";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";

export function createScheduledTaskReadAdapter(viewer: AssistantCredentials, signal?: AbortSignal) {
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
    signal,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "") + platformSchedulesPath.slice(DATA_QUERY_GATEWAY.length);
  const taskPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return createScheduledTaskReads({
    async list() {
      const response = await backendGet("scheduled-task-list", base, options);
      return platformTaskListSchema.parse(JSON.parse(response.text));
    },
    async task(id) {
      const response = await backendGet("scheduled-task-record", taskPath(id), options);
      return platformTaskSchema.parse(JSON.parse(response.text));
    },
    async runs(id, cursor) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await backendGet("scheduled-task-runs", `${taskPath(id)}/runs${query}`, options);
      return platformTaskRunPageSchema.parse(JSON.parse(response.text));
    },
    async run(id, runId) {
      const response = await backendGet("scheduled-task-run", `${taskPath(id)}/runs/${encodeURIComponent(runId)}`, options);
      return platformTaskRunSchema.parse(JSON.parse(response.text));
    },
    async applications() {
      const response = await backendGet("scheduled-task-applications", `${base}/applications`, options);
      return platformScheduleApplicationsSchema.parse(JSON.parse(response.text));
    },
    async form(appId, request) {
      const response = await backendPost(
        "scheduled-task-form", `${base}/applications/${encodeURIComponent(appId)}/form`,
        platformScheduleFormRequestSchema.parse(request), options,
      );
      return platformScheduleFormSchema.parse(JSON.parse(response.text));
    },
  }, key => tForLocale(viewer.locale, key));
}
