import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** New records use runtime IDs only; old Harness columns remain solely for the external upgrade. */
export async function ensureGovernanceRuntimeSchema(client: QueryableClient) {
  const legacy = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) AND attname=$2 AND NOT attisdropped) AS incompatible`,
    [qualifiedTable("knowledge_governance_run_work"), "expires_at"],
  );
  if (legacy.rows[0]?.incompatible)
    throw new Error(
      "Legacy governance-runtime data requires the release conversion before startup",
    );
  await client.query(`ALTER TABLE ${qualifiedTable("knowledge_governance_sessions")}
    ADD COLUMN IF NOT EXISTS runtime_session_id UUID,
    ADD COLUMN IF NOT EXISTS write_run_id UUID,
    ADD COLUMN IF NOT EXISTS latest_run_id UUID;
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("knowledge_governance_run_work")} (
      run_id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES ${qualifiedTable("knowledge_governance_sessions")}(id) ON DELETE CASCADE,
      write_open BOOLEAN NOT NULL, work JSONB NOT NULL, error TEXT,
      expires_at TIMESTAMPTZ NOT NULL, request_hash TEXT NOT NULL,
      revision BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS governance_run_session_idx ON ${qualifiedTable("knowledge_governance_run_work")}(session_id);
  `);
}
