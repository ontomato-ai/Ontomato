import type { z } from "zod";
import type { PanelFormTarget, PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { scheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import { agentDefinitionOperations } from "../assistant/definition-operations";
import { HttpError } from "../../utils/errors";

export type PanelOperationTarget = PanelFormTarget;
export type PanelRecordTarget = Extract<PanelOperationTarget, { kind: "object" }>;
export interface PanelOperationHost {
  requestWorkbench(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
}
interface ServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  targetType: string;
  targetSchema: z.ZodType<PanelOperationTarget>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<PanelOperationOutcome>;
}
export type PanelServerOperation = ServerOperation & (
  {
    kind: "form.save";
    draftOperation(target: PanelOperationTarget): string;
    draftInput(input: Record<string, unknown>): Record<string, unknown>;
    formInstructions: string;
    create?: {
      draftValues(values: unknown, domainId: string): Record<string, unknown>;
      createdObject(data: unknown): PanelObjectIdentity;
    };
  } |
  { kind: "action"; targetLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> }
);

/** Each feature branch adds one entry for its owner's descriptor module. The coordinator owns this structure. */
const registrations: readonly PanelServerOperation[] = [
  ...scheduledTaskServerOperations,
  ...agentDefinitionOperations,
];
const operations = new Map(registrations.map(operation => [operation.handlerRef, operation]));
export function panelServerOperation(handlerRef: string): PanelServerOperation {
  const operation = operations.get(handlerRef);
  if (!operation) throw new HttpError(422, "This operation has no server owner client", "OPERATION_UNAVAILABLE");
  return operation;
}
