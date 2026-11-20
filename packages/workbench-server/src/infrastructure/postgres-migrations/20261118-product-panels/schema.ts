import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureProductPanelsSchema(client: QueryableClient) {
  for (const name of ["product_projections", "product_panels"]) {
    await client.query(`CREATE TABLE IF NOT EXISTS ${t(name)} (
      domain_id text NOT NULL,id text NOT NULL,owner_id text NOT NULL,definition jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(domain_id,id))`);
  }
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("product_object_details")} (
    domain_id text NOT NULL, class_name text NOT NULL, panel_id text NOT NULL,
    updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain_id, class_name))`);
  await client.query(`CREATE INDEX IF NOT EXISTS product_object_details_by_panel
    ON ${t("product_object_details")} (domain_id, panel_id, class_name)`);
}
