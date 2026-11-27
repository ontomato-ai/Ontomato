import { fixedProductAllows } from "@ontomato/contracts/fixed-product-access";
import { tForLocale } from "../../i18n";
import { getPostgresPool } from "../../infrastructure/postgres";
import { currentProductRows, findCurrentProducts, type CurrentProductKind, type CurrentProductRow } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { decideObjects, objectVisibilitySql, readObjectRanges, requireAllowed, type Decision, type ObjectDefinition, type ObjectVisibilityRange } from "../product-governance/authorization";

export type DefinitionKind = CurrentProductKind | "component";
export const definitionKinds = { panel: "PANEL", projection: "PROJECTION", component: "COMPONENT" } as const;
type DefinitionFacts = Pick<CurrentProductRow, "id" | "domainId" | "ownerId">;
const AUTH_COLUMNS = { ownerId: "p.owner_id", id: "p.id" };

export async function readCurrentProductVisibility(
  kind: CurrentProductKind, domainId: string, credentials: AssistantCredentials, readEdits: boolean,
) {
  const { USE, EDIT } = readEdits
    ? await readObjectRanges(definitionKinds[kind], ["USE", "EDIT"], credentials)
    : { ...await readObjectRanges(definitionKinds[kind], ["USE"], credentials), EDIT: undefined };
  return currentProductVisibility(kind, domainId, USE, EDIT);
}

export function currentProductVisibility(
  kind: CurrentProductKind, domainId: string, USE: ObjectVisibilityRange, EDIT?: ObjectVisibilityRange,
) {
  const values: unknown[] = [domainId];
  const use = objectVisibilitySql(USE, AUTH_COLUMNS, values);
  // Only panel management includes EDIT in visibility; projection EDIT annotates the page.
  const managed = kind === "panel" && EDIT ? objectVisibilitySql(EDIT, AUTH_COLUMNS, values) : null;
  const source = currentProductRows(kind, {
    domainWhere: `p.domain_id=$1 AND (${managed === null ? use : `(${use}) OR (${managed})`})`,
    includeBuiltins: USE.fixed,
  });
  return {
    source,
    values,
    editPredicate: (pageValues: unknown[]) => EDIT
      ? `p.domain_id IS NOT NULL AND (${managed ?? objectVisibilitySql(EDIT, AUTH_COLUMNS, pageValues)})`
      : "FALSE",
  };
}

export type DefinitionVisibilityRange = ObjectVisibilityRange;
export type ProductUseRanges = { USE: DefinitionVisibilityRange; EDIT?: DefinitionVisibilityRange };

/** Apply the current Java range to one owner record, not to an ID supplied by a panel. */
export function definitionVisibleInRange(row: DefinitionFacts, range: DefinitionVisibilityRange, domainId: string): boolean {
  return row.domainId === null ? range.fixed : row.domainId === domainId && (
    range.all || range.objectIds.includes(row.id) || (range.authorId !== null && row.ownerId === range.authorId)
  );
}

export function currentDefinition(kind: DefinitionKind, row: DefinitionFacts, domainId: string): ObjectDefinition {
  return {
    target: { kind: definitionKinds[kind], id: row.id, domainId: row.domainId ?? domainId },
    ownerFacts: { ownerId: row.ownerId, state: "PUBLISHED" },
  };
}

export async function currentDefinitionAccess(
  kind: DefinitionKind, rows: readonly DefinitionFacts[], domainId: string, credentials: AssistantCredentials,
  readEdits = true,
) {
  // Only records returned from the owner's builtin tables have a null domain for panels and projections.
  const policyRows = kind === "component" ? rows : rows.filter(row => row.domainId !== null);
  const objects = policyRows.map(row => currentDefinition(kind, row, domainId));
  const edits = readEdits ? objects : [];
  const decisions = await decideObjects([
    ...objects.map(object => ({ ...object, verb: "USE" as const })),
    ...edits.map(object => ({ ...object, verb: "EDIT" as const })),
  ], credentials);
  const editable = new Set(edits.filter((_, index) => decisions[objects.length + index].allowed).map(({ target }) => target.id));
  let policyIndex = 0;
  return {
    decisions: rows.map((row): Decision => {
      if (kind === "component" || row.domainId !== null) return decisions[policyIndex++];
      return fixedProductAllows(definitionKinds[kind], "USE")
        ? { allowed: true }
        : { allowed: false, code: "OBJECT_FORBIDDEN", reason: "This platform definition cannot be used." };
    }),
    editable,
  };
}

export async function usableCurrentDefinitionIds(
  kind: CurrentProductKind, domainId: string, credentials: AssistantCredentials,
) {
  const { rows } = await getPostgresPool().query<DefinitionFacts>(
    `SELECT id, domain_id AS "domainId", owner_id AS "ownerId"
     FROM ${currentProductRows(kind)} AS definitions WHERE domain_id IS NULL OR domain_id=$1`, [domainId],
  );
  const { decisions } = await currentDefinitionAccess(kind, rows, domainId, credentials, false);
  return rows.filter((_, index) => decisions[index].allowed).map(({ id }) => id);
}

export function countCurrentDefinitionsInRange(kind: CurrentProductKind, domainId: string, range: DefinitionVisibilityRange) {
  return countVisibleDefinitions(currentProductVisibility(kind, domainId, range));
}

export async function countUsableCurrentDefinitions(
  kind: CurrentProductKind, domainId: string, credentials: AssistantCredentials,
): Promise<number> {
  return countVisibleDefinitions(await readCurrentProductVisibility(kind, domainId, credentials, false));
}

async function countVisibleDefinitions({ source, values }: ReturnType<typeof currentProductVisibility>) {
  const { rows: [result] } = await getPostgresPool().query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ${source} AS p`, values,
  );
  return result.total;
}

export async function requireCurrentDefinitionUse(
  kind: DefinitionKind, row: DefinitionFacts, domainId: string, credentials: AssistantCredentials,
) {
  const { decisions } = await currentDefinitionAccess(kind, [row], domainId, credentials, false);
  requireCurrentUseAllowed(kind, decisions[0], credentials.locale);
}

export function panelUseForbidden(locale: AssistantCredentials["locale"]) {
  return new HttpError(403, tForLocale(locale, "panels.objectDetail.forbidden"), "OBJECT_FORBIDDEN");
}

export function requireCurrentUseAllowed(
  kind: DefinitionKind, decision: Parameters<typeof requireAllowed>[0], locale: AssistantCredentials["locale"],
) {
  if (kind === "panel" && !decision.allowed && decision.code === "OBJECT_FORBIDDEN") {
    throw panelUseForbidden(locale);
  }
  requireAllowed(decision);
}

export async function usableCurrentIds(
  kind: CurrentProductKind, domainId: string, ids: readonly string[], credentials: AssistantCredentials,
  client?: Parameters<typeof findCurrentProducts>[3],
) {
  const rows = [...(await findCurrentProducts(domainId, kind, ids, client)).values()];
  const { decisions } = await currentDefinitionAccess(kind, rows, domainId, credentials, false);
  return new Set(rows.filter((_, index) => decisions[index].allowed).map(row => row.id));
}
