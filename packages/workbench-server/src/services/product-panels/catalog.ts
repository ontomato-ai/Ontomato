import type { ProductPanelCatalogQuery, ProductProjectionCatalogQuery } from "@ontomato/contracts/product-catalog-query";
import { z } from "zod";
import type { PoolClient } from "pg";
import { panelPlacementSchema } from "@ontomato/contracts/panel-manifest";
import { METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import {
  PRODUCT_IN_USE, platformLayerOfObjectType, platformOperationsOwnedByType, productCurrentIdParamsSchema,
  productPanelSchema, productPanelInputSchema, productProjectionInputSchema, projectionBoundObjectTypes,
  type ProductCatalogQuery, type ProductPanelUsedBy, type ProductProjectionUsedBy, type ProductVisibility,
} from "@ontomato/contracts/product-panels";
import {
  currentProductColumns, currentProductRecord, currentProductRows, currentProductTables, findCurrentProduct,
  type CurrentProductKind, type CurrentProductRow,
} from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  changeProductDomainGrant, changeProductGrant, grantedProductIds, productGrantAllowed, readProductGrantRecords,
  requireProductGrant, unregisterProductResource,
  type ProductOwner,
} from "../product-governance/grants";
import { insertCurrentProduct, loadCurrentProduct, requireCurrentProduct, requireOrdinaryProjection } from "./current";
import { panelDefinitionProblem } from "./definition-diagnostics";
import { closeDeletedDefinitionStreams, notifyProductDefinitionChanged } from "./definition-stream";
import { findPanelUsers, panelReferenceDefinitionSchema } from "./references";
import { panelsUsingProjection, panelUsers } from "./used-by";
import { removePanelDependencies } from "./entry-dependency-store";
import { deliverEntryDependencyPublications } from "./entry-dependency-publication";

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
  definition: CurrentProductRow["definition"];
  domainId: CurrentProductRow["domainId"];
  createdAt: Date;
}

const catalogueVisibility = (ownedPanel: string) =>
  `(domain_id IS NULL OR (domain_id=$1 AND (id=ANY($2::text[]) OR (${ownedPanel}))))`;

async function catalogueGrants(credentials: AssistantCredentials, panel: boolean) {
  const [usable, editable] = await Promise.all([grantedProductIds("use", credentials), grantedProductIds("edit", credentials)]);
  return { visible: panel ? [...usable, ...editable] : usable, edited: new Set(editable) };
}

function cataloguePanel(owner: ProductOwner, row: CurrentProductRow, editable: boolean) {
  const result = productPanelSchema.safeParse(currentProductRecord(row, editable));
  if (result.success) return { panel: result.data };
  const removable = row.ownerId === owner.userId || editable;
  return {
    unavailable: {
      id: row.id,
      reason: panelDefinitionProblem(result.error),
      ...(removable && { revision: row.revision }),
    },
  };
}

async function loadCataloguePanel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const row = await loadCurrentProduct(owner.domainId, "panel", id);
  const editable = row.domainId !== null && (await grantedProductIds("edit", credentials)).includes(id);
  if (row.ownerId !== owner.userId && !editable) await requireProductGrant(id, "use", credentials);
  return { row, editable };
}

export async function readCataloguePanel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const { row, editable } = await loadCataloguePanel(owner, credentials, id);
  return cataloguePanel(owner, row, editable);
}

export async function listUnavailablePanels(owner: ProductOwner, credentials: AssistantCredentials) {
  const { visible, edited } = await catalogueGrants(credentials, true);
  const { rows } = await getPostgresPool().query<CurrentProductRow>(
    `SELECT ${currentProductColumns} FROM ${currentProductRows("panel")} AS definitions
     WHERE ${catalogueVisibility("owner_id=$3")} ORDER BY id`,
    [owner.domainId, visible, owner.userId],
  );
  return rows.flatMap(row => {
    const { unavailable } = cataloguePanel(owner, row, row.domainId !== null && edited.has(row.id));
    return unavailable ? [unavailable] : [];
  });
}

