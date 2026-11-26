import { z } from "zod";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
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
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { withReadDirective } from "../product-panels/read-directive";

const SCHEDULE_LIST_REREAD_MS = 30_000;
const SCHEDULE_RUN_REREAD_MS = 5_000;

const applicationCatalogResponse = z.object({ success: z.literal(true), data: applicationCatalogSchema });

export function createScheduledTaskReadAdapter(viewer: AssistantCredentials, signal?: AbortSignal) {
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
    signal,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "") + platformSchedulesPath.slice(DATA_QUERY_GATEWAY.length);
  const taskPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const locale = resolveLocale(viewer.locale);
  const catalogPath = `${config.dataQuery.baseUrl.replace(/\/$/, "")}/platform/applications?purpose=schedules`;
  async function loadApplicationsStatus() {
    const [response, catalog] = await Promise.all([
      backendGet("scheduled-task-applications", `${base}/applications`, options),
      backendGet("scheduled-task-application-names", catalogPath, options),
    ]);
    const { applications } = platformScheduleApplicationsSchema.parse(JSON.parse(response.text));
    const { data } = applicationCatalogResponse.parse(JSON.parse(catalog.text));
    const entries = new Map(data.map((entry) => [
      entry.id,
      { name: localizedApplicationText(entry.names, locale) ?? entry.id, icon: entry.icon },
    ]));
    const resolved: (typeof applications[number] & { name: string; icon?: string })[] = [];
    const missingIds: string[] = [];
    for (const app of applications) {
      const entry = entries.get(app.id);
      if (!entry) {
        missingIds.push(app.id);
      } else {
        resolved.push({ ...app, name: entry.name, ...(entry.icon ? { icon: entry.icon } : {}) });
      }
    }
    return { applications: resolved, missingIds };
  }
  const reads = createScheduledTaskReads({
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
    applicationsStatus: loadApplicationsStatus,
    async applications() {
      const { applications, missingIds } = await loadApplicationsStatus();
      if (missingIds.length > 0) {
        throw new Error(`The application catalog has no scheduled application '${missingIds[0]}'`);
      }
      return applications;
    },
    async form(appId, request) {
      const response = await backendPost(
        "scheduled-task-form", `${base}/applications/${encodeURIComponent(appId)}/form`,
        platformScheduleFormRequestSchema.parse(request), options,
      );
      return platformScheduleFormSchema.parse(JSON.parse(response.text));
    },
  }, locale, (key, values) => tForLocale(locale, key, values));

  return {
    ...reads,
    async list(params?: { application?: string; search?: string }) {
      const rows = await reads.list(params);
      return rows.some(row => row.outputs?.isRunning === true)
        ? withReadDirective(rows, { rereadAfterMs: SCHEDULE_LIST_REREAD_MS })
        : rows;
    },
    async record(primaryKey: string) {
      const row = await reads.record(primaryKey);
      return row.outputs?.isRunning === true
        ? withReadDirective(row, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS })
        : row;
    },
    async runRecords(primaryKey: string, cursor?: string) {
      const page = await reads.runRecords(primaryKey, cursor);
      return page.rows.some(row => row.outputs?.isRunning === true)
        ? withReadDirective(page, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS })
        : page;
    },
    async runRecord(primaryKey: string, runId?: string) {
      const row = await reads.runRecord(primaryKey, runId);
      return row.outputs?.isRunning === true
        ? withReadDirective(row, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS })
        : row;
    },
  };
}
