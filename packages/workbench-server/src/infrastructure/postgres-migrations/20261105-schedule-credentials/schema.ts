import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * The owner's background credential for scheduled runs, one per owner and domain and shared by the owner's rules,
 * replacing the login token each rule used to keep. A rule paused because that credential stopped working is marked,
 * so the owner's next visit with a valid login resumes exactly those rules.
 */
export async function ensureScheduleCredentialSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_schedule_credentials")} (
      domain_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sealed_key TEXT,
      state TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (domain_id, user_id)
    )
  `);
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_schedule_rules")}
      ADD COLUMN IF NOT EXISTS paused_for_credential BOOLEAN NOT NULL DEFAULT false
  `);
}
