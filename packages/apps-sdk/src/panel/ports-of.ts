import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { componentMeta } from "../catalogue-components";
import type { ProjectionOperation, ProjectionPorts } from "./ports";

/*
 * A projection record's ports (overall design 3.1, 3.2): what it binds comes from the record, what it takes from the
 * record, and the operations it publishes from this SDK version's catalogue entry for its component.
 *
 * A record bound to a `PlatformOperation` publishes that operation, which is how "run now" is a button: the binding names
 * the operation, its label comes from the catalogue when a component declares it, and its handler is the reference the
 * binding is. Nothing here is written by a panel.
 */
export function portsOf(projection: ProductProjection): ProjectionPorts {
  const binding = `${projection.binding.kind}:${projection.binding.id}`;
  if (projection.binding.kind === "PlatformOperation")
    return { binding, inputs: projection.inputs, operations: [boundOperation(projection)] };
  const meta = componentMeta(projection.componentId);
  // A component that saves through the owner of the type it binds names `@binding`; every other operation names its own
  // client. Either way the reference is one this version registered.
  const client = (name: string) => (name === "@binding" ? projection.binding.id : name);
  const declared: ProjectionOperation[] = (meta.operations ?? []).map((operation) => ({
    name: operation.name,
    label: operation.label,
    kind: operation.kind,
    inputSchema: operation.inputSchema,
    handlerRef: `${client(operation.client)}.${operation.name}`,
  }));
  return { binding, inputs: projection.inputs, operations: declared };
}

/** The one operation a record bound to a platform operation publishes: the operation the record names. */
function boundOperation(projection: ProductProjection): ProjectionOperation {
  const ref = projection.binding.id;
  const declared = componentMeta(projection.componentId).operations?.find(
    (operation) => `${operation.client}.${operation.name}` === ref,
  );
  return {
    name: ref.split(".").pop()!,
    // A component that declares the operation names it; otherwise the projection's own name is what a reader sees on the
    // button, because that is the word its author gave it.
    label: declared?.label ?? projection.name,
    kind: declared?.kind ?? "action",
    inputSchema: declared?.inputSchema ?? {},
    handlerRef: ref,
  };
}