function inputPortMatchesObjectTypeSql(inputExpr: string, typeParam: string, layerParam: string): string {
  return `(
    jsonb_typeof(${inputExpr}) = 'object' AND (
      (${inputExpr}->>'kind' = 'object' AND ${inputExpr}->>'objectType' = ${typeParam})
      OR (${inputExpr}->>'kind' = 'child-object' AND ${inputExpr}->>'parentType' = ${typeParam})
      OR (${inputExpr}->>'kind' = 'list' AND jsonb_typeof(${inputExpr}->'items') = 'object' AND ${inputExpr}->'items'->>'kind' = 'object' AND ${inputExpr}->'items'->>'objectType' = ${typeParam})
      OR (${inputExpr}->>'kind' = 'object-union' AND (
        (jsonb_typeof(${inputExpr}->'objectTypes') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${inputExpr}->'objectTypes') AS ot(v) WHERE ot.v = ${typeParam}))
        OR (${layerParam} IS NOT NULL AND jsonb_typeof(${inputExpr}->'layers') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${inputExpr}->'layers') AS ly(v) WHERE ly.v = ${layerParam}))
      ))
    )
  )`;
}

export async function listProjectionFilterFacets(owner: ProductOwner, credentials: AssistantCredentials) {
  const { visible } = await catalogueGrants(credentials, false);
  const { rows } = await getPostgresPool().query<{ componentId: string | null; definition: CurrentProductRow["definition"] }>(
    `SELECT definition->>'componentId' AS "componentId", definition
     FROM ${currentProductRows("projection")} AS definitions
     WHERE ${catalogueVisibility("false")}`,
    [owner.domainId, visible],
  );
  const componentIds = new Set<string>();
  const objectTypes = new Set<string>();
  for (const row of rows) {
    if (row.componentId) componentIds.add(row.componentId);
    for (const objectType of projectionBoundObjectTypes(row.definition)) objectTypes.add(objectType);
  }
  return { componentIds: [...componentIds].sort(), objectTypes: [...objectTypes].sort() };
}

