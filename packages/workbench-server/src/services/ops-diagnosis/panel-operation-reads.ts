import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  AUTOTEST_RUN, DELETE_AUTOTEST_RUN, KEEP_AUTOTEST_RUN, KEEP_TURN_EVIDENCE, TURN_EVIDENCE, UNKEEP_AUTOTEST_RUN, UNKEEP_TURN_EVIDENCE,
} from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { presentRowOperationsForRows } from "../product-panels/direct-operations";
import { autotestRunOperationUnavailable, turnRetentionUnavailable } from "./panel-operations";

export function presentAutotestRunRowOperations(
  projection: ProductProjection, inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[], locale?: string,
) {
  const operations = Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
    operation.kind === "PlatformOperation" && target && "row" in target
    && (operation.id === KEEP_AUTOTEST_RUN || operation.id === UNKEEP_AUTOTEST_RUN || operation.id === DELETE_AUTOTEST_RUN)));
  return presentRowOperationsForRows({ ...projection, operations }, inputs, rows, AUTOTEST_RUN, (handler, _binding, targets) =>
    new Map(targets.map(({ rowKey, row }) => [
      rowKey, autotestRunOperationUnavailable(handler.handlerRef, locale, {
        runId: row.primaryKey, status: row.fields.status as string, kept: row.fields.kept as boolean,
      }),
    ])));
}

export function presentTurnEvidenceRetentionRows(
  projection: ProductProjection, inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[], locale?: string,
) {
  const operations = Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
    operation.kind === "PlatformOperation" && target && "row" in target
    && (operation.id === KEEP_TURN_EVIDENCE || operation.id === UNKEEP_TURN_EVIDENCE)));
  return presentRowOperationsForRows({ ...projection, operations }, inputs, rows, TURN_EVIDENCE, (handler, _binding, targets) =>
    new Map(targets.map(({ rowKey, row }) => [
      rowKey, turnRetentionUnavailable(handler.handlerRef, locale, row.fields.kept as boolean),
    ])));
}
