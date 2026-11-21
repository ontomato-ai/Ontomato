import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as t } from "./postgres";
import type { ProductDefinitionChangedEvent } from "@ontomato/contracts/product-panels";
import { BUILTIN_PRODUCT_ID_PREFIX, isBuiltinProductId } from "@ontomato/contracts/product-record-id";

export type CurrentProductKind = ProductDefinitionChangedEvent["target"]["kind"];
export const currentProductTables = { projection: "product_projections", panel: "product_panels" } as const;
export const builtinProductTables = { projection: "builtin_product_projections", panel: "builtin_product_panels" } as const;
export const currentProductColumns = `id,domain_id AS "domainId",owner_id AS "ownerId",definition,revision,created_at AS "createdAt",updated_at AS "updatedAt"`;
const definitionColumns = "id,definition,revision,created_at,updated_at";

/** Both classes of current record have the same columns for catalogues and reverse lookups. */
export function currentProductRows(kind: CurrentProductKind) {
  return `(SELECT domain_id,owner_id,${definitionColumns} FROM ${t(currentProductTables[kind])}
    WHERE NOT starts_with(id,'${BUILTIN_PRODUCT_ID_PREFIX}')
    UNION ALL SELECT NULL::text,NULL::text,${definitionColumns} FROM ${t(builtinProductTables[kind])})`;
}
export interface CurrentProductRow {
  id: string; domainId: string | null; ownerId: string | null; definition: Record<string, unknown>;
  revision: number; createdAt: Date; updatedAt: Date;
}

export async function findCurrentProduct(domain: string, kind: CurrentProductKind, id: string,
  client: Pick<PoolClient, "query"> = getPostgresPool()): Promise<CurrentProductRow | undefined> {
  if (isBuiltinProductId(id)) {
    const result = await client.query<CurrentProductRow>(
      `SELECT NULL::text AS "domainId",NULL::text AS "ownerId",id,definition,revision,
         created_at AS "createdAt",updated_at AS "updatedAt"
       FROM ${t(builtinProductTables[kind])} WHERE id=$1`, [id],
    );
    return result.rows[0];
  }
  const result = await client.query(`SELECT ${currentProductColumns} FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [domain, id]);
  return result.rows[0];
}

export function currentProductRecord(row: CurrentProductRow, editable: boolean) {
  return { ...row.definition, id: row.id, domainId: row.domainId, ownerId: row.ownerId, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), editable: row.domainId !== null && editable };
}
