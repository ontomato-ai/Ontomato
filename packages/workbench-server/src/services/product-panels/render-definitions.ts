import {
  productPanelSchema, productProjectionSchema, type ProductPanel, type ProductProjection,
} from "@ontomato/contracts/product-panels";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { currentProductRecord, type CurrentProductRow } from "../../infrastructure/product-current";
import { parseStoredDefinition } from "./definition-diagnostics";

type Definition = ProductPanel | ProductProjection;
type Version<T> = { revision: number; createdAt: number; updatedAt: number; record: T; editable?: T };

const panels = new Map<string, Version<ProductPanel>>();
const projections = new Map<string, Version<ProductProjection>>();
type RenderDefinition = Definition | DomainComponentRuntime;
const serialized = new WeakMap<RenderDefinition, string>();
const editableSources = new WeakMap<Definition, Definition>();
const fixedProjections = new WeakMap<ProductPanel["manifest"], readonly string[]>();
const maxDefinitions = 1024;

function readDefinition<T extends Definition>(
  cache: Map<string, Version<T>>, row: CurrentProductRow, editable: boolean, parse: () => T,
): T {
  const key = JSON.stringify([row.domainId, row.id]);
  const { revision } = row;
  const createdAt = row.createdAt.getTime();
  const updatedAt = row.updatedAt.getTime();
  let version = cache.get(key);
  if (!version || version.revision !== revision || version.createdAt !== createdAt || version.updatedAt !== updatedAt) {
    version = { revision, createdAt, updatedAt, record: parse() };
  }
  // Keep the most recently used definitions. Built-ins also follow the deployed
  // row revision when another instance registers a new release in the same database.
  cache.delete(key);
  cache.set(key, version);
  if (cache.size > maxDefinitions) cache.delete(cache.keys().next().value!);
  if (!editable) return version.record;
  if (!version.editable) {
    version.editable = { ...version.record, editable: true };
    editableSources.set(version.editable, version.record);
  }
  return version.editable;
}

export function panelDefinition(row: CurrentProductRow, editable: boolean) {
  return readDefinition(panels, row, editable, () =>
    parseStoredDefinition(productPanelSchema, currentProductRecord(row, false), "Panel"));
}

export function projectionDefinition(row: CurrentProductRow, editable: boolean) {
  return readDefinition(projections, row, editable, () => productProjectionSchema.parse(currentProductRecord(row, false)));
}

export function fixedPanelProjectionIds({ manifest }: Pick<ProductPanel, "manifest">): readonly string[] {
  const cached = fixedProjections.get(manifest);
  if (cached !== undefined) return cached;
  const ids = [...new Set(Object.values(manifest.members).flatMap(({ target }) =>
    "projectionId" in target ? [target.projectionId] : [],
  ))];
  fixedProjections.set(manifest, ids);
  return ids;
}

export function renderDefinitionJson(definition: RenderDefinition) {
  const source = "editable" in definition ? editableSources.get(definition) ?? definition : definition;
  let json = serialized.get(source);
  if (json === undefined) {
    if ("editable" in source) {
      const { editable: _editable, ...fields } = source;
      json = JSON.stringify(fields).slice(0, -1);
    } else {
      json = JSON.stringify(source);
    }
    serialized.set(source, json);
  }
  return "editable" in definition ? `${json},"editable":${definition.editable}}` : json;
}
