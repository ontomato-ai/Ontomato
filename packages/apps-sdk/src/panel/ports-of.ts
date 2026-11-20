import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { projectionPorts } from "@ontomato/contracts/panel-projection";
import { componentMeta } from "../catalogue-components";
import { memberComponentId } from "./projection-element";

/** A projection's ports: what it reads and this release's catalogue entry for the component it draws. */
export function portsOf(projection: ProductProjection) {
  return projectionPorts(projection, componentMeta(memberComponentId(projection)));
}
