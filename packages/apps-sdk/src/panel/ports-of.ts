import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { projectionPorts } from "@ontomato/contracts/panel-projection";
import { componentMeta } from "../catalogue-components";

export function portsOf(projection: ProductProjection) {
  return projectionPorts(projection, componentMeta(projection.componentId));
}
