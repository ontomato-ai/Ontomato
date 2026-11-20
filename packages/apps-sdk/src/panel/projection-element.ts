import type { OntologyElementRef } from "@ontomato/contracts/ontology-element-ref";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import { projectionReadReferences } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";

/*
 * What the SDK reads off a projection record and a member's placement, shared by a panel's frame and the platform's
 * document: the component it draws, the element it is about and the projection a member places.
 */

/** A direct projection's component, as this version's catalogue names it. */
export const memberComponentId = (projection: ProductProjection) => projection.componentId.replace(/^@ontomato\/sdk:/, "");

/** The ontology element a projection is about: what its first datum reads (a type, an operation, an object's type). */
export function projectionElement(projection: ProductProjection): OntologyElementRef {
  const [element] = projectionReadReferences(projection);
  if (!element) throw new Error(`Projection ${projection.id} reads nothing a component can be about`);
  return element;
}

/**
 * The projection a member places. A member placed from the panel's state or the current entry is a later stage's; this
 * release places fixed projections only.
 */
export function memberProjectionId(manifest: PanelManifest, member: string): string {
  const declaration = manifest.members[member];
  if (!declaration) throw new Error(`The panel declares no member '${member}'`);
  if (!("projectionId" in declaration.target))
    throw new Error(`Member '${member}' is not placed as one projection, which is all this SDK release draws`);
  return declaration.target.projectionId;
}
