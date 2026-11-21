import type { ProductPanelCatalogQuery } from "@ontomato/contracts/product-catalog-query";
import { z } from "zod";
import type { PoolClient } from "pg";
import { panelPlacementSchema } from "@ontomato/contracts/panel-manifest";
import {
  BUILTIN_PRODUCT_ID_PREFIX, PRODUCT_IN_USE, builtinProductPanelInputSchema, productCurrentIdParamsSchema,
  productPanelInputSchema, productPanelSummarySchema, productProjectionInputSchema, type ProductCatalogQuery,
  type ProductVisibility,
} from "@ontomato/contracts/product-panels";
import {
  currentProductRecord, currentProductRows, currentProductTables, findCurrentProduct, type CurrentProductKind,
} from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  changeProductDomainGrant, changeProductGrant, grantedProductIds, productGrantAllowed, readProductGrantRecords, unregisterProductResource,
  type ProductOwner,
} from "../product-governance/grants";
import { insertCurrentProduct, loadCurrentProduct, requireCurrentProduct, requireOrdinaryProjection } from "./current";
import { closeDeletedDefinitionStreams, notifyProductDefinitionChanged } from "./definition-stream";
import { findPanelUsers, panelReferenceDefinitionSchema } from "./references";
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
  ownerId: string | null;
  name: string;
  description: string;
  visibility: ProductVisibility;
  revision: number;
  updatedAt: Date;
  sortKey: string;
  componentId?: string;
  template?: boolean | null;
  definition?: unknown;
}

export async function listCurrentProducts(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, input: ProductPanelCatalogQuery) {
  const cursor = readCursor(input);
  const [usable, editable] = await Promise.all([grantedProductIds("use", credentials), grantedProductIds("edit", credentials)]);
  const panelCatalog = kind === "panel";
  const visible = panelCatalog ? [...usable, ...editable] : usable;
  const updated = input.sort === "updated";
  const order = updated ? "updated_at" : "lower(definition->>'name')";
  const direction = updated ? "DESC" : "ASC";
  const keyType = updated ? "timestamptz" : "text";
  // PostgreSQL provides the exact timestamp key, including sub-millisecond precision.
  const cursorKey = updated ? "to_jsonb(updated_at)#>>'{}'" : order;
  const kindColumn = kind === "projection" ? `,definition->>'componentId' AS "componentId"` : `,definition,definition->'template' AS template`;
  const { rows } = await getPostgresPool().query<SummaryRow>(
    `SELECT id,owner_id AS "ownerId",definition->>'name' AS name,definition->>'description' AS description,
       definition->>'visibility' AS visibility,revision,updated_at AS "updatedAt",${cursorKey} AS "sortKey"${kindColumn}
     FROM ${currentProductRows(kind)} AS definitions
     WHERE (domain_id IS NULL OR (domain_id=$1 AND (id=ANY($2::text[]) OR ($10::boolean AND owner_id=$4))))
       AND ($9::boolean IS NULL OR COALESCE(definition->'template', 'false'::jsonb) = to_jsonb($9::boolean))
       AND ($3='all' OR COALESCE(owner_id=$4,false)=($3='mine'))
       AND (strpos(lower(definition->>'name'),lower($5))>0 OR strpos(lower(definition->>'description'),lower($5))>0)
       AND ($6::${keyType} IS NULL OR (${order},id) ${updated ? "<" : ">"} ($6::${keyType},$7::text))
     ORDER BY ${order} ${direction},id ${direction} LIMIT $8`,
    [owner.domainId, visible, input.scope, owner.userId, input.q, cursor?.key ?? null, cursor?.id ?? null, input.limit + 1,
      panelCatalog ? input.template ?? null : null, panelCatalog],
  );
  const edited = new Set(editable);
  const unavailableItems: { id: string; reason: string }[] = [];
  const items = rows.slice(0, input.limit).flatMap(({ sortKey: _sortKey, definition, updatedAt, template, ...row }) => {
    const summary = {
      ...row, ...(template == null ? {} : { template }), updatedAt: updatedAt.toISOString(),
      editable: row.ownerId !== null && edited.has(row.id),
    };
    if (!panelCatalog) return [summary];
    const schema = row.id.startsWith(BUILTIN_PRODUCT_ID_PREFIX) ? builtinProductPanelInputSchema : productPanelInputSchema;
    const parsed = schema.safeParse(definition);
    const result = parsed.success ? productPanelSummarySchema.safeParse(summary) : parsed;
    if (result.success) return [summary];
    const issue = result.error.issues[0]!;
    const field = issue.path.length ? `Field '${issue.path.join(".")}'` : "Panel definition";
    const reason = issue.code === "invalid_type" && issue.received === "undefined"
      ? `${field} is required.` : `${field} does not match the current panel contract.`;
    unavailableItems.push({ id: row.id, reason });
    return [];
  });
  const last = rows[input.limit - 1];
  const nextCursor = rows.length > input.limit
    ? Buffer.from(JSON.stringify({ sort: input.sort, key: last.sortKey, id: last.id })).toString("base64url") : null;
  return { items, nextCursor, ...(unavailableItems.length > 0 && { unavailableItems }) };
}

