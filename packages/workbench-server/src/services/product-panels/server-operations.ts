import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelWriteOperationSnapshotSchema, type PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelFormTarget, PanelObjectIdentity, PanelOperation, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import {
  panelReadOperationDescriptorSchema, type PanelReadOperationResult, type panelBatchInvocationSchema,
  type panelOperationImpactSchema, type panelReadOperationCallSchema, type panelSingleInvocationSchema,
} from "@ontomato/contracts/panel-operations";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { m6ServerOperations } from "../action/panel-operations";
import { agentDefinitionOperations } from "../assistant/definition-operations";
import { m5ServerOperations } from "../metric-function/panel-operations";
import { scheduledTaskServerOperations } from "../scheduling/panel-operations";
import { HttpError } from "../../utils/errors";

export type PanelOperationTarget = PanelFormTarget;
export type SinglePanelOperationOutcome = Exclude<PanelOperationOutcome, { kind: "batch" }>;
export type PanelRecordTarget = Extract<PanelOperationTarget, { kind: "object" }>;
export type PanelOperationInvocation = z.infer<typeof panelSingleInvocationSchema> | z.infer<typeof panelBatchInvocationSchema>;
export type PanelBatchCalls = z.infer<typeof panelBatchInvocationSchema>["calls"];
export interface PanelImpactInspector {
  handlerRef: string;
  inspect(host: PanelOperationHost, calls: readonly PanelOperationCall[]): Promise<z.infer<typeof panelOperationImpactSchema>>;
}
export interface PanelOperationHost {
  locale?: string;
  requestWorkbench(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
}
interface ServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  effect: "write";
  inspectImpact?: PanelImpactInspector;
  targetType: string;
  targetSchema: z.ZodType<PanelOperationTarget>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  resultSchema: z.ZodTypeAny;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
}
export type PanelWriteServerOperation = ServerOperation & (
  {
    kind: "form.save";
    batch: false;
    draftOperation(target: PanelOperationTarget): string;
    draftInput(input: Record<string, unknown>): Record<string, unknown>;
    formInstructions: string;
    create?: {
      draftValues(values: unknown, domainId: string): Record<string, unknown>;
      createdObject(data: unknown): PanelObjectIdentity;
    };
  } |
  ({
    kind: "action";
    targetInput: string;
    targetLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string>;
  } & (
    { batch: false } |
    { batch: true; executeBatch(host: PanelOperationHost, calls: readonly PanelBatchCalls[number][], intentId: string): Promise<PanelOperationOutcome> }
  ))
);

type ReadCall = z.infer<typeof panelReadOperationCallSchema>;
export interface PanelReadServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  kind: "action";
  effect: "read";
  batch: false;
  target: { source: "draft"; slot: string };
  targetSchema: z.ZodType<ReadCall["target"]>;
  inputSchema: z.ZodType<ReadCall["input"]>;
  resultSchema: z.ZodType<PanelReadOperationResult>;
  execute(host: PanelOperationHost, call: ReadCall): Promise<PanelReadOperationResult>;
}

export type PanelServerOperation = PanelWriteServerOperation | PanelReadServerOperation;

/** Each feature branch adds one entry for its owner's descriptor module. The coordinator owns this structure. */
const registrations: readonly PanelServerOperation[] = [
  ...scheduledTaskServerOperations,
  ...agentDefinitionOperations,
  ...m5ServerOperations,
  ...m6ServerOperations,
];
const operations = new Map(registrations.map(operation => [operation.handlerRef, operation]));
const jsonSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { effectStrategy: "input" });

export function panelServerOperationSupportsBatch(handlerRef: string): boolean {
  return operations.get(handlerRef)?.batch === true;
}

export function snapshotPanelWrite(handler: PanelWriteServerOperation, operation: PanelOperation, slot: string) {
  return panelWriteOperationSnapshotSchema.parse({
    id: operation.id, label: operation.label, kind: handler.kind, slot,
    handlerRef: handler.handlerRef, effect: handler.effect, batch: handler.batch,
    target: handler.kind === "form.save" ? { source: "draft", slot } : { source: "input", input: handler.targetInput },
    inputSchema: jsonSchema(handler.inputSchema),
    resultSchema: jsonSchema(handler.resultSchema),
    ...(handler.inspectImpact && { inspectImpact: { handlerRef: handler.inspectImpact.handlerRef } }),
  });
}

export function describePanelRead(handler: PanelReadServerOperation, label: string) {
  return panelReadOperationDescriptorSchema.parse({
    handlerRef: handler.handlerRef, label, effect: handler.effect, batch: handler.batch, target: handler.target,
    inputSchema: jsonSchema(handler.inputSchema), resultSchema: jsonSchema(handler.resultSchema),
  });
}

export function panelServerOperation(handlerRef: string): PanelServerOperation {
  const operation = operations.get(handlerRef);
  if (!operation) throw new HttpError(422, "This operation has no server owner client", "OPERATION_UNAVAILABLE");
  return operation;
}
