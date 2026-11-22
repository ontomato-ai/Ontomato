import { domainComponentRecordSchema, domainComponentSummarySchema } from "@ontomato/contracts/domain-components";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { currentProductColumns, currentProductRecord, type CurrentProductRow } from "../../infrastructure/product-current";

export async function findDomainComponent(domainId: string, id: string, client: Pick<PoolClient, "query"> = getPostgresPool()) {
  const { rows } = await client.query<CurrentProductRow>(
    `SELECT ${currentProductColumns} FROM ${t("domain_components")} WHERE domain_id=$1 AND id=$2`, [domainId, id],
  );
  return rows[0];
}

export function domainComponentRecord(row: CurrentProductRow, editable: boolean) {
  const { id: _id, ...record } = currentProductRecord(row, editable);
  return domainComponentRecordSchema.parse(record);
}

export function domainComponentForProjection(domainId: string | null, id: string, client?: Pick<PoolClient, "query">) {
  return domainId === null ? undefined : findDomainComponent(domainId, id, client);
}


export async function listVisibleDomainComponents(domainId: string, userId: string, editable: ReadonlySet<string> = new Set()) {
  const { rows } = await getPostgresPool().query<CurrentProductRow>(
    `SELECT ${currentProductColumns} FROM ${t("domain_components")}
     WHERE domain_id=$1 AND (owner_id=$2 OR definition->>'visibility'='domain' OR id=ANY($3::text[]))
     ORDER BY definition->>'name',id`, [domainId, userId, [...editable]],
  );
  return rows.map(row => domainComponentSummarySchema.strip().parse(domainComponentRecord(row, editable.has(row.id))));
}
