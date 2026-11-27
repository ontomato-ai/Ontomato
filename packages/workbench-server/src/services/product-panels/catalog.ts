import type { ProductPanelCatalogQuery, ProductProjectionCatalogQuery } from "@ontomato/contracts/product-catalog-query";
import { z } from "zod";
import type { PoolClient } from "pg";
import { panelPlacementSchema } from "@ontomato/contracts/panel-manifest";
import { METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import {
  PRODUCT_IN_USE, platformLayerOfObjectType, platformOperationsOwnedByType, productCurrentIdParamsSchema,
  productPanelSchema, productPanelInputSchema, productProjectionInputSchema, projectionBoundObjectTypes,
  type ProductCatalogQuery, type ProductPanel, type ProductPanelUsedBy, type ProductProjectionUsedBy, type ProductVisibility,
} from "@ontomato/contracts/product-panels";
import {
  currentProductColumns, currentProductRecord, currentProductRows, currentProductTables, findCurrentProduct, findCurrentProducts,
  type CurrentProductKind, type CurrentProductRow,
} from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { ChangeProductObjectGrant } from "@ontomato/contracts/object-policy-access";
import {
  changeProductObjectAccess, objectVisibilitySql, readProductObjectAccess, retireObject, setProductDomainUse,
} from "../product-governance/authorization";
import { currentDefinition, currentDefinitionAccess, currentProductVisibility, definitionVisibleInRange, readCurrentProductVisibility, type DefinitionVisibilityRange, type ProductUseRanges } from "./access";
import { insertCurrentProduct, loadCurrentProduct, readPanelManagementAccess, requireCurrentProduct, requireOrdinaryProjection } from "./current";
import { panelDefinitionProblem } from "./definition-diagnostics";
import { closeDeletedDefinitionStreams, notifyProductDefinitionChanged } from "./definition-stream";
import { findPanelUsers, panelReferenceDefinitionSchema } from "./references";
import { panelsUsingProjection, panelUsers } from "./used-by";
import { removePanelDependencies } from "./entry-dependency-store";
import { deliverEntryDependencyPublications } from "./entry-dependency-publication";

const cursorSchema = z.discriminatedUnion("sort", [
  z.object({ sort: z.literal("name"), key: z.string().nullable(), id: productCurrentIdParamsSchema.shape.id }).strict(),
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
  sortKey: string | null;
  editable: boolean;
  componentId?: string;
  template?: boolean | null;
  definition: CurrentProductRow["definition"];
  domainId: CurrentProductRow["domainId"];
  createdAt: Date;
}

export function cataloguePanel(row: CurrentProductRow, editable: boolean) {
  const result = productPanelSchema.safeParse(currentProductRecord(row, editable));
  if (result.success) return { panel: result.data };
  return {
    unavailable: {
      id: row.id,
      reason: panelDefinitionProblem(result.error),
      ...(editable && { revision: row.revision }),
    },
  };
}

async function loadCataloguePanel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const row = await loadCurrentProduct(owner.domainId, "panel", id);
  const { allowed, editable } = await readPanelManagementAccess(owner, credentials, row);
  if (!allowed) throw new HttpError(403, "Product use Grant required", "PRODUCT_FORBIDDEN");
  return { row, editable };
}

export async function readCataloguePanel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const { row, editable } = await loadCataloguePanel(owner, credentials, id);
  return cataloguePanel(row, editable);
}

type PanelManagementRanges = { USE: DefinitionVisibilityRange; EDIT: DefinitionVisibilityRange };

function panelManagementInRanges(row: CurrentProductRow, domainId: string, { USE, EDIT }: PanelManagementRanges) {
  return {
    editable: row.domainId !== null && definitionVisibleInRange(row, EDIT, domainId),
    usable: definitionVisibleInRange(row, USE, domainId),
  };
}

