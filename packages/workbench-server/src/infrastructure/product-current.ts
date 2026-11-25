import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as t } from "./postgres";
import type { ProductDefinitionChangedEvent } from "@ontomato/contracts/product-panels";
import { BUILTIN_PRODUCT_ID_PREFIX, isBuiltinProductId } from "@ontomato/contracts/product-record-id";

export type CurrentProductKind = ProductDefinitionChangedEvent["target"]["kind"];
export const currentProductTables = { projection: "product_projections", panel: "product_panels" } as const;
export const builtinProductTables = { projection: "builtin_product_projections", panel: "builtin_product_panels" } as const;
export const currentProductColumns = `id,domain_id AS "domainId",owner_id AS "ownerId",definition,revision,created_at AS "createdAt",updated_at AS "updatedAt"`;
const storageVersionColumn = 'xmin::text AS "storageVersion"';
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
  storageVersion?: string;
}

export async function findCurrentProduct(domain: string | null, kind: CurrentProductKind, id: string,
  client: Pick<PoolClient, "query"> = getPostgresPool()): Promise<CurrentProductRow | undefined> {
  if (isBuiltinProductId(id)) {
    const result = await client.query<CurrentProductRow>(
      `SELECT NULL::text AS "domainId",NULL::text AS "ownerId",id,definition,revision,
         created_at AS "createdAt",updated_at AS "updatedAt",${storageVersionColumn}
       FROM ${t(builtinProductTables[kind])} WHERE id=$1`, [id],
    );
    return result.rows[0];
  }
  const result = await client.query(`SELECT ${currentProductColumns},${storageVersionColumn} FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [domain, id]);
  return result.rows[0];
}

export async function findCurrentProducts(
  domain: string | null, kind: CurrentProductKind, ids: readonly string[],
  client: Pick<PoolClient, "query"> = getPostgresPool(),
): Promise<Map<string, CurrentProductRow>> {
  const builtinIds: string[] = [], domainIds: string[] = [];
  for (const id of new Set(ids)) (isBuiltinProductId(id) ? builtinIds : domainIds).push(id);
  const [builtin, scoped] = await Promise.all([
    builtinIds.length && client.query<CurrentProductRow>(
      `SELECT NULL::text AS "domainId",NULL::text AS "ownerId",id,definition,revision,
         created_at AS "createdAt",updated_at AS "updatedAt",${storageVersionColumn}
       FROM ${t(builtinProductTables[kind])} WHERE id = ANY($1::text[])`, [builtinIds],
    ),
    domainIds.length && client.query<CurrentProductRow>(
      `SELECT ${currentProductColumns},${storageVersionColumn} FROM ${t(currentProductTables[kind])} WHERE domain_id = $1 AND id = ANY($2::text[])`,
      [domain, domainIds],
    ),
  ]);
  const rows = [...(builtin ? builtin.rows : []), ...(scoped ? scoped.rows : [])];
  return new Map(rows.map(row => [row.id, row]));
}

export function currentProductRecord(row: CurrentProductRow, editable: boolean) {
  const def = row.definition;
  const normalized = def && typeof def === "object" && !Array.isArray(def) && "manifest" in def
    && def.manifest && typeof def.manifest === "object" && !Array.isArray(def.manifest) && "commands" in def.manifest
    ? (() => {
        const { commands: _legacy, ...restManifest } = def.manifest as Record<string, unknown>;
        return { ...def, manifest: restManifest };
      })()
    : def;
  return { ...normalized, id: row.id, domainId: row.domainId, ownerId: row.ownerId, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), editable: row.domainId !== null && editable };
}
