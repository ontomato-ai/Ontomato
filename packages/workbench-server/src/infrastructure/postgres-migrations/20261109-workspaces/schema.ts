import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
export async function ensureWorkspacesSchema(client: QueryableClient) {
  await client.query(`ALTER TABLE ${t("assistant_sessions")} ADD COLUMN IF NOT EXISTS workspace_id uuid;
    CREATE INDEX IF NOT EXISTS assistant_workspace_idx ON ${t("assistant_sessions")}(domain_id,owner_id,workspace_id);`);
}
