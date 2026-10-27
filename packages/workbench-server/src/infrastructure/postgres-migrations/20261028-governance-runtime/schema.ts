import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** New records use runtime IDs only; old Harness columns remain solely for the external upgrade. */
export async function ensureGovernanceRuntimeSchema(client: QueryableClient) {
  await client.query(`ALTER TABLE ${qualifiedTable("knowledge_governance_sessions")}
    ADD COLUMN IF NOT EXISTS runtime_session_id UUID,
    ADD COLUMN IF NOT EXISTS write_run_id UUID,
    ADD COLUMN IF NOT EXISTS latest_run_id UUID;
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("knowledge_governance_run_work")} (
      run_id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES ${qualifiedTable("knowledge_governance_sessions")}(id) ON DELETE CASCADE,
      write_open BOOLEAN NOT NULL, work JSONB NOT NULL, error TEXT,
      revision BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS governance_run_session_idx ON ${qualifiedTable("knowledge_governance_run_work")}(session_id);
  `);
}