export async function currentProductUsedBy(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string) {
  await requireCurrentProduct(owner, credentials, kind, id, "use");
  return kind === "projection"
    ? panelsUsingProjection(owner.domainId, id, credentials)
    : panelUsers(owner.domainId, id, credentials);
}

function panelProjectionIds(definition: unknown) {
  const { manifest } = panelReferenceDefinitionSchema.parse(definition);
  const ids = new Set(Object.values(manifest.members).flatMap(({ target }) =>
    "projectionId" in target ? [target.projectionId] : []));
  for (const { type, default: value } of Object.values(manifest.state)) {
    if (type.kind !== "placement" || value == null) continue;
    const { target } = panelPlacementSchema.parse(value);
    if ("projectionId" in target) ids.add(target.projectionId);
  }
  return [...ids];
}

async function removeCurrentProduct(client: PoolClient, domainId: string, kind: CurrentProductKind, id: string, unregisterGrant = true) {
  await client.query(`DELETE FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [domainId, id]);
  if (unregisterGrant) await unregisterProductResource(domainId, id);
}

export async function deleteCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, revision: number) {
  const cleanup = await transaction(async client => {
    await lockProducts(client, owner);
    const { domainId } = owner;
    const panel = kind === "panel" ? await findCurrentProduct(domainId, kind, id, client) : undefined;
    const authoredPanel = panel?.ownerId === owner.userId ? panel : undefined;
    const current = authoredPanel ?? await requireCurrentProduct(owner, credentials, kind, id, "edit", client);
    if (current.revision !== revision)
      throw new HttpError(409, "Definition changed; reload before deleting", "PRODUCT_CONFLICT");
    if (kind === "projection") {
      const usage = await panelsUsingProjection(domainId, id, credentials, client);
      if (usage.panels.length || usage.hiddenCount)
        throw new HttpError(409, "Projection is in use", PRODUCT_IN_USE, usage);
      await removeCurrentProduct(client, domainId, kind, id);
      return;
    }
    const usage = await panelUsers(domainId, id, credentials, client);
    if (usage.applicationEntries.length || usage.panels.length || usage.hiddenCount || usage.classNames.length)
      throw new HttpError(409, "Panel is in use", PRODUCT_IN_USE, usage);

    const { rows: candidates } = await client.query<{ id: string }>(
      `SELECT id FROM ${t(currentProductTables.projection)} WHERE domain_id=$1 AND id=ANY($2::text[]) ORDER BY id`,
      [domainId, panelProjectionIds(current.definition)],
    );
    const deletedProjectionIds: string[] = [];
    const retainedProjectionIdsWithoutEdit: string[] = [];
    if (candidates.length) {
      const editable = new Set(await grantedProductIds("edit", credentials));
      for (const { id: projectionId } of candidates) {
        const users = await findPanelUsers(domainId, "projection", projectionId, client);
        if (users.some(panel => panel.id !== id)) continue;
        if (editable.has(projectionId)) deletedProjectionIds.push(projectionId);
        else retainedProjectionIdsWithoutEdit.push(projectionId);
      }
    }
    // The stored owner may remove this row. Revoking Java grants for the ID still requires a current edit Grant.
    const unregisterGrant = !authoredPanel || await productGrantAllowed(id, "edit", credentials);
    await removeCurrentProduct(client, domainId, kind, id, unregisterGrant);
    for (const projectionId of deletedProjectionIds) await removeCurrentProduct(client, domainId, "projection", projectionId);
    return { deletedProjectionIds, retainedProjectionIdsWithoutEdit };
  });
  closeDeletedDefinitionStreams(owner.domainId, { kind, id });
  if (!cleanup) return { success: true as const };
  for (const projectionId of cleanup.deletedProjectionIds)
    closeDeletedDefinitionStreams(owner.domainId, { kind: "projection", id: projectionId });
  return { success: true as const, ...cleanup };
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
  const current = await loadCurrentProduct(owner.domainId, kind, id);
  if (kind === "projection") {
    await changeProductDomainGrant(id, shared, credentials);
    return { success: true as const };
  }
  const projectionIds = shared ? panelProjectionIds(current.definition) : [];
  const editable = new Set(projectionIds.length ? await grantedProductIds("edit", credentials) : []);
  await changeProductDomainGrant(id, shared, credentials);
  const skippedProjectionIds: string[] = [];
  for (const projectionId of projectionIds) {
    if (editable.has(projectionId)) await changeProductDomainGrant(projectionId, true, credentials);
    else skippedProjectionIds.push(projectionId);
  }
  return { success: true as const, skippedProjectionIds };
}
