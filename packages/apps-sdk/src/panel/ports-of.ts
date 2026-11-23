import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { projectionPorts } from "@ontomato/contracts/panel-projection";

/** A projection's ports: what it binds, takes and emits, from its record. */
export function portsOf(projection: ProductProjection) {
  return projectionPorts(projection);
}
