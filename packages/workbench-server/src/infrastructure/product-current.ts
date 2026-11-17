import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as t } from "./postgres";
import type { ProductDefinitionChangedEvent } from "@ontomato/contracts/product-panels";

export type CurrentProductKind = ProductDefinitionChangedEvent["target"]["kind"];
export const currentProductTables = { projection: "product_projections", panel: "product_panels" } as const;
export const currentProductColumns = `id,domain_id AS "domainId",owner_id AS "ownerId",definition,revision,created_at AS "createdAt",updated_at AS "updatedAt"`;
export interface CurrentProductRow {
  id: string; domainId: string; ownerId: string; definition: Record<string, unknown>;
  revision: number; createdAt: Date; updatedAt: Date;
}

export async function findCurrentProduct(domain: string, kind: CurrentProductKind, id: string,
  client: Pick<PoolClient, "query"> = getPostgresPool()): Promise<CurrentProductRow | undefined> {
  const result = await client.query(`SELECT ${currentProductColumns} FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [domain, id]);
  return result.rows[0];
}

export function currentProductRecord(row: CurrentProductRow, editable: boolean) {
  return { ...row.definition, id: row.id, domainId: row.domainId, ownerId: row.ownerId, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), editable };
}
