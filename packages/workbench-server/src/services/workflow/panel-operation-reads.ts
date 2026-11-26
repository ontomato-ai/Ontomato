import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { WORKFLOW } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { presentRowOperationsForRows } from "../product-panels/direct-operations";
import { workflowLifecycleAction, workflowLifecycleUnavailable } from "./panel-operations";

export function presentWorkflowLifecycleRows(
  projection: ProductProjection, inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[], locale?: string,
) {
  const operations = Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
    operation.kind === "PlatformOperation" && target && "row" in target && workflowLifecycleAction(operation.id)));
  return presentRowOperationsForRows({ ...projection, operations }, inputs, rows, WORKFLOW, (handler, _binding, targets) => {
    const action = workflowLifecycleAction(handler.handlerRef)!;
    const reasons = new Map<string, { reason: string }>();
    for (const { rowKey, row } of targets) {
      const unavailable = workflowLifecycleUnavailable(action, {
        status: row.fields.statusCode as string,
        hasDraft: row.fields.hasDraft as boolean,
      }, locale);
      if (unavailable) reasons.set(rowKey, unavailable);
    }
    return reasons;
  });
}
