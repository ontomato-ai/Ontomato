import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { componentMeta } from "../catalogue-components";
import type { ProjectionOperation, ProjectionPorts } from "./ports";

/*
 * A projection record's ports (overall design 3.1, 3.2): what it binds comes from the record, what it takes from the
 * record, and the operations it publishes from this SDK version's catalogue entry for its component. A record bound to a
 * `PlatformOperation` publishes that operation alone, named by the record — which is how "run now" is a button.
 */
export function portsOf(projection: ProductProjection): ProjectionPorts {
  const meta = componentMeta(projection.componentId);
  const declared: ProjectionOperation[] = (meta.operations ?? []).map((operation) => ({
    name: operation.name,
    label: operation.label,
    kind: operation.kind,
    inputSchema: operation.inputSchema,
    handlerRef: `${operation.client}.${operation.name}`,
  }));
  const binding = `${projection.binding.kind}:${projection.binding.id}`;
  if (projection.binding.kind !== "PlatformOperation")
    return { binding, inputs: projection.inputs, operations: declared };
  const bound = declared.find((operation) => operation.handlerRef === projection.binding.id);
  return { binding, inputs: projection.inputs, operations: bound ? [bound] : [] };
}
