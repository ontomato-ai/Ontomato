import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { AssistantSkillView } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { PanelFormTarget, PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { scheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import { agentDefinitionOperations } from "../assistant/definition-operations";
import { m5ServerOperations } from "../metric-function/panel-operations";
import { HttpError } from "../../utils/errors";

export type PanelOperationTarget = PanelFormTarget;
export type SinglePanelOperationOutcome = Exclude<PanelOperationOutcome, { kind: "batch" }>;
export type PanelRecordTarget = Extract<PanelOperationTarget, { kind: "object" }>;
export interface PanelOperationActor {
  owner: AssistantOwner;
  credentials: AssistantCredentials;
}
export interface PanelOperationHost {
  initiator: PanelOperationActor;
  executor: PanelOperationActor;
  skillView: AssistantSkillView;
  requestWorkbench(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
}
interface ServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  effect: "write";
  batch: false;
  targetType: string;
  targetSchema: z.ZodType<PanelOperationTarget>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  resultSchema: z.ZodTypeAny;
  projectResult?(data: Record<string, RuntimeJsonValue>, view: AssistantSkillView): Record<string, RuntimeJsonValue>;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
}
export type PanelServerOperation = ServerOperation & (
  {
    kind: "form.save";
    draftOperation(target: PanelOperationTarget): string;
    draftInput(input: Record<string, unknown>, target: PanelOperationTarget): Record<string, unknown>;
    formInstructions: string;
    create?: {
      draftValues(values: unknown, domainId: string): Record<string, unknown>;
      createdObject(data: unknown): PanelObjectIdentity;
    };
  } |
  { kind: "action"; targetInput: string; targetLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> }
);

/** Each feature branch adds one entry for its owner's descriptor module. The coordinator owns this structure. */
const registrations: readonly PanelServerOperation[] = [
  ...scheduledTaskServerOperations,
  ...agentDefinitionOperations,
  ...m5ServerOperations,
];
const operations = new Map(registrations.map(operation => [operation.handlerRef, operation]));
const jsonSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { effectStrategy: "input" });

export function snapshotPanelWrite(handler: PanelServerOperation, operation: PanelOperation, slot: string) {
  return panelWriteOperationSnapshotSchema.parse({
    id: operation.id, label: operation.label, kind: handler.kind, slot,
    handlerRef: handler.handlerRef, effect: handler.effect, batch: handler.batch,
    target: handler.kind === "form.save" ? { source: "draft", slot } : { source: "input", input: handler.targetInput },
    inputSchema: jsonSchema(handler.inputSchema),
    resultSchema: jsonSchema(handler.resultSchema),
  });
}

export function panelResultProjection(handlerRef: string) {
  return operations.get(handlerRef)?.projectResult;
}

export function panelServerOperation(handlerRef: string): PanelServerOperation {
  const operation = operations.get(handlerRef);
  if (!operation) throw new HttpError(422, "This operation has no server owner client", "OPERATION_UNAVAILABLE");
  return operation;
}
