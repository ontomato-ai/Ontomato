import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { projectionPorts } from "@ontomato/contracts/panel-projection";
import { memberComponentId } from "./projection-element";

/** A projection's ports: what it binds, takes and emits, from its record. */
export function portsOf(projection: ProductProjection) {
  return projectionPorts(projection);
}

/** Whether a projection reads an owner's form (an object's or a new one's): a draft is offered to it. */
export function readsOwnerForm(projection: ProductProjection): boolean {
  // PanelData projections read form metadata headlessly (e.g. option choices) and never host a form.
  return memberComponentId(projection) !== "PanelData"
    && Object.values(projection.data).some((data) => data.read === "form" || data.read === "createForm");
}
