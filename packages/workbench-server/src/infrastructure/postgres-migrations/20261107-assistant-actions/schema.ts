import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureAssistantActionsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("assistant_action_executions")} (
    artifact_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    domain_id text NOT NULL, owner_id text NOT NULL, action_id text NOT NULL, action_version text NOT NULL,
    parameters jsonb NOT NULL, status text NOT NULL CHECK(status IN ('executing','succeeded','failed','unknown')),
    result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`);
}