export async function requireCataloguePanelInRanges(domainId: string, id: string, ranges: PanelManagementRanges) {
  const row = await loadCurrentProduct(domainId, "panel", id);
  const { editable, usable } = panelManagementInRanges(row, domainId, ranges);
  if (!editable && !usable) throw new HttpError(403, "Product use Grant required", "PRODUCT_FORBIDDEN");
  return cataloguePanel(row, editable);
}

export async function readCataloguePanelInRanges(domainId: string, id: string, ranges: PanelManagementRanges) {
  const row = await findCurrentProduct(domainId, "panel", id);
  if (!row) return;
  const { editable, usable } = panelManagementInRanges(row, domainId, ranges);
  if (!editable && !usable) return;
  return cataloguePanel(row, editable);
}

export async function listUnavailablePanels(owner: ProductOwner, credentials: AssistantCredentials) {
  return readUnavailablePanels(await readCurrentProductVisibility("panel", owner.domainId, credentials, true));
}

export async function readUnavailablePanels({ source, values, editPredicate }: Awaited<ReturnType<typeof readCurrentProductVisibility>>) {
  const { rows } = await getPostgresPool().query<CurrentProductRow & { editable: boolean }>(
    `SELECT ${currentProductColumns},${editPredicate(values)} AS editable FROM ${source} AS p ORDER BY id`,
    values,
  );
  return rows.flatMap(({ editable, ...row }) => {
    const { unavailable } = cataloguePanel(row, editable);
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
  return readProjectionFilterFacets(await readCurrentProductVisibility("projection", owner.domainId, credentials, false));
}

export async function readProjectionFilterFacets({ source, values }: Awaited<ReturnType<typeof readCurrentProductVisibility>>) {
  const { rows } = await getPostgresPool().query<{ componentId: string | null; definition: CurrentProductRow["definition"] }>(
    `SELECT definition->>'componentId' AS "componentId", definition FROM ${source} AS p`,
    values,
  );
  const componentIds = new Set<string>();
  const objectTypes = new Set<string>();
  for (const row of rows) {
    if (row.componentId) componentIds.add(row.componentId);
    for (const objectType of projectionBoundObjectTypes(row.definition)) objectTypes.add(objectType);
  }
  return { componentIds: [...componentIds].sort(), objectTypes: [...objectTypes].sort() };
}

/** Every readable current record of a kind: the whole catalogue, not its first page. */
export async function listCurrentProductRecords(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind,
) {
  const records = new Map<string, Awaited<ReturnType<typeof listCurrentProducts>>["items"][number]>();
  let cursor: string | undefined;
  do {
    const page = await listCurrentProducts(owner, credentials, kind, { q: "", scope: "all", sort: "name", limit: 100, cursor });
    for (const item of page.items) records.set(item.id, item);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return records;
}

/** Names of every readable current record of a kind, keyed by id. */
export async function listCurrentProductNames(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind,
): Promise<Map<string, string>> {
  const records = await listCurrentProductRecords(owner, credentials, kind);
  return new Map([...records].map(([id, item]) => [id, item.name || id]));
}

/** Read the referenced catalogue panels and retain USE separately from label visibility. */
export async function readScopedPanels(
  domainId: string, ids: readonly string[], ranges: PanelManagementRanges,
) {
  const panels = new Map<string, { panel: ProductPanel; usable: boolean }>();
  if (!ids.length) return panels;
  const rows = await findCurrentProducts(domainId, "panel", ids);
  for (const row of rows.values()) {
    const { editable, usable } = panelManagementInRanges(row, domainId, ranges);
    if (!editable && !usable) continue;
    const { panel } = cataloguePanel(row, editable);
    if (panel) panels.set(row.id, { panel, usable });
  }
  return panels;
}

/** Resolve labels for referenced panels with the management catalogue's USE-or-EDIT visibility. */
export async function readScopedPanelNames(
  domainId: string, ids: readonly string[], ranges: Parameters<typeof readScopedPanels>[2],
): Promise<Map<string, string>> {
  const panels = await readScopedPanels(domainId, ids, ranges);
  return new Map([...panels].map(([id, { panel }]) => [id, panel.name || id]));
}

/** Use the projection catalogue's USE scope and label columns for the requested references. */
export async function readScopedProjectionNames(
  domainId: string, ids: readonly string[], range: DefinitionVisibilityRange,
): Promise<Map<string, string>> {
  const summaries = await readScopedProjectionSummaries(domainId, ids, range);
  return new Map([...summaries].map(([id, { name }]) => [id, name]));
}

export async function readScopedProjectionSummaries(
  domainId: string, ids: readonly string[], range: DefinitionVisibilityRange,
): Promise<Map<string, { name: string; description: string | null; componentId: string | null }>> {
  if (!ids.length) return new Map();
  const values: unknown[] = [domainId, ids];
  const use = objectVisibilitySql(range, { id: "p.id", ownerId: "p.owner_id" }, values);
  const source = currentProductRows("projection", { domainWhere: `p.domain_id=$1 AND (${use})`, includeBuiltins: range.fixed });
  const { rows } = await getPostgresPool().query<{ id: string; name: string | null; description: string | null; componentId: string | null }>(
    `SELECT p.id, definition->>'name' AS name, definition->>'description' AS description,
      definition->>'componentId' AS "componentId" FROM ${source} AS p
      WHERE p.id = ANY($2::text[]) AND (definition->>'name' IS NOT NULL OR definition->>'description' IS NOT NULL)`, values,
  );
  return new Map(rows.map(({ id, name, description, componentId }) => [id, { name: name || id, description, componentId }]));
}

type CatalogueInput = ProductPanelCatalogQuery & Pick<ProductProjectionCatalogQuery, "componentId" | "objectType">;
type AuthorSearch = readonly string[] | "pending";

function catalogueFilters(kind: CurrentProductKind, ownerId: string, input: CatalogueInput, values: unknown[], matchingAuthors?: AuthorSearch) {
  const [scope, user] = [input.scope, ownerId].map(value => `$${values.push(value)}`);
  const search = matchingAuthors === "pending" ? undefined : `$${values.push(input.q)}`;
  const template = `$${values.push(kind === "panel" ? input.template ?? null : null)}`;
  const projectionFilter = kind === "projection" ? projectionFilterSql(input, values) : "";
  const authors = matchingAuthors !== undefined && matchingAuthors !== "pending"
    ? ` OR p.owner_id = ANY($${values.push(matchingAuthors)}::text[])` : "";
  const textMatch = search === undefined ? "" : `AND (strpos(lower(definition->>'name'),lower(${search}))>0 OR strpos(lower(definition->>'description'),lower(${search}))>0${authors})`;
  return `WHERE (${template}::boolean IS NULL OR COALESCE(definition->'template', 'false'::jsonb) = to_jsonb(${template}::boolean))
       AND (${scope}='all' OR COALESCE(owner_id=${user},false)=(${scope}='mine'))
       ${textMatch}
       ${projectionFilter}`;
}

function catalogueOrder(sort: ProductCatalogQuery["sort"]) {
  const updated = sort === "updated";
  const order = updated ? "updated_at" : "lower(definition->>'name')";
  return {
    orderBy: updated ? `${order} DESC,p.id DESC` : `${order} ASC NULLS LAST,p.id ASC`,
    // PostgreSQL provides the exact timestamp key, including sub-millisecond precision.
    cursorKey: updated ? "to_jsonb(updated_at)#>>'{}'" : order,
    after(cursor: ReturnType<typeof readCursor>, values: unknown[]) {
      const [key, id] = [cursor?.key ?? null, cursor?.id ?? null].map(value => `$${values.push(value)}`);
      // A missing stored name sorts after every named row, with ID breaking ties within the null group.
      const compare = updated
        ? `(${order},p.id) < (${key}::timestamptz,${id}::text)`
        : `(${order} IS NULL,COALESCE(${order},''),p.id) > (${key}::text IS NULL,COALESCE(${key}::text,''),${id}::text)`;
      return `AND (${id}::text IS NULL OR ${compare})`;
    },
  };
}

export async function catalogueAuthorCandidates(owner: ProductOwner, kind: CurrentProductKind, input: CatalogueInput, includeAuthorSearch: boolean) {
  const cursor = readCursor(input);
  const values: unknown[] = [owner.domainId];
  const source = currentProductRows(kind, { domainWhere: "p.domain_id=$1", includeBuiltins: false });
  // A text miss can still match a visible author. Keep that arm open until the identity owner answers.
  const filter = catalogueFilters(kind, owner.userId, input, values, includeAuthorSearch ? "pending" : undefined);
  const after = catalogueOrder(input.sort).after(cursor, values);
  const { rows } = await getPostgresPool().query<{ ownerId: string }>(
    `SELECT DISTINCT p.owner_id AS "ownerId" FROM ${source} AS p
       ${filter} ${after} AND p.owner_id IS NOT NULL AND p.owner_id<>''`, values,
  );
  return rows.map(row => row.ownerId);
}

export async function listCurrentProducts(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, input: CatalogueInput, picker?: { offset: number }) {
  const cursor = readCursor(input);
  const visibility = await readCurrentProductVisibility(kind, owner.domainId, credentials, !picker);
  return cataloguePage(owner, kind, input, visibility, cursor, undefined, picker);
}

export function listCurrentProductsInRanges(
  owner: ProductOwner, kind: CurrentProductKind, input: CatalogueInput, ranges: ProductUseRanges, matchingAuthors?: readonly string[],
) {
  const visibility = currentProductVisibility(kind, owner.domainId, ranges.USE, ranges.EDIT);
  return cataloguePage(owner, kind, input, visibility, readCursor(input), matchingAuthors);
}

export function listPanelPickerInRange(
  owner: ProductOwner, input: ProductPanelCatalogQuery, picker: { offset: number }, use: DefinitionVisibilityRange,
) {
  const visibility = currentProductVisibility("panel", owner.domainId, use);
  return cataloguePage(owner, "panel", input, visibility, readCursor(input), undefined, picker);
}

async function cataloguePage(
  owner: ProductOwner, kind: CurrentProductKind, input: CatalogueInput,
  { source, values: filterValues, editPredicate }: ReturnType<typeof currentProductVisibility>, cursor: ReturnType<typeof readCursor>,
  matchingAuthors?: readonly string[], picker?: { offset: number },
) {
  const panelCatalog = kind === "panel";
  const projectionCatalog = kind === "projection";
  const { orderBy, cursorKey, after } = catalogueOrder(input.sort);
  const kindColumn = projectionCatalog ? `,definition->>'componentId' AS "componentId",definition`
    : `,definition,definition->'template' AS template,domain_id AS "domainId",created_at AS "createdAt"`;
  const whereFilter = catalogueFilters(kind, owner.userId, input, filterValues, matchingAuthors);
  const pageValues = [...filterValues];
  const editable = editPredicate(pageValues);
  const afterCursor = after(cursor, pageValues);
  const [limit, offset] = [input.limit + 1, picker?.offset ?? 0].map(value => `$${pageValues.push(value)}`);
  const pool = getPostgresPool();
  const [{ rows }, { rows: [count] }] = await Promise.all([
    pool.query<SummaryRow>(
      `SELECT id,owner_id AS "ownerId",definition->>'name' AS name,definition->>'description' AS description,
         definition->>'visibility' AS visibility,revision,updated_at AS "updatedAt",${cursorKey} AS "sortKey",
         ${editable} AS editable${kindColumn}
       FROM ${source} AS p
       ${whereFilter}
       ${afterCursor}
       ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      pageValues,
    ),
    pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${source} AS p ${whereFilter}`, filterValues),
  ]);
  const unavailableItems: { id: string; reason: string; revision?: number }[] = [];
  type ListedProductItem = {
    id: string;
    ownerId: string | null;
    name: string;
    description: string;
    visibility: ProductVisibility;
    revision: number;
    updatedAt: string;
    editable: boolean;
    componentId?: string;
    template?: boolean;
    objectTypes?: string[];
    memberCount?: number;
  };
  const items = rows.slice(0, input.limit).flatMap<ListedProductItem>(({ sortKey: _sortKey, definition, domainId, createdAt, updatedAt, template, editable, ...row }) => {
    const summary = { ...row, ...(template == null ? {} : { template }), updatedAt: updatedAt.toISOString(), editable };
    if (!panelCatalog) {
      return [{ ...summary, objectTypes: projectionBoundObjectTypes(definition) }];
    }
    const { panel, unavailable } = cataloguePanel({ ...row, definition, domainId, createdAt, updatedAt }, editable);
    if (!unavailable && panel) return [{ ...summary, memberCount: Object.keys(panel.manifest.members).length }];
    if (unavailable) unavailableItems.push(unavailable);
    return [];
  });
  const last = rows[input.limit - 1];
  const nextCursor = rows.length > input.limit
    ? Buffer.from(JSON.stringify({ sort: input.sort, key: last.sortKey, id: last.id })).toString("base64url") : null;
  return { items, nextCursor, total: count.total, ...(unavailableItems.length > 0 && { unavailableItems }) };
}

function projectionFilterSql(input: Pick<ProductProjectionCatalogQuery, "componentId" | "objectType">, values: unknown[]) {
  const { objectType } = input;
  const [component, type, layer, platformOps] = [
    input.componentId ?? null, objectType ?? null, objectType ? platformLayerOfObjectType(objectType) : null,
    objectType ? platformOperationsOwnedByType(objectType) : [],
  ].map(value => `$${values.push(value)}`);
  return `AND (${component}::text IS NULL OR definition->>'componentId' = ${component}::text)
       AND (
         ${type}::text IS NULL
         OR EXISTS (
           SELECT 1
           FROM jsonb_each(CASE WHEN jsonb_typeof(definition->'data') = 'object' THEN definition->'data' ELSE '{}'::jsonb END) AS d(k, v)
           WHERE jsonb_typeof(v) = 'object' AND jsonb_typeof(v->'source') = 'object' AND (
             v->'source'->'type'->>'id' = ${type}::text
             OR v->'source'->'object'->'literal'->>'className' = ${type}::text
             OR (
               jsonb_typeof(definition->'inputs') = 'object'
               AND jsonb_typeof(v->'source'->'object') = 'object'
               AND v->'source'->'object'->>'input' IS NOT NULL
               AND ${inputPortMatchesObjectTypeSql("definition->'inputs'->(v->'source'->'object'->>'input')", `${type}::text`, `${layer}::text`)}
             )
           )
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_each(CASE WHEN jsonb_typeof(definition->'operations') = 'object' THEN definition->'operations' ELSE '{}'::jsonb END) AS o(k, v)
           WHERE jsonb_typeof(v) = 'object' AND (
             v->'target'->'literal'->>'className' = ${type}::text
             OR (
               jsonb_typeof(definition->'inputs') = 'object'
               AND jsonb_typeof(v->'target') = 'object'
               AND v->'target'->>'input' IS NOT NULL
               AND ${inputPortMatchesObjectTypeSql("definition->'inputs'->(v->'target'->>'input')", `${type}::text`, `${layer}::text`)}
             )
             OR (
               jsonb_typeof(v->'operation') = 'object'
               AND v->'operation'->>'kind' = 'PlatformOperation'
               AND v->'operation'->>'id' = ANY(${platformOps}::text[])
             )
           )
         )
         OR (${type}::text = '${METRIC_VIEW}' AND COALESCE(definition->>'metricId', '') <> '')
       )`;
}

export async function currentProjectionUsedBy(owner: ProductOwner, credentials: AssistantCredentials, id: string): Promise<ProductProjectionUsedBy> {
  await requireCurrentProduct(owner, credentials, "projection", id, "use");
  return panelsUsingProjection(owner.domainId, id, credentials);
}

export async function currentProductUsedBy(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string): Promise<ProductPanelUsedBy | ProductProjectionUsedBy> {
  if (kind === "projection") return currentProjectionUsedBy(owner, credentials, id);
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

async function removeCurrentProduct(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, row: CurrentProductRow) {
  await retireObject(currentDefinition(kind, row, owner.domainId), credentials);
  await client.query(`DELETE FROM ${t(currentProductTables[kind])} WHERE domain_id=$1 AND id=$2`, [owner.domainId, row.id]);
}

export async function deleteCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, revision: number | undefined) {
  const cleanup = await transaction(async client => {
    await lockProducts(client, owner);
    const { domainId } = owner;
    const current = await requireCurrentProduct(owner, credentials, kind, id, "edit", client);
    if (revision !== undefined && current.revision !== revision)
      throw new HttpError(409, "Definition changed; reload before deleting", "PRODUCT_CONFLICT");
    if (kind === "projection") {
      const usage = await panelsUsingProjection(domainId, id, credentials, client);
      if (usage.panels.length || usage.hiddenCount)
        throw new HttpError(409, "Projection is in use", PRODUCT_IN_USE, usage);
      await removeCurrentProduct(client, owner, credentials, kind, current);
      return;
    }
    const usage = await panelUsers(domainId, id, credentials, client, id);
    if (usage.applicationEntries.length || usage.panels.length || usage.hiddenCount || usage.classNames.length)
      throw new HttpError(409, "Panel is in use", PRODUCT_IN_USE, usage);

    const { rows: candidates } = await client.query<CurrentProductRow>(
      `SELECT ${currentProductColumns} FROM ${t(currentProductTables.projection)} WHERE domain_id=$1 AND id=ANY($2::text[]) ORDER BY id`,
      [domainId, panelProjectionIds(current.definition)],
    );
    const deletedProjectionIds: string[] = [];
    const retainedProjectionIdsWithoutEdit: string[] = [];
    if (candidates.length) {
      const { editable } = await currentDefinitionAccess("projection", candidates, domainId, credentials);
      for (const projection of candidates) {
        const users = await findPanelUsers(domainId, "projection", projection.id, client, id);
        if (users.length) continue;
        if (editable.has(projection.id)) {
          await removeCurrentProduct(client, owner, credentials, "projection", projection);
          deletedProjectionIds.push(projection.id);
        } else retainedProjectionIdsWithoutEdit.push(projection.id);
      }
    }
    await removeCurrentProduct(client, owner, credentials, kind, current);
    await removePanelDependencies(client, domainId, owner.userId, id);
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

export async function catalogueObject(owner: ProductOwner, kind: CurrentProductKind, id: string) {
  const row = await loadCurrentProduct(owner.domainId, kind, id);
  if (row.domainId === null) throw new HttpError(403, "Platform definitions are read-only", "OBJECT_FORBIDDEN");
  return currentDefinition(kind, row, owner.domainId);
}

export async function currentProductGrants(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string) {
  return readProductObjectAccess(await catalogueObject(owner, kind, id), credentials);
}

export async function changeCurrentProductGrant(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  grant: ChangeProductObjectGrant) {
  return changeProductObjectAccess(await catalogueObject(owner, kind, id), grant, credentials);
}

export async function changeCurrentProductDomainGrant(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, shared: boolean) {
  await setProductDomainUse(await catalogueObject(owner, kind, id), shared, credentials);
  return { success: true as const };
}
