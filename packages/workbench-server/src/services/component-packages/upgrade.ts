import { isDeepStrictEqual } from "node:util";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { grantedProductIds } from "../product-governance/grants";
import { productReferenceKey } from "../product-panels/references";
import { declarationChanges, findComponentUsers, type DeclarationChange } from "../product-panels/component-users";
import type { CheckComponentPackageUpgrade, ComponentPackageUpgradeChange } from "./store";

export const checkComponentPackageUpgrade: CheckComponentPackageUpgrade = async (previous, candidate, caller) => {
  const next = new Map(candidate.components.map(component => [component.componentId, component]));
  const old = new Map(previous.components.filter(component => !isDeepStrictEqual(component, next.get(component.componentId)))
    .map(component => [component.componentId, component]));
  if (!old.size) return [];

  const { affected, users } = await transaction(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows, users } = await findComponentUsers([...old.keys()], client);
    const affected = rows.flatMap(row => {
      const panels = users.get(productReferenceKey(row))?.values() ?? [];
      const changes = declarationChanges(row.definition, old.get(row.component)!, next.get(row.component), panels);
      return changes.length ? [{ ...row, changes }] : [];
    });
    return { affected, users };
  });
  if (!affected.length) return [];

  const deployment = caller.diagnosticsScope === "deployment";
  const visible = new Set<string>();
  if (!deployment && caller.domainId) {
    try {
      for (const id of await grantedProductIds("use", caller.credentials)) visible.add(id);
    } catch (error) {
      if (!(error instanceof HttpError && (error.status === 401 || error.status === 403))) throw error;
    }
  }
  type ResourceRef = ComponentPackageUpgradeChange["projections"][number];
  const canSee = ({ domainId, id }: ResourceRef) =>
    deployment || domainId === null || (domainId === caller.domainId && visible.has(id));
  const found = new Map<string, DeclarationChange & {
    component: string; projections: Map<string, ResourceRef>; panels: Map<string, ResourceRef>;
  }>();
  for (const projection of affected) {
    const { component, id, domainId } = projection;
    const projectionKey = productReferenceKey(projection);
    for (const change of projection.changes) {
      const key = JSON.stringify([component, change.field, change.before, change.after]);
      const entry = found.get(key) ?? { ...change, component, projections: new Map(), panels: new Map() };
      if (canSee(projection)) entry.projections.set(projectionKey, { id, domainId });
      for (const panel of users.get(projectionKey)?.values() ?? []) {
        if (canSee(panel)) entry.panels.set(productReferenceKey(panel), { id: panel.id, domainId: panel.domainId });
      }
      found.set(key, entry);
    }
  }
  const references = (entries: Map<string, ResourceRef>) => [...entries.values()]
    .sort((left, right) => (left.domainId ?? "").localeCompare(right.domainId ?? "") || left.id.localeCompare(right.id));
  const ids = (entries: ResourceRef[]) => [...new Set(entries.map(({ id }) => id))].sort();
  return [...found.values()].map(({ projections, panels, ...change }) => {
    const affectedProjections = references(projections);
    const affectedPanels = references(panels);
    return { ...change, projections: affectedProjections, panels: affectedPanels,
      projectionIds: ids(affectedProjections), panelIds: ids(affectedPanels) };
  }).sort((left, right) => left.component.localeCompare(right.component) || left.field.localeCompare(right.field));
};
