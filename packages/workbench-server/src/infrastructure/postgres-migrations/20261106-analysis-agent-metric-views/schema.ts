import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Existing agents select no metric view; only an explicit selection lets the loop call one. */
export async function ensureAnalysisAgentMetricViewsSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS enabled_metric_view_ids TEXT[] NOT NULL DEFAULT '{}'
  `);
}
