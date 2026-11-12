import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureProductAssetsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("product_assets")} (
    domain_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL,
    name text NOT NULL, description text NOT NULL DEFAULT '', visibility text NOT NULL DEFAULT 'private',
    document jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(domain_id,id));
    CREATE INDEX IF NOT EXISTS product_assets_owner ON ${t("product_assets")}(domain_id,owner_id);
    CREATE TABLE IF NOT EXISTS ${t("product_home")} (
    domain_id text NOT NULL, user_id text NOT NULL, asset_id text NOT NULL,
    PRIMARY KEY(domain_id,user_id));`);
  // Preserve IDs and parent references while correcting legacy display-only panels.
  await client.query(`UPDATE ${t("product_assets")} SET document=jsonb_set(document,'{kind}','"widget-group"'::jsonb),revision=revision+1,updated_at=now()
    WHERE document->>'kind'='operation-panel' AND jsonb_array_length(document->'widgets')>0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'widgets') widget WHERE widget->>'kind' NOT IN ('text','metric','table','chart'))`);
}
