import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PanelDownloadFile } from "@ontomato/contracts/panel-download";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelFormTarget, PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import {
  describePanelOperationFromDeclaration, panelOperationDeclarationSchema, type PanelOwnerOperationDescriptor,
  type PanelReadOperationResult, type panelBatchInvocationSchema,
  type panelOperationImpactSchema, type panelReadOperationCallSchema, type panelReadOperationJsonResultSchema, type panelSingleInvocationSchema,
} from "@ontomato/contracts/panel-operations";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { AssistantSkillView } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { feedbackExportOperation } from "../admin/feedback-panel-reads";
import { m6ServerOperations } from "../action/panel-operations";
import { agentDefinitionOperations } from "../assistant/definition-operations";
import { m7ServerOperations } from "../business-knowledge/panel-operations";
import { m5ServerOperations } from "../metric-function/panel-operations";
import { ontologyModelServerOperations } from "../ontology-model/model-operations";
import { scheduledTaskServerOperations } from "../scheduling/panel-operations";
import { skillExportOperation, skillServerOperations } from "../skills/panel-operations";
import { productCatalogServerOperations } from "./catalog-operations";
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
export interface PanelOperationActor {
  owner: AssistantOwner;
  credentials: AssistantCredentials;
}
export interface PanelOperationHost {
  initiator: PanelOperationActor;
  executor: PanelOperationActor;
  skillView?: AssistantSkillView;
  locale?: string;
  requestWorkbench(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response>;
}
interface ServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  labelKey?: string;
  effect: "write";
  inspectImpact?: PanelImpactInspector;
  targetType: string;
  targetSchema: z.ZodType<PanelOperationTarget>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  resultSchema: z.ZodTypeAny;
  projectResult?(data: Record<string, RuntimeJsonValue>, view: AssistantSkillView): Record<string, RuntimeJsonValue>;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
}
export type PanelWriteServerOperation = ServerOperation & (
  {
    kind: "form.save";
    batch: false;
    draftOperation(target: PanelOperationTarget): string;
    draftInput(input: Record<string, unknown>, target: PanelOperationTarget): Record<string, unknown>;
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
type ReadTarget = Extract<PanelOwnerOperationDescriptor["target"], { source: "draft" | "input" | "none" }>;
type ReadResult = z.infer<typeof panelReadOperationJsonResultSchema> | ({ kind: "file" } & PanelDownloadFile);

export interface PanelReadServerOperation {
  handlerRef: string;
  binding: OntologyElementRef;
  labelKey?: string;
  kind: "action";
  effect: "read";
  batch: false;
  target: ReadTarget;
  targetType?: string;
  targetSchema: z.ZodType<ReadCall["target"]>;
  inputSchema: z.ZodType<ReadCall["input"]>;
  resultSchema: z.ZodType<PanelReadOperationResult>;
  execute(host: PanelOperationHost, call: ReadCall): Promise<ReadResult>;
}

export type PanelServerOperation = PanelWriteServerOperation | PanelReadServerOperation;

/** Each feature branch adds one entry for its owner's descriptor module. The coordinator owns this structure. */
const registrations: readonly PanelServerOperation[] = [
  ...scheduledTaskServerOperations,
  ...agentDefinitionOperations,
  ...m5ServerOperations,
  ...m6ServerOperations,
  ...m7ServerOperations,
  ...skillServerOperations,
  feedbackExportOperation,
  skillExportOperation,
  ...ontologyModelServerOperations,
  ...productCatalogServerOperations,
];
const operations = new Map(registrations.map(operation => [operation.handlerRef, operation]));
const jsonSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { effectStrategy: "input" });

export function operationDeclaration(handler: PanelServerOperation) {
  return panelOperationDeclarationSchema.parse({
    id: handler.handlerRef,
    kind: handler.kind,
    effect: handler.effect,
    batch: handler.batch,
    target: handler.effect === "read" && handler.target.source !== "draft" ? handler.target
      : handler.kind === "action" && handler.effect === "write" ? { source: "input", input: handler.targetInput }
      : { source: "draft" },
    inputSchema: jsonSchema(handler.inputSchema),
  });
}

export function registeredPanelOperation(id: string) {
  const handler = operations.get(id);
  if (handler) return { handler, declaration: operationDeclaration(handler), targetType: handler.targetType };
}

export function describeServerOperation(handler: PanelServerOperation, label: string, slot?: string,
  target?: PanelOwnerOperationDescriptor["target"],
) {
  return describePanelOperationFromDeclaration(operationDeclaration(handler), {
    label, slot, target,
    resultSchema: runtimeJsonObjectSchema.parse(jsonSchema(handler.resultSchema)),
    ...(handler.effect === "write" && handler.inspectImpact && { inspectImpact: { handlerRef: handler.inspectImpact.handlerRef } }),
  });
}

export function panelResultProjection(handlerRef: string) {
  const operation = operations.get(handlerRef);
  if (operation?.effect === "write") return operation.projectResult;
}

export function panelServerOperation(handlerRef: string): PanelServerOperation {
  const operation = operations.get(handlerRef);
  if (!operation) throw new HttpError(422, "This operation has no server owner client", "OPERATION_UNAVAILABLE");
  return operation;
}
