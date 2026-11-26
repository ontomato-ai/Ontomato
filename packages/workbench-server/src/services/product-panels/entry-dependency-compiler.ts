import type { EntryDependency } from "@ontomato/contracts/entry-dependencies";
import { pageComposerAgentTargetSchema } from "@ontomato/contracts/panel-conversation-entry";
import { panelObjectRefSchema, panelPlacementSchema, panelStateIdentityField, type PanelMemberInput } from "@ontomato/contracts/panel-manifest";
import { ACTION, AGENT_DEFINITION, FUNCTION, METRIC_VIEW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
  type ApplicationPanelInputs,
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

export function* declaredProjectionAgents(projection: Projection) {
  const target = projection.conversationEntry?.target;
  if (target && target.kind !== "page-default") yield { target, field: "conversationEntry.target" };

  if (projection.componentId !== "@ontomato/sdk:ObjectList" && projection.componentId !== "@ontomato/sdk:GroupedGrid") return;
  const rowActions = projection.config.rowActions;
  if (!rowActions || typeof rowActions !== "object" || Array.isArray(rowActions) || !Array.isArray(rowActions.items)) return;
  for (const [index, item] of rowActions.items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) || item.kind !== "conversation" || item.target === undefined) continue;
    const agent = pageComposerAgentTargetSchema.parse(item.target, { path: ["config", "rowActions", "items", index, "target"] });
    if (agent.kind !== "page-default") yield { target: agent, field: `config.rowActions.items.${index}.target` };
  }
}

function inputValues(wiring: Record<string, PanelMemberInput | { item: true }>, state: Inputs): Inputs {
  const inputs = new Map<string, unknown>();
  for (const [name, value] of Object.entries(wiring)) {
    if ("literal" in value) inputs.set(name, value.literal);
    else if ("state" in value) {
      const input = state.get(value.state);
      inputs.set(name, "field" in value ? panelStateIdentityField(value.field, input as Parameters<typeof panelStateIdentityField>[1]) : input);
    } else inputs.set(name, undefined);
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
  for (const { target } of declaredProjectionAgents(projection)) {
    dependencies.push(agentDependency(target.kind === "id" ? target.id : `preset:${target.agentKind}`));
  }

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
    // A wired field is controlled by its parent even when its value cannot be compiled.
    for (const [key, value] of input) state.set(key, value);
    const dependencies: EntryDependency[] = [{ objectType: "PANEL", objectKey: panelId, verb: "USE" }];
    for (const componentId of Object.values(panel.manifest.components ?? {})) {
      dependencies.push({ objectType: "COMPONENT", objectKey: componentId, verb: "USE" });
    }
    async function include(kind: CurrentProductKind, id: string, inputs: Inputs, field: string) {
      if (kind === "panel") {
        dependencies.push(...await compile(id, inputs, active, field));
        return;
      }
      const projection = await find("projection", id);
      if (!projection) throw new HttpError(404, `${field} references unavailable projection '${id}'`, "PRODUCT_UNAVAILABLE");
      const schema = isBuiltinProductId(id) ? builtinProductProjectionInputSchema : productProjectionInputSchema;
      dependencies.push(...projectionDependencies(id, schema.parse(projection.definition), inputs));
    }
    active.add(panelId);
    // Object detail rules select a separate entry by class. Open-ended usable rules
    // and the application content slot require no statically declared member here.
    for (const { key, target, wiring } of collectReferences(panel, new Map())) {
      const statePlacement = key.startsWith("$state.");
      if (statePlacement && input.has(key.slice("$state.".length))) continue;
      const field = `Panel '${panelId}' manifest ${statePlacement ? key.slice(1) : `members.${key}.target`}`;
      await include(target.kind, target.id, inputValues(wiring.inputs ?? {}, state), field);
    }
    for (const [name, value] of input) {
      if (value == null || panel.manifest.state[name]?.type.kind !== "placement") continue;
      const placement = panelPlacementSchema.parse(value);
      const field = `Panel '${panelId}' bound state.${name}`;
      const inputs = inputValues(placement.inputs ?? {}, state);
      if ("panelId" in placement.target) await include("panel", placement.target.panelId, inputs, field);
      else await include("projection", placement.target.projectionId, inputs, field);
    }
    active.delete(panelId);
    return dependencies;
  }

  return async (panelId: string, bindings: ApplicationPanelInputs = {}) => {
    const inputs = new Map(Object.entries(bindings).map(([name, binding]) => [
      name,
      "literal" in binding ? binding.literal : undefined,
    ]));
    return mergeDependencies(await compile(panelId, inputs, new Set(), `Panel '${panelId}'`));
  };
}
