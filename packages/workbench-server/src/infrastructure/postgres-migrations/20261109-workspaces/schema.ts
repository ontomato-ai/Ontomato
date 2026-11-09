import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
export async function ensureWorkspacesSchema(client: QueryableClient) {
  await client.query(`ALTER TABLE ${t("assistant_sessions")} ADD COLUMN IF NOT EXISTS workspace_id uuid;
    CREATE INDEX IF NOT EXISTS assistant_workspace_idx ON ${t("assistant_sessions")}(domain_id,owner_id,workspace_id);
    CREATE TABLE IF NOT EXISTS ${t("hosted_apps")} (
      app_id text PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, workspace_id uuid NOT NULL,
      UNIQUE(domain_id,workspace_id));
    CREATE TABLE IF NOT EXISTS ${t("hosted_app_releases")} (
      id uuid PRIMARY KEY, app_id text NOT NULL REFERENCES ${t("hosted_apps")}(app_id),
      commit_id text NOT NULL, files jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(app_id,commit_id));`);
}
