import { qualifiedTable } from "../../postgres.js";
import { getTableColumns, type QueryableClient } from "../helpers.js";

/**
 * Single authority for report results + schedule rule retirement.
 *
 * 1. Schedule rows that never carried a report are deleted from the task table. Their rules are not carried over:
 *    scheduled tasks were rebuilt on the agent runtime and the old rules are dropped at the agent-runtime cutover.
 *    Dirty rows that are both a rule and once carried report results keep the task row as one report run.
 * 2. Task rows missing payload but holding result_report get a minimal backfill, so old task reviews never lose the body.
 * 3. Retires the report copy columns, schedule columns, and task snapshot table on the task table.
 */

export const REPORT_AUTHORITY_SPLIT_VERSION = "20260828_report_authority_schedule_split_v1";
export const REPORT_AUTHORITY_SPLIT_NAME = "report payload authority and schedule rule split v1";

const NOW_MS_SQL = "(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint";

export interface ReportAuthoritySplitResult {
  removedRuleRows: number;
  keptDirtyRuleRows: number;
  backfilledPayloads: number;
}

export async function migrateReportAuthorityScheduleSplit(
  client: QueryableClient
): Promise<ReportAuthoritySplitResult> {
  const taskColumns = await getTableColumns(client, "analysis_tasks");
  const hasSchedule = taskColumns.has("schedule_enabled");
  const hasReport = taskColumns.has("result_report");

  const keptDirtyRuleRows = hasSchedule ? await countDirtyRuleRows(client, hasReport) : 0;
  const removedRuleRows = hasSchedule ? await removeMovedRuleRows(client, hasReport) : 0;
  const backfilledPayloads = hasReport ? await backfillPayloadsFromReport(client) : 0;

  await retireLegacyArtifacts(client);

  return { removedRuleRows, keptDirtyRuleRows, backfilledPayloads };
}

/** Report traces: the presence of either payload or result_report means report results were once carried. */
function reportTraceSql(hasReport: boolean): string {
  return hasReport
    ? "(analysis_payload IS NOT NULL OR NULLIF(result_report, '') IS NOT NULL)"
    : "analysis_payload IS NOT NULL";
}

async function countDirtyRuleRows(client: QueryableClient, hasReport: boolean): Promise<number> {
  const result = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM ${qualifiedTable("analysis_tasks")}
    WHERE schedule_enabled = true AND ${reportTraceSql(hasReport)}
  `);
  return Number(result.rows[0]?.total || 0);
}

async function removeMovedRuleRows(client: QueryableClient, hasReport: boolean): Promise<number> {
  const result = await client.query(`
    DELETE FROM ${qualifiedTable("analysis_tasks")}
    WHERE schedule_enabled = true AND NOT ${reportTraceSql(hasReport)}
  `);
  return result.rowCount ?? 0;
}

async function backfillPayloadsFromReport(client: QueryableClient): Promise<number> {
  const result = await client.query(`
    UPDATE ${qualifiedTable("analysis_tasks")}
    SET analysis_payload = jsonb_build_object(
          'report', result_report
        ),
        updated_at = GREATEST(COALESCE(updated_at, 0), ${NOW_MS_SQL})
    WHERE analysis_payload IS NULL
      AND NULLIF(result_report, '') IS NOT NULL
  `);
  return result.rowCount ?? 0;
}

async function retireLegacyArtifacts(client: QueryableClient): Promise<void> {
  for (const column of [
    "result_report",
    "schedule_enabled",
    "schedule_expression",
    "next_run_at",
  ]) {
    await client.query(
      `ALTER TABLE ${qualifiedTable("analysis_tasks")} DROP COLUMN IF EXISTS ${column}`
    );
  }
  await client.query(`DROP TABLE IF EXISTS ${qualifiedTable("analysis_task_snapshots")}`);
}
