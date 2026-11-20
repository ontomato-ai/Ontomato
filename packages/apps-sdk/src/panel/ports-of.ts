import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { projectionPorts } from "@ontomato/contracts/panel-projection";

/** A projection's ports: what it binds, takes and emits, from its record. */
export function portsOf(projection: ProductProjection) {
  return projectionPorts(projection);
}

/** Whether a projection reads an owner's form (an object's or a new one's): a draft is offered to it. */
export function readsOwnerForm(projection: ProductProjection): boolean {
  return Object.values(projection.data).some((data) => data.read === "form" || data.read === "createForm");
}
