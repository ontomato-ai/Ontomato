import type { Component } from "vue";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { componentMeta, componentFor } from "../catalogue-components";
import type { ComponentMetadata } from "../components";

/*
 * The catalogue a panel's projections resolve against at runtime: this SDK version's own, bundled with it. A projection
 * record names a `componentId`; the version's catalogue says which component that is, what it binds, what it takes and
 * the operations it publishes — the same declarations `components.json` and its document are generated from. Nothing is
 * fetched at runtime: a record drawn against a component this version does not have fails here, visibly, instead of
 * drawing something else.
 */

/** The catalogue entry of one component of this version. */
export function metadataOf(componentId: string): ComponentMetadata {
  return componentMeta(componentId);
}

/** The component a projection record draws, fetched if this frame has not drawn it yet. */
export function componentOf(projection: ProductProjection): Promise<Component> {
  return componentFor(projection.componentId);
}
