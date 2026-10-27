import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureDataRetrievalSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrievals")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, parent_id text,
    input jsonb NOT NULL, input_hash text NOT NULL, snapshot jsonb NOT NULL,
    decisions jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS retrievals_owner_parent ON ${qualifiedTable("retrievals")}(domain_id,owner_id,parent_id);
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_rounds")} (
      id uuid PRIMARY KEY, retrieval_id uuid NOT NULL REFERENCES ${qualifiedTable("retrievals")}(id),
      request_hash text NOT NULL, open boolean NOT NULL, submission jsonb,
      deadline timestamptz NOT NULL, qc_id uuid, qc_result jsonb);
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_submissions")} (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES ${qualifiedTable("retrieval_rounds")}(id),
      tool_call_id text NOT NULL, input_hash text NOT NULL, payload jsonb,
      artifact_id uuid, UNIQUE(run_id,tool_call_id));
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("retrieval_parent_gates")} (
      domain_id text NOT NULL, owner_id text NOT NULL, parent_id text NOT NULL,
      closed boolean NOT NULL, PRIMARY KEY(domain_id,owner_id,parent_id));
    ALTER TABLE ${qualifiedTable("query_runs")} ADD COLUMN IF NOT EXISTS retrieval_ref jsonb, ADD COLUMN IF NOT EXISTS needs_input jsonb;
  `);
}
