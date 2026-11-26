import { z } from "zod";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import {
  platformScheduleFormRequestSchema,
  platformScheduleFormSchema,
  platformSchedulesPath,
  platformTaskListSchema,
  platformTaskRunPageSchema,
  platformTaskRunSchema,
  platformTaskSchema,
  platformTriggerTargetsSchema,
} from "@ontomato/contracts/platform-schedules";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";

const countSchema = z.object({ total: z.number().int().nonnegative() });

/** Reads the authoritative definitions and runs as the current viewer, without resolving application-owned labels. */
export function triggerClient(viewer: AssistantCredentials, signal?: AbortSignal) {
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
    signal,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "") + platformSchedulesPath.slice(DATA_QUERY_GATEWAY.length);
  const taskPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
  async function get<T>(label: string, path: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse((await backendGet(label, path, options)).text));
  }
  return {
    list: (includeCredentialStatus = false) => get(
      "trigger-list", includeCredentialStatus ? `${base}?includeCredentialStatus=true` : base, platformTaskListSchema,
    ),
    async count() {
      return (await get("trigger-count", `${base}?countOnly=true`, countSchema)).total;
    },
    targets: () => get("trigger-capability-targets", `${base}/targets`, platformTriggerTargetsSchema),
    task: (id: string) => get("trigger-record", taskPath(id), platformTaskSchema),
    runs: (id: string, cursor?: string | null) => get("trigger-runs",
      `${taskPath(id)}/runs${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, platformTaskRunPageSchema),
    run: (id: string, runId: string) => get("trigger-run", `${taskPath(id)}/runs/${encodeURIComponent(runId)}`, platformTaskRunSchema),
    async form(appId: string, request: z.input<typeof platformScheduleFormRequestSchema>) {
      const response = await backendPost(
        "trigger-application-form", `${base}/applications/${encodeURIComponent(appId)}/form`,
        platformScheduleFormRequestSchema.parse(request), options,
      );
      return platformScheduleFormSchema.parse(JSON.parse(response.text));
    },
  };
}
