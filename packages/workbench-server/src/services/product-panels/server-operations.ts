import type { z } from "zod";
import type { PanelDownloadFile } from "@ontomato/contracts/panel-download";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelFormTarget, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  describePanelOperationFromDeclaration, panelOperationDeclarationSchema, type PanelOperationDeclaration,
  type PanelOperationTargetTypes, type PanelOwnerOperationDescriptor, type PanelReadOperationResult, type PanelReadOperationSectionDeclaration,
  type panelBatchInvocationSchema, type panelOperationImpactSchema, type panelReadOperationCallSchema,
  type panelReadOperationJsonResultSchema, type panelSingleInvocationSchema,
} from "@ontomato/contracts/panel-operations";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { isPlatformFormSaveOperation } from "@ontomato/contracts/platform-object-types";
import type { PanelUploadDeclaration } from "@ontomato/contracts/panel-upload";
import type { JavaPanelReadResult } from "./java-panel-reads";
import type { RegisteredDataReadItem } from "./registered-data-read";
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

/** A record an operation's availability is decided for, or null for an operation without a target. */
export type PanelOperationAvailabilityTarget = PanelRecordTarget | null;
export type PanelOperationRefusal = NonNullable<PanelOwnerOperationDescriptor["unavailable"]>;

/** Who an operation's availability facts are read for. */
export interface PanelOperationFactsContext {
  owner: AssistantOwner;
  credentials: AssistantCredentials;
  locale?: string;
}

/** Java read items and what their results give: the shape a registered data read has too. */
export interface PanelOperationFactsRead<Facts> {
  reads: readonly RegisteredDataReadItem[];
  facts(results: readonly JavaPanelReadResult[]): Facts | Promise<Facts>;
}

/**
 * Whether an operation can act and why not, declared once. The platform reads the facts for the targets a binding
 * gives (fixed, selected, a list input, each row), within the formal page's second read or in one direct read elsewhere,
 * and applies `refuse`, the operation's only copy of the rule.
 */
export interface PanelOperationAvailability<Shared = unknown, Facts = unknown> {
  /** Facts that do not depend on the target, such as a management gate or visibility ranges. */
  shared?: PanelOperationFactsRead<Shared>;
  /**
   * Facts that need Java read items per target, planned for the distinct targets and given one per target in order.
   * The items may be built from Node's own stores, never from page parameters. A row binding on a formal page can only
   * use them through `row` or facts its list carries back, because the rows are unknown when the read is planned.
   */
  read?(targets: readonly PanelOperationAvailabilityTarget[], context: PanelOperationFactsContext):
    PanelOperationFactsRead<readonly Facts[]> | Promise<PanelOperationFactsRead<readonly Facts[]>>;
  /** Facts from Node's own stores alone, one per target in order, for an operation without per-target Java reads. */
  local?(targets: readonly PanelOperationAvailabilityTarget[], context: PanelOperationFactsContext, shared: Shared):
    readonly Facts[] | Promise<readonly Facts[]>;
  /** The same per-target facts as every row of the target's record type already carries them. */
  row?(row: PanelRecord): Facts;
  /** The rule: why the operation cannot act on this target with these bound parameters, or nothing. */
  refuse(input: {
    shared: Shared;
    facts: Facts;
    target: PanelOperationAvailabilityTarget;
    params: Readonly<Record<string, unknown>>;
    locale?: string;
  }): PanelOperationRefusal | undefined;
}

/** An input schema that depends on owner facts: read items plus the schema their results give. */
export interface PanelOperationInputForm {
  reads: readonly RegisteredDataReadItem[];
  schema(results: readonly JavaPanelReadResult[], locale?: string): PanelOwnerOperationDescriptor["inputSchema"];
}
interface OperationInputDescription {
  secretFields?: readonly string[];
  describeLocalInputSchema?(locale?: string): PanelOwnerOperationDescriptor["inputSchema"];
  /** The input schema as owner facts give it; the platform reads them with the operation's availability. */
  inputForm?: PanelOperationInputForm;
}
interface ServerOperation extends OperationInputDescription {
  handlerRef: string;
  binding: OntologyElementRef;
  labelKey?: string;
  effect: "write";
  inspectImpact?: PanelImpactInspector;
  /** Whether the operation can act, in one declaration; absent means always available. */
  availability?: PanelOperationAvailability;
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
  describeResultSections?: (locale?: string) =>
    Promise<readonly PanelReadOperationSectionDeclaration[] | undefined> | readonly PanelReadOperationSectionDeclaration[] | undefined;
  /** Whether the operation can act, in one declaration; absent means always available. */
  availability?: PanelOperationAvailability;
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

export async function describeServerOperation(handler: PanelServerOperation, locale: string | undefined, slot?: string,
  target?: PanelOwnerOperationDescriptor["target"],
  inputSchema?: PanelOwnerOperationDescriptor["inputSchema"],
) {
  if (handler.inputForm && inputSchema === undefined)
    throw new HttpError(422, `Operation '${handler.handlerRef}' needs owner input-schema facts`, "PANEL_OPERATION_READ_UNAVAILABLE");
  return describePanelOperationFromDeclaration(operationDeclaration(handler), {
    label: panelServerOperationLabel(handler, locale), slot, target,
    inputSchema: inputSchema ?? handler.describeLocalInputSchema?.(locale),
    resultSchema: runtimeJsonSchema(handler.resultSchema),
    ...(handler.effect === "read" && handler.describeResultSections && {
      resultSections: await handler.describeResultSections(locale),
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
