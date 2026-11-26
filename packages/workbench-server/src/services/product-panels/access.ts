import { findCurrentProducts, type CurrentProductKind, type CurrentProductRow } from "../../infrastructure/product-current";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { decideObjects, requireAllowed, type ObjectDefinition } from "../product-governance/authorization";

export type DefinitionKind = CurrentProductKind | "component";
export const definitionKinds = { panel: "PANEL", projection: "PROJECTION", component: "COMPONENT" } as const;
type DefinitionFacts = Pick<CurrentProductRow, "id" | "domainId" | "ownerId">;

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
  const objects = rows.map(row => currentDefinition(kind, row, domainId));
  const requested = objects.map(object => ({ ...object, verb: "USE" as const }));
  const edits = readEdits ? objects.filter((_, index) => rows[index].domainId !== null) : [];
  const decisions = await decideObjects([
    ...requested, ...edits.map(object => ({ ...object, verb: "EDIT" as const })),
  ], credentials);
  const editable = new Set(edits.filter((_, index) => decisions[requested.length + index].allowed).map(({ target }) => target.id));
  return { decisions: decisions.slice(0, requested.length), editable };
}

export async function requireCurrentDefinitionUse(
  kind: DefinitionKind, row: DefinitionFacts, domainId: string, credentials: AssistantCredentials,
) {
  const { decisions } = await currentDefinitionAccess(kind, [row], domainId, credentials, false);
  requireCurrentUseAllowed(kind, decisions[0], credentials.locale);
}

export function requireCurrentUseAllowed(
  kind: DefinitionKind, decision: Parameters<typeof requireAllowed>[0], locale: AssistantCredentials["locale"],
) {
  if (kind === "panel" && !decision.allowed && decision.code === "OBJECT_FORBIDDEN") {
    throw new HttpError(403, tForLocale(locale, "panels.objectDetail.forbidden"), decision.code);
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
