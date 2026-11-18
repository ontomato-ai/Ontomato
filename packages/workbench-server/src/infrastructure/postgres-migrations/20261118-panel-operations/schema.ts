import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensurePanelOperationsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("panel_operation_intents")} (
    domain_id text NOT NULL,id uuid NOT NULL,owner_id text NOT NULL,question_id uuid,
    intent jsonb NOT NULL,PRIMARY KEY(domain_id,id),UNIQUE(domain_id,question_id))`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("panel_operation_settings")} (
    domain_id text NOT NULL,provider_id text NOT NULL,session_id uuid NOT NULL,owner_id text NOT NULL,
    confirm_before_execute boolean NOT NULL,PRIMARY KEY(domain_id,provider_id,session_id))`);
}
