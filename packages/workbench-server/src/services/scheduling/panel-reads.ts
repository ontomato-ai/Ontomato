import { createScheduledTaskReads, type ScheduledApplicationsStatus } from "@ontomato/platform-schedules/panel-reads";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readPrincipalDirectory } from "../identity/principal-directory";
import type { ProductOwner } from "../product-governance/service-authentication";
import { withReadDirective } from "../product-panels/read-directive";
import { triggerClient } from "./trigger-client";

const SCHEDULE_LIST_REREAD_MS = 30_000;
const SCHEDULE_RUN_REREAD_MS = 5_000;

export function createScheduledTaskReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, signal?: AbortSignal,
  reuseApplicationsStatus?: (load: () => Promise<ScheduledApplicationsStatus>) => Promise<ScheduledApplicationsStatus>,
) {
  const client = triggerClient(viewer, signal);
  const locale = resolveLocale(viewer.locale);
  const context = { owner, credentials: { ...viewer, locale } };
  const loadApplicationsStatus = async () => (await import("./applications")).readTriggerApplications(context, signal);
  const applicationsStatus = reuseApplicationsStatus
    ? () => reuseApplicationsStatus(loadApplicationsStatus)
    : loadApplicationsStatus;
  const applications = async () => (await applicationsStatus()).applications;
  const reads = createScheduledTaskReads({
    ...client,
    applicationsStatus,
    async findMembers(keyword, limit) {
      return (await readPrincipalDirectory(viewer, { kind: "member", keyword, limit })).options;
    },
    describeTargets: async (tasks, directory) => (await import("./applications")).describeTriggerTargets(tasks, directory, context),
    async targets() {
      const [capabilities, entries] = await Promise.all([client.targets(), applications()]);
      return { ...capabilities, applications: entries };
    },
  }, locale, (key, values) => tForLocale(locale, key, values));

  return {
    ...reads,
    async count() { return { rows: [], total: await client.count() }; },
    async list(params?: Parameters<typeof reads.list>[0]) {
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
