/**
 * Platform ontology schema projection for the composite query service.
 *
 * All four-layer platform object types and declared relation kinds are owned by
 * `@ontomato/contracts/platform-object-types`. This module re-exports them and
 * derives the layered type index used by the composite query service.
 */
import type {
  PlatformOntologyLayer,
  PlatformOntologyNodeRef,
  PlatformOntologyType,
} from "@ontomato/contracts/platform-ontology";
import {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  APPLICATION_PANEL_USE,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  ROLE,
  SDK_COMPONENT,
  SKILL,
  TRIGGER,
  USER,
  WORKFLOW,
  platformObjectTypes,
  platformOntologyLayers,
  platformRelationKinds,
  type PlatformReadDeclaration,
  type PlatformRelationKindDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import type { PlatformTypeReadDeclaration } from "@ontomato/contracts/platform-type-table";

export {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  APPLICATION_PANEL_USE,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  ROLE,
  SDK_COMPONENT,
  SKILL,
  TRIGGER,
  USER,
  WORKFLOW,
};

export const PLATFORM_ONTOLOGY_LAYERS: readonly PlatformOntologyLayer[] = platformOntologyLayers;

export const PLATFORM_ONTOLOGY_TYPES: readonly PlatformOntologyType[] = Object.entries(platformObjectTypes)
  .flatMap(([id, decl]) =>
    decl.layer
      ? [{ id, layer: decl.layer, labelKey: decl.labelKey ?? id }]
      : [],
  );

export const PLATFORM_ONTOLOGY_TYPE_MAP: ReadonlyMap<string, PlatformOntologyType> = new Map(
  PLATFORM_ONTOLOGY_TYPES.map((spec) => [spec.id, spec]),
);

function cloneReadDeclarations(
  reads: Readonly<Record<string, PlatformReadDeclaration>>,
): Record<string, PlatformTypeReadDeclaration> {
  return Object.fromEntries(
    Object.entries(reads).map(([name, read]) => [
      name,
      read.parameterMode === "fixed"
        ? {
            source: read.source,
            parameterMode: "fixed",
            params: { ...read.params },
            ...(read.requiredParams ? { requiredParams: [...read.requiredParams] } : {}),
            result: read.result,
          }
        : {
            source: read.source,
            parameterMode: "owner",
            parameter: read.parameter,
            result: read.result,
          },
    ]),
  );
}

let cachedSchemaTypes: readonly PlatformOntologyType[] | undefined;

/**
 * Assembles the full read-only `platform:OntologyType.schema` entries for every layered type:
 * base identity/layer/labelKey, owner-declared public type details (when present), declared
 * named reads from `platformObjectTypes`, and registered owner operation signatures.
 *
 * `server-operations` is imported lazily so importing `schema.ts` or `create-app.ts` does not
 * require `installContentLayout` at module load time.
 */
export async function assemblePlatformOntologySchemaTypes(): Promise<readonly PlatformOntologyType[]> {
  if (cachedSchemaTypes) return cachedSchemaTypes;
  const { registeredPanelOperation } = await import("../product-panels/server-operations");
  cachedSchemaTypes = Object.entries(platformObjectTypes).flatMap(([id, decl]): PlatformOntologyType[] => {
    if (!decl.layer) return [];
    const detail = platformTypeDetails[id];
    const reads = decl.reads && Object.keys(decl.reads).length > 0 ? cloneReadDeclarations(decl.reads) : undefined;
    const operations = decl.operations?.flatMap((operationId) => {
      const registered = registeredPanelOperation(operationId);
      return registered ? [registered.declaration] : [];
    });
    return [{
      id,
      layer: decl.layer,
      labelKey: decl.labelKey ?? id,
      ...(detail
        ? {
            definition: detail.definition,
            properties: detail.properties.map((prop) => ({ ...prop })),
            rules: detail.rules,
          }
        : {}),
      ...(reads ? { reads } : {}),
      ...(operations && operations.length > 0 ? { operations } : {}),
    }];
  });
  return cachedSchemaTypes;
}

export const PLATFORM_ONTOLOGY_RELATION_KINDS: readonly PlatformRelationKindDeclaration[] =
  platformRelationKinds;

export function relationTargets(spec: PlatformRelationKindDeclaration): readonly string[] {
  return typeof spec.to === "string" ? [spec.to] : spec.to;
}

/**
 * Maps each platform operation ID to the platform object type that declares it in `platformObjectTypes`.
 * Operations absent from the type table intentionally have no entry and are never guessed from name prefixes.
 */
export const PLATFORM_OPERATION_OWNER_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries(platformObjectTypes).flatMap(([typeId, decl]) =>
    (decl.operations ?? []).map((operationId) => [operationId, typeId] as const),
  ),
);

/**
 * Resolves the declared four-layer placement of a graph node.
 * For `platform:OntologyType`, the layer comes from the referenced platform type's own declaration.
 */
export function resolveNodeLayer(ref: PlatformOntologyNodeRef): PlatformOntologyLayer | undefined {
  if (ref.className === ONTOLOGY_TYPE) {
    return PLATFORM_ONTOLOGY_TYPE_MAP.get(ref.primaryKey)?.layer;
  }
  return PLATFORM_ONTOLOGY_TYPE_MAP.get(ref.className)?.layer;
}
