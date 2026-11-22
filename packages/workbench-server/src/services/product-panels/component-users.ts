import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import type { DirectProjectionPorts } from "@ontomato/contracts/panel-projection";
import type { PoolClient } from "pg";
import { currentProductRows } from "../../infrastructure/product-current";
import { findProjectionPanelUsers } from "./references";

export type DeclarationChange = { field: string; before?: RuntimeJsonValue; after?: RuntimeJsonValue };
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

export function declarationChanges(
  definition: unknown, component: ComponentDeclaration, next: ComponentDeclaration | undefined,
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

/** Deployed components can have users in any domain. Domain components have users only in their owning domain. */
export async function findComponentUsers(componentIds: readonly string[], client: Pick<PoolClient, "query">, domainId?: string) {
  const { rows } = await client.query<{ domainId: string | null; id: string; component: string; definition: unknown }>(
    `SELECT domain_id AS "domainId",id,definition,definition->>'componentId' AS component
     FROM ${currentProductRows("projection")} AS definitions
     WHERE definition->>'componentId'=ANY($1::text[]) AND ($2::text IS NULL OR domain_id=$2)
     ORDER BY domain_id,id`, [componentIds, domainId ?? null],
  );
  const users: Awaited<ReturnType<typeof findProjectionPanelUsers>> = rows.length ? await findProjectionPanelUsers(rows, client) : new Map();
  return { rows, users };
}
