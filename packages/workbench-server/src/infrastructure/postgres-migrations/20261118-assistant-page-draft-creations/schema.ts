import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/**
 * The object a create draft's first save created, by the draft's run and path. Written once; a conversation's drafts
 * go with it, so its rows do too.
 */
export async function ensureAssistantPageDraftCreationsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("assistant_page_draft_creations")} (
    session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    run_id uuid NOT NULL, path text NOT NULL, created_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,run_id,path))`);
}
