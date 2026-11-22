import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** A file a person staged for one panel operation, kept until that operation succeeds or the row expires. */
export async function ensurePanelOperationUploadsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("panel_operation_uploads")} (
    domain_id text NOT NULL,id uuid NOT NULL,owner_id text NOT NULL,operation jsonb NOT NULL,
    name text NOT NULL,mime text NOT NULL,size integer NOT NULL,bytes bytea NOT NULL,expires_at timestamptz NOT NULL,
    PRIMARY KEY(domain_id,id))`);
  await client.query(`CREATE INDEX IF NOT EXISTS panel_operation_uploads_expires_at ON ${t("panel_operation_uploads")} (expires_at)`);
}
