import type { z } from "zod";
import type { PanelDownloadFile } from "@ontomato/contracts/panel-download";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelFormTarget, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import {
  describePanelOperationFromDeclaration, panelOperationDeclarationSchema, type PanelOperationDeclaration,
  type PanelOperationTargetTypes, type PanelOwnerOperationDescriptor, type PanelReadOperationResult, type PanelReadOperationSectionDeclaration,
  type panelBatchInvocationSchema, type panelOperationImpactSchema, type panelReadOperationCallSchema,
  type panelReadOperationJsonResultSchema, type panelSingleInvocationSchema,
} from "@ontomato/contracts/panel-operations";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { isPlatformFormSaveOperation } from "@ontomato/contracts/platform-object-types";
import type { PanelUploadDeclaration } from "@ontomato/contracts/panel-upload";
import type { AssistantSkillView } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { OntologyElementRef } from "@ontomato/contracts/product-panels";
import { dataAdaptersServerOperations } from "../admin/data-adapters-panel";
import { generalSettingsOperations } from "../admin/general-settings-panel";
import { modelSettingsServerOperations } from "../admin/model-settings-panel";
import { externalMcpServerOperations } from "../mcp/external-mcp-panel";
import { feedbackExportOperation } from "../admin/feedback-panel-reads";
import { m6ServerOperations } from "../action/panel-operations";
import { triggerServerOperations } from "../trigger/panel-operations";
import { workflowServerOperations } from "../workflow/panel-operations";
import { agentDefinitionOperations } from "./agent-definition-operations";
import { m7ServerOperations } from "../business-knowledge/panel-operations";
import { m5ServerOperations } from "../metric-function/panel-operations";
import { objectDetailOperations } from "./object-detail-operations";
import { agentSessionServerOperations } from "./agent-session-panel";
import { favoriteServerOperations } from "./favorite-panel";
import { ontologyModelServerOperations } from "../ontology-model/model-operations";
import { scheduledTaskServerOperations } from "../scheduling/panel-operations";
import { governanceServerOperations } from "../governance/panel-operations";
import { opsDiagnosisServerOperations } from "../ops-diagnosis/panel-operations";
import { applicationBuilderServerOperations } from "../app-builder/application-panel-operations";
import { dashboardServerOperations } from "../dashboard/panel-operations";
import { skillExportOperation, skillServerOperations } from "../skills/panel-operations";
import { productCatalogServerOperations } from "./catalog-operations";
import { HttpError } from "../../utils/errors";
import { cachedZodToJsonSchema, cachedZodToRuntimeJsonSchema, deepFreeze } from "../../utils/zod-json-schema";
import { tForLocale } from "../../i18n";

