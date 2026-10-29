import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureOpsDiagnosisSchema(c: QueryableClient) {
  // Legacy unowned diagnosis history remains untouched for the release conversion.
  await c.query(`CREATE TABLE IF NOT EXISTS ${t("ops_sessions")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, target jsonb,
    title text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS ops_sessions_owner ON ${t("ops_sessions")}(domain_id,owner_id,updated_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS ${t("ops_run_intents")} (
    id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ${t("ops_sessions")}(id) ON DELETE CASCADE,
    fingerprint text NOT NULL, definition jsonb NOT NULL, language text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now());`);
}
