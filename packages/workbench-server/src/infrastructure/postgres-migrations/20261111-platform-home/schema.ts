import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensurePlatformHomeSchema(c: QueryableClient) {
  await c.query(`CREATE TABLE IF NOT EXISTS ${t("platform_home_preferences")} (
    domain_id text NOT NULL, user_id text NOT NULL,
    favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
    dashboard_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (domain_id, user_id));
    CREATE TABLE IF NOT EXISTS ${t("platform_application_usage")} (
    domain_id text NOT NULL, user_id text NOT NULL, application_id text NOT NULL,
    last_opened_at timestamptz NOT NULL,
    PRIMARY KEY (domain_id, user_id, application_id));`);
}
