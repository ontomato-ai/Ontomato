import {
  DELETE_ORG_POSITION, DELETE_PERMISSION_POLICY, DELETE_ROLE, ORG_UNIT, PERMISSION_POLICY, REMOVE_ORG_MEMBERSHIP, ROLE,
  type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import {
  panelObjectListRowActionsSchema, type PanelRecord, type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { z } from "zod";
import { HttpError } from "../../utils/errors";
import { presentRowOperationsForRows } from "./direct-operations";

const removals: Readonly<Record<string, string>> = {
  [`${ROLE}.query`]: DELETE_ROLE,
  [`${PERMISSION_POLICY}.query`]: DELETE_PERMISSION_POLICY,
  [`${ORG_UNIT}.members`]: REMOVE_ORG_MEMBERSHIP,
  [`${ORG_UNIT}.positions`]: DELETE_ORG_POSITION,
};

const rowFacts = z.object({ value: z.unknown(), rowRefusals: z.record(z.string().min(1).nullable()) });

export function prepareGovernanceListRows(
  { typeId, method }: { typeId: string; method: string },
  declaration: PlatformReadDeclaration,
  projection: ProductProjection,
) {
  const removal = removals[`${typeId}.${method}`];
  if (!removal || !projection.operations || projection.config.rowActions === undefined) return;
  const { items } = panelObjectListRowActionsSchema.parse(projection.config.rowActions);
  const names = new Set(items.flatMap(item => item.kind === "operation" ? [item.operation] : []));
  const operations = Object.fromEntries(Object.entries(projection.operations).filter(([name, { operation, target }]) =>
    names.has(name) && operation.kind === "PlatformOperation" && target && "row" in target));
  if (!Object.keys(operations).length) return;
  const inspectRowRemoval = Object.values(operations).some(({ operation }) => operation.id === removal);

  return {
    parameters: inspectRowRemoval ? { inspectRowRemoval } : {},
    unpack(payload: unknown) {
      return inspectRowRemoval ? rowFacts.parse(payload) : { value: payload, rowRefusals: {} };
    },
    present(
      value: unknown, inputs: Readonly<Record<string, unknown>>, rowRefusals: z.infer<typeof rowFacts>["rowRefusals"],
    ) {
      const rows = declaration.result === "panelRecordQuery" ? (value as PanelRecordQuery).rows : value as PanelRecord[];
      return presentRowOperationsForRows(
        { ...projection, operations }, inputs, rows, declaration.rowType ?? typeId,
        (handler, _binding, targets) => {
          const reasons = new Map<string, { reason: string }>();
          if (handler.handlerRef !== removal) {
            if (handler.unavailable || handler.unavailableBatch || handler.unavailableForInput)
              throw new HttpError(422, `Operation '${handler.handlerRef}' needs owner row facts`, "PANEL_OPERATION_READ_UNAVAILABLE");
            return reasons;
          }
          for (const { target, rowKey } of targets) {
            const reason = rowRefusals[target.primaryKey];
            if (reason === undefined)
              throw new HttpError(502, `Governance list owner did not provide '${removal}' availability for '${target.primaryKey}'`,
                "PANEL_READ_OWNER_RESPONSE_INVALID");
            if (reason !== null) reasons.set(rowKey, { reason });
          }
          return reasons;
        },
      );
    },
  };
}
