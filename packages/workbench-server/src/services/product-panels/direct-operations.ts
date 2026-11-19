import { panelObjectRefSchema, panelOperationId } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, DirectPanel, DirectProjection } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { requireDirectPanelMember } from "./current";
import { panelServerOperation, snapshotPanelWrite } from "./server-operations";

function unavailable(): never {
  throw new HttpError(422, "No supported declared operation has that ID", "OPERATION_UNAVAILABLE");
}

function writeSource(projection: DirectProjection, name: string) {
  if (name === "save" && projection.componentId === "@ontomato/sdk:ObjectForm") {
    for (const data of Object.values(projection.data)) {
      if (data.read !== "form" || !("object" in data.source)) continue;
      const object = data.source.object;
      if ("literal" in object) return { handlerRef: `${object.literal.className}.save`, literal: object.literal };
      const input = projection.inputs[object.input];
      if (input.kind === "object") return { handlerRef: `${input.objectType}.save`, input: object.input };
    }
  }
  if (projection.componentId === "@ontomato/sdk:OperationButton") {
    for (const data of Object.values(projection.data)) {
      if (data.read !== "describe" || !("operation" in data.source)) continue;
      if (data.source.operation.split(".").at(-1) === name) return { handlerRef: data.source.operation };
    }
  }
  return unavailable();
}

export async function declaredDirectOperation(
  owner: ProductOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, panel: DirectPanel, id: string,
) {
  const separator = id.lastIndexOf(".");
  if (separator < 1) return unavailable();
  const slot = id.slice(0, separator), name = id.slice(separator + 1);
  const { member, projection } = await requireDirectPanelMember(owner, credentials, panel, slot);
  const source = writeSource(projection, name);
  const handler = panelServerOperation(source.handlerRef);
  if (handler.effect !== "write") return unavailable();
  const targetInput = handler.kind === "action" ? handler.targetInput : source.input;
  const binding = targetInput === undefined ? undefined : member.inputs?.[targetInput];
  if (targetInput !== undefined) {
    const targetType = projection.inputs[targetInput];
    if (!binding || targetType?.kind !== "object" || targetType.objectType !== handler.targetType) return unavailable();
  }
  const value = source.literal ?? (binding && "literal" in binding ? binding.literal : undefined);
  const object = value === undefined || value === null ? value : panelObjectRefSchema.parse(value);
  const fixedTarget = object ? { kind: "object" as const, objectType: object.className, primaryKey: object.primaryKey } : object;
  const operation = snapshotPanelWrite(handler, {
    id: panelOperationId(slot, name), label: projection.name, kind: handler.kind,
    handlerRef: handler.handlerRef, slot, inputSchema: {},
  }, slot);
  return { effect: "write" as const, use, projection: { id: projection.id, binding: handler.binding }, operation, handler, fixedTarget };
}
