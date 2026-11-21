import type { ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";
import type { ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { registeredPanelOperation, type PanelServerOperation } from "./server-operations";

export interface BoundProjectionOperation {
  name: string;
  binding: ProjectionOperationBinding;
  owner: ReturnType<typeof registeredPanelOperation>;
}

export function boundProjectionOperations(projection: Pick<ProductProjectionInput, "operations">): BoundProjectionOperation[] {
  return Object.entries(projection.operations ?? {}).map(([name, binding]) => ({
    name, binding, owner: binding.operation.kind === "PlatformOperation" ? registeredPanelOperation(binding.operation.id) : undefined,
  }));
}

export function allowsOperationDraft(projection: Pick<ProductProjectionInput, "data">, handler: PanelServerOperation): boolean {
  return handler.kind === "form.save" && Boolean(handler.create) && Object.values(projection.data).some(({ source, read }) =>
    read === "createForm" && "type" in source && source.type.kind === "PlatformObjectType" && source.type.id === handler.targetType);
}
