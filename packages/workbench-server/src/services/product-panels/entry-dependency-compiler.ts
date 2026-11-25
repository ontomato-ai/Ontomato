import type { EntryDependency } from "@ontomato/contracts/entry-dependencies";
import { panelObjectRefSchema, panelStateIdentityField, type PanelMemberInput } from "@ontomato/contracts/panel-manifest";
import { ACTION, AGENT_DEFINITION, FUNCTION, METRIC_VIEW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
} from "@ontomato/contracts/product-panels";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { HttpError } from "../../utils/errors";
import { collectReferences } from "./references";

type Inputs = ReadonlyMap<string, unknown>;
type Projection = ReturnType<typeof productProjectionInputSchema.parse> | ReturnType<typeof builtinProductProjectionInputSchema.parse>;

export function dependencyKey({ objectType, objectKey, verb, scope }: EntryDependency) {
  return JSON.stringify([objectType, objectKey, verb, scope ? [scope.kind, scope.className, scope.field] : null]);
}

export function mergeDependencies(...sets: readonly EntryDependency[][]): EntryDependency[] {
  const dependencies = new Map<string, EntryDependency>();
  for (const set of sets) for (const dependency of set) dependencies.set(dependencyKey(dependency), dependency);
  return [...dependencies.keys()].sort().map(key => dependencies.get(key)!);
}

export function agentDependency(id: string): EntryDependency {
  return { objectType: "AGENT", objectKey: id, verb: "USE" };
}

function inputValues(wiring: Record<string, PanelMemberInput | { item: true }>, state: Inputs): Inputs {
  const inputs = new Map<string, unknown>();
  for (const [name, value] of Object.entries(wiring)) {
    if ("literal" in value) inputs.set(name, value.literal);
    else if ("state" in value && state.has(value.state)) {
      const input = state.get(value.state);
      inputs.set(name, "field" in value ? panelStateIdentityField(value.field, input as Parameters<typeof panelStateIdentityField>[1]) : input);
    }
  }
  return inputs;
}

function projectionDependencies(id: string, projection: Projection, inputs: Inputs): EntryDependency[] {
  const dependencies: EntryDependency[] = [
    { objectType: "PROJECTION", objectKey: id, verb: "USE" },
    { objectType: "COMPONENT", objectKey: projection.componentId, verb: "USE" },
  ];
  if ("metricId" in projection) {
    dependencies.push({ objectType: "METRIC", objectKey: projection.metricId, verb: "USE" });
  }
  const conversation = projection.conversationEntry?.target;
  if (conversation?.kind === "id") dependencies.push(agentDependency(conversation.id));
  if (conversation?.kind === "preset") dependencies.push(agentDependency(`preset:${conversation.agentKind}`));

  for (const { source, read } of Object.values(projection.data)) {
    if (!("object" in source)) continue;
    const object = "literal" in source.object ? source.object.literal : inputs.get(source.object.input);
    if (object == null) continue;
    const { className, primaryKey } = panelObjectRefSchema.parse(object);
    if (className === FUNCTION) dependencies.push({ objectType: "READ_FUNCTION", objectKey: primaryKey, verb: "VIEW" });
    if (className === METRIC_VIEW) {
      dependencies.push({ objectType: "METRIC", objectKey: primaryKey, verb: read === "result" ? "USE" : "VIEW" });
    }
    if (className === AGENT_DEFINITION) dependencies.push({ objectType: "AGENT", objectKey: primaryKey, verb: "VIEW" });
    if (className === ACTION) dependencies.push({ objectType: "ACTION", objectKey: primaryKey, verb: "VIEW" });
    if (className === WORKFLOW) dependencies.push({ objectType: "WORKFLOW", objectKey: primaryKey, verb: "VIEW" });
  }
  for (const { operation } of Object.values(projection.operations ?? {})) {
    if (operation.kind === "Action") dependencies.push({ objectType: "ACTION", objectKey: operation.id, verb: "EXECUTE" });
  }
  return dependencies;
}

export function storedPanelAuthoringDefinition(definition: Record<string, unknown>) {
  const manifest = definition.manifest as Record<string, unknown>;
  if (!manifest || !Object.hasOwn(manifest, "commands")) return definition;
  const { commands: _removed, ...current } = manifest;
  return { ...definition, manifest: current };
}

export function entryDependencyCompiler(client: PoolClient, domainId: string | null) {
  const definitions = new Map<string, ReturnType<typeof findCurrentProduct>>();
  function find(kind: CurrentProductKind, id: string) {
    const key = JSON.stringify([kind, id]);
    let definition = definitions.get(key);
    if (!definition) {
      definition = findCurrentProduct(domainId, kind, id, client);
      definitions.set(key, definition);
    }
    return definition;
  }

  async function compile(panelId: string, input: Inputs, active: Set<string>, path: string): Promise<EntryDependency[]> {
    if (active.has(panelId)) throw new HttpError(409, `${path} forms a panel reference cycle`, "PANEL_REFERENCE_CYCLE");
    const row = await find("panel", panelId);
    if (!row) throw new HttpError(404, `${path} references unavailable panel '${panelId}'`, "PRODUCT_UNAVAILABLE");
    const schema = isBuiltinProductId(panelId) ? builtinProductPanelInputSchema : productPanelInputSchema;
    const panel = schema.parse(storedPanelAuthoringDefinition(row.definition));
    const state = new Map<string, unknown>(Object.entries(panel.manifest.state)
      .filter(([, field]) => !field.personal && field.default != null)
      .map(([key, field]) => [key, field.default] as const));
    for (const [key, value] of input) state.set(key, value);
    const dependencies: EntryDependency[] = [{ objectType: "PANEL", objectKey: panelId, verb: "USE" }];
    for (const componentId of Object.values(panel.manifest.components ?? {})) {
      dependencies.push({ objectType: "COMPONENT", objectKey: componentId, verb: "USE" });
    }
    active.add(panelId);
    // Object detail rules select a separate entry by class. Open-ended usable rules
    // and the application content slot require no statically declared member here.
    for (const { key, target, wiring } of collectReferences(panel, new Map())) {
      const field = `Panel '${panelId}' manifest ${key.startsWith("$state.") ? key.slice(1) : `members.${key}.target`}`;
      const inputs = inputValues(wiring.inputs ?? {}, state);
      if (target.kind === "panel") {
        dependencies.push(...await compile(target.id, inputs, active, field));
      } else {
        const projection = await find("projection", target.id);
        if (!projection) throw new HttpError(404, `${field} references unavailable projection '${target.id}'`, "PRODUCT_UNAVAILABLE");
        const schema = isBuiltinProductId(target.id) ? builtinProductProjectionInputSchema : productProjectionInputSchema;
        dependencies.push(...projectionDependencies(target.id, schema.parse(projection.definition), inputs));
      }
    }
    active.delete(panelId);
    return dependencies;
  }

  return async (panelId: string) => mergeDependencies(await compile(panelId, new Map(), new Set(), `Panel '${panelId}'`));
}
