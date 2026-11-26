import { domainComponentRecordSchema, domainComponentSummarySchema } from "@ontomato/contracts/domain-components";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { currentDefinitionAccess } from "../product-panels/access";
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
  const { visibility: _legacyVisibility, ...definition } = row.definition;
  const { id: _id, ...record } = currentProductRecord({ ...row, definition }, editable);
  return domainComponentRecordSchema.parse(record);
}

export function domainComponentForProjection(domainId: string | null, id: string, client?: Pick<PoolClient, "query">) {
  return domainId === null ? undefined : findDomainComponent(domainId, id, client);
}


export async function countVisibleDomainComponents(domainId: string, credentials: AssistantCredentials): Promise<number> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<Pick<CurrentProductRow, "id" | "domainId" | "ownerId">>(
    `SELECT id, domain_id AS "domainId", owner_id AS "ownerId" FROM ${t("domain_components")} WHERE domain_id=$1`,
    [domainId],
  );
  const { decisions } = await currentDefinitionAccess("component", rows, domainId, credentials, false);
  const ids = rows.filter((_, index) => decisions[index].allowed).map(({ id }) => id);
  const { rows: [count] } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ${t("domain_components")} WHERE domain_id=$1 AND id=ANY($2::text[])`,
    [domainId, ids],
  );
  return count.total;
}

export async function listVisibleDomainComponents(domainId: string, credentials: AssistantCredentials, readEdits = true) {
  const { rows } = await getPostgresPool().query<CurrentProductRow>(
    `SELECT ${currentProductColumns} FROM ${t("domain_components")}
     WHERE domain_id=$1 ORDER BY definition->>'name',id`, [domainId],
  );
  const { decisions, editable } = await currentDefinitionAccess("component", rows, domainId, credentials, readEdits);
  return rows.flatMap((row, index) => decisions[index].allowed
    ? [domainComponentSummarySchema.strip().parse(domainComponentRecord(row, editable.has(row.id)))]
    : []);
}
