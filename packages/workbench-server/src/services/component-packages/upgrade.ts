import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import type { ComponentPackageComponent } from "@ontomato/contracts/component-packages";
import type { DirectProjectionPorts } from "@ontomato/contracts/panel-projection";
import { currentProductRows } from "../../infrastructure/product-current";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { grantedProductIds } from "../product-governance/grants";
import { findProjectionPanelUsers, productReferenceKey } from "../product-panels/references";
import type { CheckComponentPackageUpgrade, ComponentPackageUpgradeChange } from "./store";

type DeclarationChange = Pick<ComponentPackageUpgradeChange, "field" | "before" | "after">;
const storedUses = z.object({
  data: z.record(z.unknown()).catch({}),
  config: z.record(z.unknown()).catch({}),
  inputs: z.record(z.unknown()).catch({}),
  outputs: z.record(z.unknown()).catch({}),
  operations: z.record(z.unknown()).catch({}),
}).catch({ data: {}, config: {}, inputs: {}, outputs: {}, operations: {} });
const boundOperation = z.object({ operation: z.object({ id: z.string() }) });

function portType(port: DirectProjectionPorts["inputs"][string] | undefined): RuntimeJsonValue | undefined {
  if (port?.kind !== "object-union") return port;
  return "layers" in port ? { ...port, layers: [...new Set(port.layers)].sort() }
    : { ...port, objectTypes: [...new Set(port.objectTypes)].sort() };
}

function declarationChanges(
  definition: unknown, component: ComponentPackageComponent, next: ComponentPackageComponent | undefined,
  panels: Iterable<{ inputs: ReadonlySet<string>; outputs: ReadonlySet<string> }>,
): DeclarationChange[] {
  if (!next) return [{ field: "component", before: component.componentId }];
  const uses = storedUses.parse(definition);
  const changes: DeclarationChange[] = [];
  const compare = (field: string, before?: RuntimeJsonValue, after?: RuntimeJsonValue) => {
    if (!isDeepStrictEqual(before, after)) changes.push({ field, before, after });
  };
  const dataType = (datum: ReturnType<typeof appsSdkComponentDatum>) => datum && ({
    results: [...new Set(datum.results)].sort(),
    runtimeParams: [...new Set(datum.runtimeParams ?? [])].sort(),
  });
  for (const name of Object.keys(uses.data)) {
    const before = appsSdkComponentDatum(component.data, name);
    if (before) compare(`data.${name}`, dataType(before), dataType(appsSdkComponentDatum(next.data, name)));
  }
  for (const [name, datum] of Object.entries(next.data ?? {})) {
    if (datum.required && !appsSdkComponentDatum(component.data, name)?.required && !Object.hasOwn(uses.data, name))
      compare(`data.${name}`, undefined, { ...dataType(datum), required: true });
  }
  for (const field of component.config ?? []) {
    if (Object.hasOwn(uses.config, field.name))
      compare(`config.${field.name}`, field.type, next.config?.find(item => item.name === field.name)?.type);
  }
  for (const field of next.config ?? []) {
    const before = component.config?.find(item => item.name === field.name);
    if (field.required && field.default === undefined && !Object.hasOwn(uses.config, field.name) &&
        (!before?.required || before.default !== undefined))
      compare(`config.${field.name}`, before && { type: before.type, required: before.required }, { type: field.type, required: true });
  }
  const connections = [...panels];
  for (const side of ["inputs", "outputs"] as const) {
    const names = new Set([...Object.keys(uses[side]), ...connections.flatMap(panel => [...panel[side]])]);
    for (const name of names) {
      const before = component[side]?.[name];
      if (before) compare(`${side}.${name}`, portType(before), portType(next[side]?.[name]));
    }
  }
  const handlers = new Set(Object.values(uses.operations).flatMap(value => {
    const parsed = boundOperation.safeParse(value);
    return parsed.success ? [parsed.data.operation.id] : [];
  }));
  for (const { name, handlerRef } of component.operations ?? []) {
    if (Object.hasOwn(uses.operations, name) || handlers.has(handlerRef))
      compare(`operations.${name}`, handlerRef, next.operations?.find(operation => operation.name === name)?.handlerRef);
  }
  // An empty declaration can still bear an ordinary projection. Omission makes the component unprojectable.
  if (component.data !== undefined && next.data === undefined && !changes.some(change => change.field.startsWith("data.")))
    compare("data", {}, undefined);
  return changes;
}

export const checkComponentPackageUpgrade: CheckComponentPackageUpgrade = async (previous, candidate, caller) => {
  const next = new Map(candidate.components.map(component => [component.componentId, component]));
  const old = new Map(previous.components.filter(component => !isDeepStrictEqual(component, next.get(component.componentId)))
    .map(component => [component.componentId, component]));
  if (!old.size) return [];

  const { affected, users } = await transaction(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows } = await client.query<{ domainId: string | null; id: string; component: string; definition: unknown }>(
      `SELECT domain_id AS "domainId",id,definition,definition->>'componentId' AS component
       FROM ${currentProductRows("projection")} AS definitions
       WHERE definition->>'componentId'=ANY($1::text[]) ORDER BY domain_id,id`, [[...old.keys()]],
    );
    const users = rows.length ? await findProjectionPanelUsers(rows, client) : new Map();
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