export type PanelOperationTarget = PanelFormTarget;
export type SinglePanelOperationOutcome = Exclude<PanelOperationOutcome, { kind: "batch" }>;
export type PanelRecordTarget = Extract<PanelOperationTarget, { kind: "object" }>;
export type PanelOperationInvocation = z.infer<typeof panelSingleInvocationSchema> | z.infer<typeof panelBatchInvocationSchema>;
export type PanelBatchCalls = z.infer<typeof panelBatchInvocationSchema>["calls"];
export interface PanelImpactInspector {
  handlerRef: string;
  /**
   * What the calls affect, or null when this call needs no confirmation. A declared file input arrives as the staged
   * `PanelUploadedFile`.
   */
  inspect(host: PanelOperationHost, calls: readonly PanelOperationCall[]): Promise<z.infer<typeof panelOperationImpactSchema> | null>;
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
interface OperationInputDescription {
  secretFields?: readonly string[];
  /** The owner's input schema with presentation annotations in the reader's locale. */
  describeInputSchema?(host: PanelOperationHost, locale?: string):
    PanelOwnerOperationDescriptor["inputSchema"] | Promise<PanelOwnerOperationDescriptor["inputSchema"]>;
}
interface ServerOperation extends OperationInputDescription {
  handlerRef: string;
  binding: OntologyElementRef;
  labelKey?: string;
  effect: "write";
  inspectImpact?: PanelImpactInspector;
  /** The current reader's display reason for the bound target, or null for a targetless operation. */
  unavailable?(host: PanelOperationHost, target: PanelRecordTarget | null): Promise<PanelOwnerOperationDescriptor["unavailable"]>;
  /** Include known operation parameters when the selection alone cannot determine availability. */
  unavailableForInput?(
    host: PanelOperationHost, target: PanelRecordTarget | null, input: Readonly<Record<string, unknown>>,
  ): Promise<PanelOwnerOperationDescriptor["unavailable"]>;
  /** Optional batch availability lookup across a page of list rows to avoid per-row backend requests. */
  unavailableBatch?(
    host: PanelOperationHost,
    targets: readonly { target: PanelRecordTarget; rowKey: string }[],
  ): Promise<ReadonlyMap<string, PanelOwnerOperationDescriptor["unavailable"]>>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  resultSchema: z.ZodTypeAny;
  projectResult?(data: Record<string, RuntimeJsonValue>, view: AssistantSkillView): Record<string, RuntimeJsonValue>;
}
/** The input was checked against `inputSchema`. */
type TargetTypeConstraint =
  | { targetType: string; targetTypes?: undefined }
  | { targetType?: undefined; targetTypes: PanelOperationTargetTypes };
type TargetedExecution = TargetTypeConstraint & {
  targetSchema: z.ZodType<PanelOperationTarget>;
  execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
};
/** A declared upload input holds the staged `PanelUploadedFile`, which is discarded once the call succeeds. */
interface UntargetedExecution {
  targetType?: string;
  targetSchema: z.ZodType<null>;
  execute(host: PanelOperationHost, target: null, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
}
export type PanelWriteServerOperation = ServerOperation & (
  TargetedExecution & {
    kind: "form.save";
    batch: false;
    draftInput(input: Record<string, unknown>, target: PanelOperationTarget): Record<string, unknown>;
    create?: boolean;
  } |
  ({ kind: "action" } & (
    (TargetedExecution & {
      targetInput: string;
      targetLabel(host: PanelOperationHost, target: PanelRecordTarget, input?: Record<string, unknown>): Promise<string>;
      /**
       * The owner's sentence for one call it completed, naming what it acted on by the target's `targetLabel`
       * ("Function “Refund” deleted"), in the host's language. The platform reads the name before the call runs (a delete
       * leaves nothing to read after) and gives the sentence as the success's message, for the reader and an agent.
       */
      done?(host: PanelOperationHost, name: string): string;
      upload?: undefined;
    } & (
      { batch: false } |
      { batch: true; executeBatch(host: PanelOperationHost, calls: readonly PanelBatchCalls[number][], intentId: string): Promise<PanelOperationOutcome> }
    )) |
    UntargetedExecution & {
      /** An action that acts on no selected object, such as creating one from a file. */
      targetInput?: undefined;
      targetLabel?: undefined;
      done?: undefined;
      batch: false;
      /** The input that is a file the person stages before the call. */
      upload?: PanelUploadDeclaration;
    }
  ))
);

type ReadCall = z.infer<typeof panelReadOperationCallSchema>;
type ReadTarget = Extract<PanelOwnerOperationDescriptor["target"], { source: "input" | "none" }> | { source: "draft" };
type ReadResult = z.infer<typeof panelReadOperationJsonResultSchema> | ({ kind: "file" } & PanelDownloadFile);

export interface PanelReadServerOperation extends OperationInputDescription {
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
  describeResultSections?: (host: PanelOperationHost, locale?: string) =>
    Promise<readonly PanelReadOperationSectionDeclaration[] | undefined> | readonly PanelReadOperationSectionDeclaration[] | undefined;
  unavailable?(host: PanelOperationHost, target: PanelRecordTarget | null): Promise<PanelOwnerOperationDescriptor["unavailable"]>;
  execute(host: PanelOperationHost, call: ReadCall): Promise<ReadResult>;
}

export type PanelServerOperation = PanelWriteServerOperation | PanelReadServerOperation;

/** Each feature branch adds one entry for its owner's descriptor module. The coordinator owns this structure. */
const registrations: readonly PanelServerOperation[] = [
  ...scheduledTaskServerOperations,
  ...agentDefinitionOperations,
  ...dataAdaptersServerOperations,
  ...generalSettingsOperations,
  ...modelSettingsServerOperations,
  ...externalMcpServerOperations,
  ...m5ServerOperations,
  ...m6ServerOperations,
  ...triggerServerOperations,
  ...workflowServerOperations,
  ...m7ServerOperations,
  ...skillServerOperations,
  feedbackExportOperation,
  skillExportOperation,
  ...ontologyModelServerOperations,
  ...objectDetailOperations,
  ...favoriteServerOperations,
  ...agentSessionServerOperations,
  ...productCatalogServerOperations,
  ...governanceServerOperations,
  ...opsDiagnosisServerOperations,
  ...dashboardServerOperations,
  ...applicationBuilderServerOperations,
];
const jsonSchema = (schema: z.ZodTypeAny) => cachedZodToJsonSchema(schema, { effectStrategy: "input" });
const runtimeJsonSchema = (schema: z.ZodTypeAny) => cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
const declarationCache = new WeakMap<PanelServerOperation, PanelOperationDeclaration>();
const operations = new Map(registrations.map(operation => {
  requirePanelOperationLabelKey(operation);
  requireDeclaredUploadInput(operation);
  requirePlatformFormSaveAgreement(operation);
  return [operation.handlerRef, operation];
}));

function requirePlatformFormSaveAgreement(handler: PanelServerOperation) {
  if ((handler.kind === "form.save") !== isPlatformFormSaveOperation(handler.handlerRef)) {
    throw new Error(
      `Owner operation '${handler.handlerRef}' has kind '${handler.kind}', which disagrees with platformFormSaveOperations`,
    );
  }
}

function requireDeclaredUploadInput(handler: PanelServerOperation) {
  const upload = panelOperationUpload(handler);
  const properties = upload && (jsonSchema(handler.inputSchema) as { properties?: Record<string, unknown> }).properties;
  if (upload && !properties?.[upload.input])
    throw new Error(`Owner operation '${handler.handlerRef}' declares upload input '${upload.input}' outside its input schema`);
}

/** The declared file input of a write action without a target. */
export function panelOperationUpload(handler: PanelServerOperation) {
  return handler.effect === "write" && handler.kind === "action" ? handler.upload : undefined;
}

export function operationDeclaration(handler: PanelServerOperation): PanelOperationDeclaration {
  const cached = declarationCache.get(handler);
  if (cached) return cached;
  const declaration = deepFreeze(panelOperationDeclarationSchema.parse({
    id: handler.handlerRef,
    kind: handler.kind,
    effect: handler.effect,
    batch: handler.batch,
    target: handler.effect === "read" && handler.target.source !== "draft" ? handler.target
      : handler.kind === "action" && handler.effect === "write"
        ? handler.targetInput === undefined ? { source: "none" } : { source: "input", input: handler.targetInput }
      : { source: "draft" },
    ...("targetTypes" in handler && handler.targetTypes && { targetTypes: handler.targetTypes }),
    inputSchema: jsonSchema(handler.inputSchema),
    ...(handler.secretFields && { secretFields: handler.secretFields }),
    ...(panelOperationUpload(handler) && { upload: panelOperationUpload(handler) }),
  }));
  declarationCache.set(handler, declaration);
  return declaration;
}

export function registeredPanelOperation(id: string) {
  const handler = operations.get(id);
  if (handler) return { handler, declaration: operationDeclaration(handler), targetType: handler.targetType };
}

function requirePanelOperationLabelKey(handler: PanelServerOperation) {
  if (!handler.labelKey?.trim()) throw new Error(`Owner operation '${handler.handlerRef}' must declare a labelKey`);
  return handler.labelKey;
}

export function panelServerOperationLabel(handler: PanelServerOperation, locale?: string): string {
  const key = requirePanelOperationLabelKey(handler);
  const label = tForLocale(locale, key);
  if (!label.trim() || label === key) throw new Error(`Owner operation '${handler.handlerRef}' has no label for '${key}'`);
  return label;
}

export async function describeServerOperation(handler: PanelServerOperation, host: PanelOperationHost, slot?: string,
  target?: PanelOwnerOperationDescriptor["target"],
) {
  return describePanelOperationFromDeclaration(operationDeclaration(handler), {
    label: panelServerOperationLabel(handler, host.locale), slot, target,
    inputSchema: await handler.describeInputSchema?.(host, host.locale),
    resultSchema: runtimeJsonSchema(handler.resultSchema),
    ...(handler.effect === "read" && handler.describeResultSections && {
      resultSections: await handler.describeResultSections(host, host.locale),
    }),
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
