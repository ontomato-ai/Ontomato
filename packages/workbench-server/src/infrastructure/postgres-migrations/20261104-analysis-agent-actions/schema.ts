import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Existing agents select no Action; only an explicit selection lets a regular session execute one. */
export async function ensureAnalysisAgentActionsSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS enabled_action_ids TEXT[] NOT NULL DEFAULT '{}'
  `);
}
