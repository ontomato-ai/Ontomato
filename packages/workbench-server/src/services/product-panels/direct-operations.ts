import { panelObjectRefSchema, panelOperationId, panelPortAccepts, type PanelState } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, DirectProjection, ProductPanel, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { requireDirectPanelMember } from "./current";
import { panelServerOperation, snapshotPanelWrite } from "./server-operations";

function unavailable(): never {
  throw new HttpError(422, "No supported declared operation has that ID", "OPERATION_UNAVAILABLE");
}

interface DirectWriteSource {
  name: string;
  handlerRef: string;
  input?: string;
  literal?: ReturnType<typeof panelObjectRefSchema.parse>;
  create?: true;
}

function* operationSources(projection: ProductProjectionInput): Generator<DirectWriteSource> {
  if (projection.componentId === "@ontomato/sdk:ObjectForm") {
    for (const data of Object.values(projection.data)) {
      if (data.read !== "form" || !("object" in data.source)) continue;
      const object = data.source.object;
      if ("literal" in object) {
        yield { name: "save", handlerRef: `${object.literal.className}.save`, literal: object.literal };
        return;
      }
      const input = projection.inputs[object.input];
      if (input.kind === "object") {
        yield { name: "save", handlerRef: `${input.objectType}.save`, input: object.input };
        return;
      }
    }
    for (const data of Object.values(projection.data)) {
      if (data.read === "createForm" && "type" in data.source && data.source.type.kind === "PlatformObjectType") {
        yield { name: "save", handlerRef: `${data.source.type.id}.save`, create: true };
        return;
      }
    }
  }
  if (projection.componentId === "@ontomato/sdk:OperationButton") {
    for (const data of Object.values(projection.data)) {
      if (data.read !== "describe" || !("operation" in data.source) || data.source.operation.kind !== "PlatformOperation") continue;
      const handlerRef = data.source.operation.id;
      yield { name: handlerRef.split(".").at(-1)!, handlerRef };
    }
  }
}

function describeOperation(projection: ProductProjectionInput, slot: string, source: DirectWriteSource) {
  const handler = panelServerOperation(source.handlerRef);
  if (handler.effect === "read") return { handler, operation: null };
  const operation = snapshotPanelWrite(handler, {
    id: panelOperationId(slot, source.name), label: projection.name, kind: handler.kind,
    handlerRef: handler.handlerRef, slot, inputSchema: {},
  }, slot);
  return { handler, operation };
}

export function directProjectionWriteDescriptions(projection: ProductProjectionInput, slot: string) {
  return [...operationSources(projection)].flatMap(source => {
    const { operation } = describeOperation(projection, slot, source);
    return operation ? [operation] : [];
  });
}

function declaredDirectProjectionOperation(
  use: ApplicationPanelUse, projection: DirectProjection, inputs: ProductPanel["manifest"]["members"][string]["inputs"],
  state: PanelState, slot: string, id: string, locale?: string,
) {
  if (!id.startsWith(`${slot}.`)) return;
  const name = id.slice(slot.length + 1);
  const source = [...operationSources(projection)].find(source => source.name === name);
  if (!source) return;
  const { handler, operation } = describeOperation(projection, slot, source);
  if (handler.effect === "read") return { effect: "read" as const, handler, label: projection.name };
  const targetInput = handler.kind === "action" ? handler.targetInput : source.input;
  const binding = targetInput === undefined ? undefined : inputs?.[targetInput];
  if (targetInput !== undefined) {
    const targetType = projection.inputs[targetInput];
    const message = { operation: handler.handlerRef, input: targetInput, member: slot, objectType: handler.targetType };
    if (!binding)
      throw new HttpError(422, tForLocale(locale, "panels.operation.targetInputUnbound", message), "PANEL_OPERATION_TARGET_UNBOUND");
    if (targetType?.kind !== "object" || targetType.objectType !== handler.targetType
      || ("state" in binding && !panelPortAccepts(targetType, state[binding.state].type)))
      throw new HttpError(422, tForLocale(locale, "panels.operation.targetInputMismatch", message), "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const value = source.literal ?? (binding && "literal" in binding ? binding.literal : undefined);
  const object = value === undefined || value === null ? value : panelObjectRefSchema.parse(value);
  const fixedTarget = source.create ? { kind: "draft" as const }
    : object ? { kind: "object" as const, objectType: object.className, primaryKey: object.primaryKey } : object;
  return { effect: "write" as const, use, projection: { id: projection.id, binding: handler.binding }, operation: operation!, handler, fixedTarget };
}

export async function declaredDirectOperation(
  owner: ProductOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, panel: ProductPanel, id: string,
) {
  const separator = id.lastIndexOf(".");
  if (separator < 1) return unavailable();
  const slot = id.slice(0, separator);
  const { member, projection } = await requireDirectPanelMember(owner, credentials, panel, slot);
  const current = declaredDirectProjectionOperation(use, projection, member.inputs, panel.manifest.state, slot, id, credentials.locale) ?? unavailable();
  if (current.effect === "read" && !Object.hasOwn(panel.manifest.members, current.handler.target.slot)) return unavailable();
  return current;
}
