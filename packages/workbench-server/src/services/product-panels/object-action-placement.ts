import { panelObjectRefSchema, panelPortAccepts, type PanelMember, type PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { OBJECT_ACTION_TARGET, resolveObjectAction } from "../action/object-actions";
import { operationHost } from "./operation-host";
import type { PanelOperationActor } from "./server-operations";

interface ObjectActionPlacement {
  panel: ProductPanel;
  projection: ProductProjection;
  member: PanelMember;
  memberName: string;
  data: DirectProjectionData;
}

function objectIdentity(value: unknown): PanelObjectIdentity {
  const { className, primaryKey } = panelObjectRefSchema.parse(value);
  return { objectType: className, primaryKey };
}

export function resolvePlacedObjectAction(
  actor: PanelOperationActor, placement: ObjectActionPlacement, actionId: string,
  selectedObject: (input: string | undefined) => PanelObjectIdentity | undefined,
) {
  const { panel, projection, member, memberName, data } = placement;
  const parameter = data.params[OBJECT_ACTION_TARGET];
  const pinned = parameter && "literal" in parameter;
  const input = parameter && "input" in parameter ? parameter.input : OBJECT_ACTION_TARGET;
  const binding = member.inputs?.[input];
  const port = projection.inputs[input];
  const message = { operation: actionId, member: memberName, input };
  if (!pinned && !binding)
    throw new HttpError(422, tForLocale(actor.credentials.locale, "panels.operation.targetInputUnbound", message), "PANEL_OPERATION_TARGET_UNBOUND");
  if (!pinned && (port?.kind !== "object" ||
    (binding && "state" in binding && !panelPortAccepts(port, panel.manifest.state[binding.state].type))))
    throw new HttpError(422, "The action needs a compatible object input", "PANEL_OPERATION_TARGET_MISMATCH");

  const fixed = pinned ? objectIdentity(parameter.literal)
    : binding && "literal" in binding && binding.literal !== null ? objectIdentity(binding.literal) : undefined;
  const submitted = selectedObject(pinned ? undefined : input);
  if (fixed && submitted && (fixed.objectType !== submitted.objectType || fixed.primaryKey !== submitted.primaryKey))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  const object = fixed ?? submitted;
  if (!object || (!pinned && binding && "literal" in binding && binding.literal === null))
    throw new HttpError(400, "Select an object before reading or executing its action", "PANEL_SELECTION_REQUIRED");
  if (!pinned && port.kind === "object" && object.objectType !== port.objectType)
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  const { objectType, primaryKey } = object;
  return resolveObjectAction(operationHost(actor), { actionId, object: { objectType, primaryKey } });
}
