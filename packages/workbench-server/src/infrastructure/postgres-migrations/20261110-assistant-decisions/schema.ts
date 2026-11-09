import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureAssistantDecisionsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("assistant_decisions")} (
    artifact_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    "values" jsonb NOT NULL DEFAULT '{}', notes text NOT NULL DEFAULT '',
    continuation_run_id uuid, message text, admitted boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`ALTER TABLE ${t("assistant_decisions")} ADD COLUMN IF NOT EXISTS admitted boolean NOT NULL DEFAULT false`);
}
