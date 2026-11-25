import { qualifiedTable } from "../../postgres";
import { getTableColumns, type QueryableClient } from "../helpers";

export type RegisterProductAssetGrant = (owner: { domainId: string; userId: string }, id: string, shared: boolean) => Promise<void>;

export async function migrateProductGrants(client: QueryableClient, register: RegisterProductAssetGrant) {
  const columns = await getTableColumns(client, "product_assets");
  if (!columns.has("governance_registered")) return;
  const table = qualifiedTable("product_assets");
  const { rows } = await client.query<{ domain_id: string; id: string; owner_id: string; visibility: string }>(
    `SELECT domain_id, id, owner_id, visibility FROM ${table}
     WHERE NOT governance_registered ORDER BY domain_id, id`,
  );
  for (const row of rows) {
    await register({ domainId: row.domain_id, userId: row.owner_id }, row.id, row.visibility === "domain");
  }
  await client.query(`ALTER TABLE ${table} DROP COLUMN governance_registered`);
}
