import type { ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
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

export function isCreateFormRead(source: ProductProjectionInput["data"][string]["source"], read: string): boolean {
  if (!("type" in source)) return false;
  if (read === "createForm") return true;
  if (source.type.kind !== "PlatformObjectType") return false;
  const entry = platformObjectTypes[source.type.id as keyof typeof platformObjectTypes];
  const declared = entry?.reads?.[read as keyof typeof entry.reads] as { source?: string; result?: string } | undefined;
  return declared?.source === "type" && declared.result === "panelFormDescription";
}

export function allowsOperationDraft(projection: Pick<ProductProjectionInput, "data">, handler: PanelServerOperation): boolean {
  return handler.kind === "form.save" && handler.create === true && Object.values(projection.data).some(({ source, read }) =>
    isCreateFormRead(source, read) && "type" in source && source.type.kind === "PlatformObjectType" && source.type.id === handler.targetType);
}
