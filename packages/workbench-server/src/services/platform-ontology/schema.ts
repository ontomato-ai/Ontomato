/**
 * Platform ontology schema projection for the composite query service.
 *
 * All four-layer platform object types and 27 relation kinds are owned by
 * `@ontomato/contracts/platform-object-types`. This module re-exports them and
 * derives the layered type index used by the composite query service.
 */
import {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
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
  type PlatformRelationKindDeclaration,
} from "@ontomato/contracts/platform-object-types";

export {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
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

export type PlatformOntologyLayer = (typeof platformOntologyLayers)[number];

export const PLATFORM_ONTOLOGY_LAYERS: readonly PlatformOntologyLayer[] = platformOntologyLayers;

export interface PlatformOntologyTypeSpec {
  readonly id: string;
  readonly layer: PlatformOntologyLayer;
  readonly labelKey: string;
}

export type PlatformOntologyRelationKindSpec = PlatformRelationKindDeclaration;

export const PLATFORM_ONTOLOGY_TYPES: readonly PlatformOntologyTypeSpec[] = Object.entries(platformObjectTypes)
  .flatMap(([id, decl]) =>
    decl.layer
      ? [{ id, layer: decl.layer, labelKey: decl.labelKey ?? id }]
      : [],
  );

export const PLATFORM_ONTOLOGY_TYPE_MAP: ReadonlyMap<string, PlatformOntologyTypeSpec> = new Map(
  PLATFORM_ONTOLOGY_TYPES.map((spec) => [spec.id, spec]),
);

export const PLATFORM_ONTOLOGY_RELATION_KINDS: readonly PlatformOntologyRelationKindSpec[] =
  platformRelationKinds;

export function relationTargets(spec: PlatformOntologyRelationKindSpec): readonly string[] {
  return typeof spec.to === "string" ? [spec.to] : spec.to;
}
