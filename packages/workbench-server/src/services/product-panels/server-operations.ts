import type { z } from "zod";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { scheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import { HttpError } from "../../utils/errors";

export type PanelOperationTarget = Extract<PanelOperationCall["target"], { kind: "object" }>;
export interface PanelOperationHost {
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
}
interface ServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  targetType: string;
  targetSchema: z.ZodType<PanelOperationTarget>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  targetLabel(host: PanelOperationHost, target: PanelOperationTarget): Promise<string>;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<PanelOperationOutcome>;
}
export type PanelServerOperation = ServerOperation & (
  { kind: "form.save"; draftInput(input: Record<string, unknown>): Record<string, unknown> } |
  { kind: "action" }
);

/** Composition only. Each owner supplies its descriptors; the coordinator resolves no resource-specific rule. */
const registrations: readonly PanelServerOperation[] = scheduledTaskServerOperations;
const operations = new Map(registrations.map(operation => [operation.handlerRef, operation]));
export function panelServerOperation(handlerRef: string): PanelServerOperation {
  const operation = operations.get(handlerRef);
  if (!operation) throw new HttpError(422, "This operation has no server owner client", "OPERATION_UNAVAILABLE");
  return operation;
}
