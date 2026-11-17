import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureProductPanelsSchema(client: QueryableClient) {
  for (const name of ["product_projections", "product_panels"]) {
    await client.query(`CREATE TABLE IF NOT EXISTS ${t(name)} (
      domain_id text NOT NULL,id text NOT NULL,owner_id text NOT NULL,definition jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(domain_id,id))`);
  }
}
