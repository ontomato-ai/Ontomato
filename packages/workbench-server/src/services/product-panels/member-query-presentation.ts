import {
  GENERATE_USER_API_KEY, REGENERATE_USER_API_KEY, REMOVE_USER, RESET_USER_PASSWORD, REVOKE_USER_API_KEY, USER,
} from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { z } from "zod";
import { HttpError } from "../../utils/errors";
import { fixedRowOperationTarget, presentRowOperationsForRows } from "./direct-operations";

const keyOperations = new Set<string>([GENERATE_USER_API_KEY, REGENERATE_USER_API_KEY, REVOKE_USER_API_KEY]);
const refusalFields: Readonly<Record<string, string>> = {
  [REMOVE_USER]: "remove",
  [RESET_USER_PASSWORD]: "resetPassword",
  [GENERATE_USER_API_KEY]: "generateApiKey",
  [REGENERATE_USER_API_KEY]: "regenerateApiKey",
  [REVOKE_USER_API_KEY]: "revokeApiKey",
};

export function memberQueryOperationParams(projection: ProductProjection, inputs: Readonly<Record<string, unknown>>) {
  const fixedRowTargets = new Set<string>();
  let inspectApiKeyRows = false;
  for (const binding of Object.values(projection.operations ?? {})) {
    const { operation, target } = binding;
    if (operation.kind !== "PlatformOperation" || !target || !Object.hasOwn(refusalFields, operation.id)) continue;
    const fixed = "literal" in target || "input" in target ? fixedRowOperationTarget(target, inputs) : undefined;
    if (fixed?.objectType === USER && operation.id !== RESET_USER_PASSWORD) fixedRowTargets.add(fixed.primaryKey);
    if (keyOperations.has(operation.id) && ("row" in target || "rowField" in target || fixed?.objectType === USER))
      inspectApiKeyRows = true;
  }
  return { ...(inspectApiKeyRows && { inspectApiKeyRows }), ...(fixedRowTargets.size && { fixedRowTargets: [...fixedRowTargets] }) };
}

export const memberQueryPayloadSchema = z.object({
  query: z.unknown(),
  rowRefusals: z.record(z.record(z.string().min(1).nullable())),
});

export function presentMemberQueryRowOperations(
  projection: ProductProjection,
  inputs: Readonly<Record<string, unknown>>,
  rows: readonly PanelRecord[],
  rowType: string | undefined,
  refusals: z.infer<typeof memberQueryPayloadSchema>["rowRefusals"],
) {
  return presentRowOperationsForRows(projection, inputs, rows, rowType, (handler, _binding, targets) => {
    const { handlerRef } = handler;
    const reasons = new Map<string, { reason: string }>();
    if (!handler.unavailable && !(handler.effect === "write" && (handler.unavailableBatch || handler.unavailableForInput))) return reasons;
    const field = refusalFields[handlerRef];
    if (!field) throw new HttpError(422, `Operation '${handlerRef}' needs owner row facts`, "PANEL_OPERATION_READ_UNAVAILABLE");
    for (const { target, rowKey } of targets) {
      const reason = refusals[target.primaryKey]?.[field];
      if (reason === undefined)
        throw new HttpError(502, `Member query owner did not provide '${handlerRef}' availability for '${target.primaryKey}'`, "PANEL_READ_OWNER_RESPONSE_INVALID");
      if (reason !== null) reasons.set(rowKey, { reason });
    }
    return reasons;
  });
}