export async function listCurrentProducts(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, input: ProductPanelCatalogQuery & Pick<ProductProjectionCatalogQuery, "componentId" | "objectType">, picker?: { offset: number }) {
  const cursor = readCursor(input);
  const panelCatalog = kind === "panel";
  const projectionCatalog = kind === "projection";
  const { visible, edited } = picker
    ? { visible: await grantedProductIds("use", credentials), edited: new Set<string>() }
    : await catalogueGrants(credentials, panelCatalog);
  const updated = input.sort === "updated";
  const order = updated ? "updated_at" : "lower(definition->>'name')";
  const direction = updated ? "DESC" : "ASC";
  const keyType = updated ? "timestamptz" : "text";
  // PostgreSQL provides the exact timestamp key, including sub-millisecond precision.
  const cursorKey = updated ? "to_jsonb(updated_at)#>>'{}'" : order;
  const kindColumn = projectionCatalog ? `,definition->>'componentId' AS "componentId",definition`
    : `,definition,definition->'template' AS template,domain_id AS "domainId",created_at AS "createdAt"`;
  const componentId = projectionCatalog ? input.componentId ?? null : null;
  const objectType = projectionCatalog ? input.objectType ?? null : null;
  const objectTypeLayer = objectType ? platformLayerOfObjectType(objectType) : null;
  const objectTypePlatformOps = objectType ? platformOperationsOwnedByType(objectType) : [];
  const projectionFilter = projectionCatalog
    ? `AND ($8::text IS NULL OR definition->>'componentId' = $8::text)
       AND (
         $9::text IS NULL
         OR EXISTS (
           SELECT 1
           FROM jsonb_each(CASE WHEN jsonb_typeof(definition->'data') = 'object' THEN definition->'data' ELSE '{}'::jsonb END) AS d(k, v)
           WHERE jsonb_typeof(v) = 'object' AND jsonb_typeof(v->'source') = 'object' AND (
             v->'source'->'type'->>'id' = $9::text
             OR v->'source'->'object'->'literal'->>'className' = $9::text
             OR (
               jsonb_typeof(definition->'inputs') = 'object'
               AND jsonb_typeof(v->'source'->'object') = 'object'
               AND v->'source'->'object'->>'input' IS NOT NULL
               AND ${inputPortMatchesObjectTypeSql("definition->'inputs'->(v->'source'->'object'->>'input')", "$9::text", "$10::text")}
             )
           )
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_each(CASE WHEN jsonb_typeof(definition->'operations') = 'object' THEN definition->'operations' ELSE '{}'::jsonb END) AS o(k, v)
           WHERE jsonb_typeof(v) = 'object' AND (
             v->'target'->'literal'->>'className' = $9::text
             OR (
               jsonb_typeof(definition->'inputs') = 'object'
               AND jsonb_typeof(v->'target') = 'object'
               AND v->'target'->>'input' IS NOT NULL
               AND ${inputPortMatchesObjectTypeSql("definition->'inputs'->(v->'target'->>'input')", "$9::text", "$10::text")}
             )
             OR (
               jsonb_typeof(v->'operation') = 'object'
               AND v->'operation'->>'kind' = 'PlatformOperation'
               AND v->'operation'->>'id' = ANY($11::text[])
             )
           )
         )
         OR ($9::text = '${METRIC_VIEW}' AND COALESCE(definition->>'metricId', '') <> '')
       )`
    : "";
  const whereFilter = `WHERE ${catalogueVisibility("$7::boolean AND owner_id=$4")}
       ${picker ? "AND (domain_id IS NULL OR id=ANY($2::text[]))" : ""}
       AND ($6::boolean IS NULL OR COALESCE(definition->'template', 'false'::jsonb) = to_jsonb($6::boolean))
       AND ($3='all' OR COALESCE(owner_id=$4,false)=($3='mine'))
       AND (strpos(lower(definition->>'name'),lower($5))>0 OR strpos(lower(definition->>'description'),lower($5))>0)
       ${projectionFilter}`;
  const filterValues = [
    owner.domainId, visible, input.scope, owner.userId, input.q,
    panelCatalog ? input.template ?? null : null, panelCatalog && !picker,
    ...(projectionCatalog ? [componentId, objectType, objectTypeLayer, objectTypePlatformOps] : []),
  ];
  const cursorParamOffset = filterValues.length;
  const [{ rows }, { rows: countRows }] = await Promise.all([
    getPostgresPool().query<SummaryRow>(
      `SELECT id,owner_id AS "ownerId",definition->>'name' AS name,definition->>'description' AS description,
         definition->>'visibility' AS visibility,revision,updated_at AS "updatedAt",${cursorKey} AS "sortKey"${kindColumn}
       FROM ${currentProductRows(kind)} AS definitions
       ${whereFilter}
         AND ($${cursorParamOffset + 1}::${keyType} IS NULL OR (${order},id) ${updated ? "<" : ">"} ($${cursorParamOffset + 1}::${keyType},$${cursorParamOffset + 2}::text))
       ORDER BY ${order} ${direction},id ${direction} LIMIT $${cursorParamOffset + 3} OFFSET $${cursorParamOffset + 4}`,
      [...filterValues, cursor?.key ?? null, cursor?.id ?? null, input.limit + 1, picker?.offset ?? 0],
    ),
    getPostgresPool().query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM ${currentProductRows(kind)} AS definitions ${whereFilter}`,
      filterValues,
    ),
  ]);
  const total = countRows[0]?.total ?? 0;
  const unavailableItems: { id: string; reason: string; revision?: number }[] = [];
  const items = rows.slice(0, input.limit).flatMap(({ sortKey: _sortKey, definition, domainId, createdAt, updatedAt, template, ...row }) => {
    const summary = {
      ...row, ...(template == null ? {} : { template }), updatedAt: updatedAt.toISOString(),
      editable: row.ownerId !== null && edited.has(row.id),
    };
    if (!panelCatalog) {
      return [{ ...summary, objectTypes: projectionBoundObjectTypes(definition) }];
    }
    const { unavailable } = cataloguePanel(owner, { ...row, definition, domainId, createdAt, updatedAt }, summary.editable);
    if (!unavailable) return [summary];
    unavailableItems.push(unavailable);
    return [];
  });
  const last = rows[input.limit - 1];
  const nextCursor = rows.length > input.limit
    ? Buffer.from(JSON.stringify({ sort: input.sort, key: last.sortKey, id: last.id })).toString("base64url") : null;
  return { items, nextCursor, total, ...(unavailableItems.length > 0 && { unavailableItems }) };
}

export async function currentProductUsedBy(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string): Promise<ProductPanelUsedBy | ProductProjectionUsedBy> {
  if (kind === "projection") {
    await requireCurrentProduct(owner, credentials, kind, id, "use");
    return panelsUsingProjection(owner.domainId, id, credentials);
  }
  await loadCataloguePanel(owner, credentials, id);
  return panelUsers(owner.domainId, id, credentials, undefined, id);
}

function panelProjectionIds(definition: unknown) {
  const parsed = panelReferenceDefinitionSchema.safeParse(definition);
  // An unreadable outbound binding is insufficient evidence to delete its projection.
  if (!parsed.success) return [];
  const { manifest } = parsed.data;
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

export async function deleteCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, revision: number | undefined) {
  const cleanup = await transaction(async client => {
    await lockProducts(client, owner);
    const { domainId } = owner;
    const panel = kind === "panel" ? await findCurrentProduct(domainId, kind, id, client) : undefined;
    const authoredPanel = panel?.ownerId === owner.userId ? panel : undefined;
    const current = authoredPanel ?? await requireCurrentProduct(owner, credentials, kind, id, "edit", client);
    if (revision !== undefined && current.revision !== revision)
      throw new HttpError(409, "Definition changed; reload before deleting", "PRODUCT_CONFLICT");
    if (kind === "projection") {
      const usage = await panelsUsingProjection(domainId, id, credentials, client);
      if (usage.panels.length || usage.hiddenCount)
        throw new HttpError(409, "Projection is in use", PRODUCT_IN_USE, usage);
      await removeCurrentProduct(client, domainId, kind, id);
      return;
    }
    const usage = await panelUsers(domainId, id, credentials, client, id);
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
        const users = await findPanelUsers(domainId, "projection", projectionId, client, id);
        if (users.length) continue;
        if (editable.has(projectionId)) deletedProjectionIds.push(projectionId);
        else retainedProjectionIdsWithoutEdit.push(projectionId);
      }
    }
    // The stored owner may remove this row. Revoking Java grants for the ID still requires a current edit Grant.
    const unregisterGrant = !authoredPanel || await productGrantAllowed(id, "edit", credentials);
    await removeCurrentProduct(client, domainId, kind, id, unregisterGrant);
    await removePanelDependencies(client, domainId, owner.userId, id);
    for (const projectionId of deletedProjectionIds) await removeCurrentProduct(client, domainId, "projection", projectionId);
    return { deletedProjectionIds, retainedProjectionIdsWithoutEdit };
  });
  closeDeletedDefinitionStreams(owner.domainId, { kind, id });
  if (!cleanup) return { success: true as const };
  for (const projectionId of cleanup.deletedProjectionIds)
    closeDeletedDefinitionStreams(owner.domainId, { kind: "projection", id: projectionId });
  await deliverEntryDependencyPublications(owner.domainId);
  return { success: true as const, ...cleanup };
}

export async function copyCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, sourceId: string,
  copy: { id: string; name: string; template?: boolean }) {
  const row = await transaction(async client => {
    await lockProducts(client, owner);
    const source = await requireCurrentProduct(owner, credentials, kind, sourceId, "use", client);
    const definition = {
      ...source.definition,
      name: copy.name,
      visibility: "private",
      ...(kind === "panel" && copy.template !== undefined ? { template: copy.template } : {}),
    };
    const input = kind === "projection" ? productProjectionInputSchema.parse(definition) : productPanelInputSchema.parse(definition);
    if ("componentId" in input) requireOrdinaryProjection(input);
    if (await findCurrentProduct(owner.domainId, kind, copy.id, client))
      throw new HttpError(409, "Product identity already exists", "PRODUCT_ID_CONFLICT");
    return insertCurrentProduct(client, owner, credentials, kind, copy.id, input);
  });
  await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind, id: copy.id } });
  await deliverEntryDependencyPublications(owner.domainId);
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
