import { z } from "zod";
import {
  PRODUCT_IN_USE, productCurrentIdParamsSchema, productPanelInputSchema, productProjectionInputSchema, type ProductCatalogQuery,
} from "@ontomato/contracts/product-panels";
import {
  currentProductRecord, currentProductTables, findCurrentProduct, type CurrentProductKind,
} from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  changeProductDomainGrant, changeProductGrant, grantedProductIds, readProductGrantRecords, unregisterProductResource,
  type ProductOwner,
} from "../product-governance/grants";
import { insertCurrentProduct, loadCurrentProduct, requireCurrentProduct, requireOrdinaryProjection } from "./current";
import { closeDeletedDefinitionStreams, notifyProductDefinitionChanged } from "./definition-stream";
import { panelsUsingProjection, panelUsers } from "./used-by";

const cursorSchema = z.discriminatedUnion("sort", [
  z.object({ sort: z.literal("name"), key: z.string(), id: productCurrentIdParamsSchema.shape.id }).strict(),
  z.object({ sort: z.literal("updated"), key: z.string().datetime({ offset: true }), id: productCurrentIdParamsSchema.shape.id }).strict(),
]);

function readCursor(input: ProductCatalogQuery) {
  if (input.cursor === undefined) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
    if (cursor.sort === input.sort) return cursor;
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
  }
  throw new HttpError(400, "Invalid catalog cursor", "INVALID_REQUEST");
}

interface SummaryRow {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  visibility: "private" | "domain";
  revision: number;
  updatedAt: Date;
  sortKey: string;
}

interface ProjectionSummaryRow extends SummaryRow {
  componentId: string;
  binding: unknown;
}

export async function listCurrentProducts(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, input: ProductCatalogQuery) {
  const cursor = readCursor(input);
  const [usable, editable] = await Promise.all([grantedProductIds("use", credentials), grantedProductIds("edit", credentials)]);
  const updated = input.sort === "updated";
  const order = updated ? "updated_at" : "lower(definition->>'name')";
  const direction = updated ? "DESC" : "ASC";
  const keyType = updated ? "timestamptz" : "text";
  // PostgreSQL provides the exact timestamp key, including sub-millisecond precision.
  const cursorKey = updated ? "to_jsonb(updated_at)#>>'{}'" : order;
  const projectionColumns = kind === "projection" ? `,definition->>'componentId' AS "componentId",definition->'binding' AS binding` : "";
  const { rows } = await getPostgresPool().query<SummaryRow | ProjectionSummaryRow>(
    `SELECT id,owner_id AS "ownerId",definition->>'name' AS name,definition->>'description' AS description,
       definition->>'visibility' AS visibility,revision,updated_at AS "updatedAt",${cursorKey} AS "sortKey"${projectionColumns}
     FROM ${t(currentProductTables[kind])}
     WHERE domain_id=$1 AND id=ANY($2::text[])
       AND ($3='all' OR (owner_id=$4)=($3='mine'))
       AND (strpos(lower(definition->>'name'),lower($5))>0 OR strpos(lower(definition->>'description'),lower($5))>0)
       AND ($6::${keyType} IS NULL OR (${order},id) ${updated ? "<" : ">"} ($6::${keyType},$7::text))
     ORDER BY ${order} ${direction},id ${direction} LIMIT $8`,
    [owner.domainId, usable, input.scope, owner.userId, input.q, cursor?.key ?? null, cursor?.id ?? null, input.limit + 1],
  );
  const edited = new Set(editable);
  const items = rows.slice(0, input.limit).map(({ sortKey: _sortKey, updatedAt, ...row }) => ({
    ...row, updatedAt: updatedAt.toISOString(), editable: edited.has(row.id),
  }));
  const last = rows[input.limit - 1];
  const nextCursor = rows.length > input.limit
    ? Buffer.from(JSON.stringify({ sort: input.sort, key: last.sortKey, id: last.id })).toString("base64url") : null;
  return { items, nextCursor };
}

export async function currentProductUsedBy(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string) {
  await requireCurrentProduct(owner, credentials, kind, id, "use");
  return kind === "projection"
    ? panelsUsingProjection(owner.domainId, id, credentials)
    : panelUsers(owner.domainId, id, credentials);
}

export async function deleteCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, revision: number) {
  await transaction(async client => {
    await lockProducts(client, owner);
    const current = await requireCurrentProduct(owner, credentials, kind, id, "edit", client);
    if (current.revision !== revision)
      throw new HttpError(409, "Definition changed; reload before deleting", "PRODUCT_CONFLICT");
    if (kind === "projection") {
      const usage = await panelsUsingProjection(owner.domainId, id, credentials, client);
      if (usage.panels.length || usage.hiddenCount)
        throw new HttpError(409, "Projection is in use", PRODUCT_IN_USE, usage);
    } else {
      const usage = await panelUsers(owner.domainId, id, credentials, client);
      if (usage.applicationEntries.length || usage.panels.length || usage.hiddenCount || usage.classNames.length)
        throw new HttpError(409, "Panel is in use", PRODUCT_IN_USE, usage);
    }
    await client.query(`DELETE FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
    await unregisterProductResource(owner.domainId, id);
  });
  closeDeletedDefinitionStreams(owner.domainId, { kind, id });
}

export async function copyCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, sourceId: string,
  copy: { id: string; name: string }) {
  const row = await transaction(async client => {
    await lockProducts(client, owner);
    const source = await requireCurrentProduct(owner, credentials, kind, sourceId, "use", client);
    const definition = { ...source.definition, name: copy.name, visibility: "private" };
    const input = kind === "projection" ? productProjectionInputSchema.parse(definition) : productPanelInputSchema.parse(definition);
    if ("componentId" in input) requireOrdinaryProjection(input);
    if (await findCurrentProduct(owner.domainId, kind, copy.id, client))
      throw new HttpError(409, "Product identity already exists", "PRODUCT_ID_CONFLICT");
    return insertCurrentProduct(client, owner, credentials, kind, copy.id, input);
  });
  await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind, id: copy.id } });
  return currentProductRecord(row, true);
}

export async function currentProductGrants(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string) {
  await loadCurrentProduct(owner.domainId, kind, id);
  return readProductGrantRecords(id, credentials);
}

export async function changeCurrentProductGrant(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  grant: Parameters<typeof changeProductGrant>[1]) {
  await loadCurrentProduct(owner.domainId, kind, id);
  return changeProductGrant(id, grant, credentials);
}

export async function changeCurrentProductDomainGrant(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, shared: boolean) {
  await loadCurrentProduct(owner.domainId, kind, id);
  return changeProductDomainGrant(id, shared, credentials);
}
