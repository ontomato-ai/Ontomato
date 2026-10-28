import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureDataRetrievalSchema(client: QueryableClient) {
  const legacy = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) AND attname=$2 AND NOT attisdropped) AS incompatible`,
    [qualifiedTable("retrievals"), "current_run_id"],
  );
  if (legacy.rows[0]?.incompatible)
    throw new Error(
      "Legacy data-retrieval data requires the release conversion before startup",
    );
  await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrievals")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, parent_id text,
    work_session_id uuid NOT NULL, current_run_id uuid NOT NULL, external boolean NOT NULL DEFAULT false,
    input jsonb NOT NULL, input_hash text NOT NULL, snapshot jsonb NOT NULL,
    decisions jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS retrievals_owner_parent ON ${qualifiedTable("retrievals")}(domain_id,owner_id,parent_id);
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_rounds")} (
      id uuid PRIMARY KEY, retrieval_id uuid NOT NULL REFERENCES ${qualifiedTable("retrievals")}(id),
      request_hash text NOT NULL, open boolean NOT NULL,
      deadline timestamptz NOT NULL, qc_id uuid, qc_result jsonb);
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_submissions")} (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES ${qualifiedTable("retrieval_rounds")}(id),
      input_hash text NOT NULL, request jsonb NOT NULL, dataset_digest text, receipt_id uuid,
      artifact_id uuid);
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_parent_gates")} (
      domain_id text NOT NULL, owner_id text NOT NULL, parent_id text NOT NULL,
      closed boolean NOT NULL, PRIMARY KEY(domain_id,owner_id,parent_id));
    ALTER TABLE ${qualifiedTable("query_runs")} ADD COLUMN IF NOT EXISTS retrieval_ref jsonb;
  `);
}
