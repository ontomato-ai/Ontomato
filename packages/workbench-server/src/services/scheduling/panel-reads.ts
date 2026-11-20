import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import {
  platformScheduleFormRequestSchema,
  platformScheduleFormSchema,
  platformSchedulesPath,
  platformTaskListSchema,
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
  return createScheduledTaskReads({
    async list() {
      const response = await backendGet("scheduled-task-list", base, options);
      return platformTaskListSchema.parse(JSON.parse(response.text));
    },
    async task(id) {
      const response = await backendGet("scheduled-task-record", `${base}/${encodeURIComponent(id)}`, options);
      return platformTaskSchema.parse(JSON.parse(response.text));
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
