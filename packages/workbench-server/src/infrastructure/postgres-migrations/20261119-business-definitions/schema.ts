import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureBusinessDefinitionsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("business_definitions")} (
    domain_id text NOT NULL,id text NOT NULL,status text NOT NULL,definition jsonb NOT NULL,PRIMARY KEY(domain_id,id));
    CREATE TABLE IF NOT EXISTS ${t("definition_triggers")} (
    domain_id text NOT NULL,id text NOT NULL,status text NOT NULL,definition jsonb NOT NULL,PRIMARY KEY(domain_id,id));
    CREATE TABLE IF NOT EXISTS ${t("product_home")} (
    domain_id text NOT NULL,user_id text NOT NULL,asset_id text NOT NULL,PRIMARY KEY(domain_id,user_id));
    CREATE TABLE IF NOT EXISTS ${t("product_user_overlays")} (
    domain_id text NOT NULL,principal_id text NOT NULL,page_id text NOT NULL,revision integer NOT NULL DEFAULT 1,
    preferences jsonb NOT NULL,PRIMARY KEY(domain_id,principal_id,page_id));`);
}
