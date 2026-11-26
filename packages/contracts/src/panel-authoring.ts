import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { dashboardCardRequestSchema } from "./dashboard";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntryFields } from "./panel-conversation-entry";
import { formFieldErrorSchema } from "./form-fields";
import { panelManifestSchema, panelMemberInputSchema, panelMemberOutputRefSchema, panelMemberSchema, panelObjectRefSchema, panelReadOperationInputsSchema, panelStateFieldRefSchema, panelStateRefSchema } from "./panel-manifest";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { directProjectionDataSchema, directProjectionPortsSchema } from "./panel-projection";
import { productCurrentIdParamsSchema } from "./product-record-id";

const stateKey = panelStateRefSchema.shape.state;
const memberKey = panelManifestSchema.innerType().shape.members.keySchema;
const readName = directProjectionDataSchema.shape.read;
const ownerType = panelObjectRefSchema.shape.className;
const literalParameterSchema = z.object({ literal: runtimeJsonValueSchema }).strict();
const outputParameterSchema = z.object({ output: panelMemberOutputRefSchema }).strict();
const authoringParameterSchema = z.union([
  panelStateRefSchema,
  panelStateFieldRefSchema,
  literalParameterSchema,
  outputParameterSchema,
  z.object({ fromSlot: z.literal(true) }).strict(),
]);
const authoringOperationTargetSchema = z.union([
  z.literal("row"),
  stateKey,
  z.object({ row: z.literal(true) }).strict(),
  z.object({ rowField: readName }).strict(),
  panelStateRefSchema,
  z.object({ literal: panelObjectRefSchema }).strict(),
]);
const fieldPath = formFieldErrorSchema.shape.field;
const authoringOperationFormFieldsSchema = z.record(z.string().min(1), fieldPath)
  .refine(fields => Object.keys(fields).length > 0, "Expected at least one form field mapping");
const authoringOperationParamSchema = z.union([
  panelStateRefSchema,
  literalParameterSchema,
  z.object({ input: stateKey }).strict(),
  z.object({ row: z.enum(["primaryKey", "label"]) }).strict(),
  z.object({ rowField: readName }).strict(),
  z.object({ formField: fieldPath }).strict(),
  z.object({ formFields: authoringOperationFormFieldsSchema }).strict(),
]);
const authoringOperationEntrySchema = z.union([
  panelOperationDeclarationSchema.shape.id,
  z.object({
    operation: panelOperationDeclarationSchema.shape.id,
    type: ownerType.optional(),
    target: authoringOperationTargetSchema.optional(),
    params: z.record(readName, authoringOperationParamSchema).optional(),
    draft: memberKey.optional().describe("Form member key in this panel whose draft this operation submits or reads."),
  }).strict(),
]);
const authoringInputBindingSchema = z.union([
  panelMemberInputSchema,
  z.object({ fromSlot: z.literal(true) }).strict(),
]);

const authoringDataSchema = z.union([
  readName,
  z.object({
    read: readName.describe("Read name from the owner's entry in the type table."),
    type: ownerType.optional().describe("Owner type for this datum. Omit to use the member's type or its target state's object type."),
    params: z.record(readName, authoringParameterSchema).optional().describe("Map owner read parameter names to {state: stateName}, {state: stateName, field: primaryKey or objectType}, {literal: value}, {output: {member, name, path?}} for another member's read-only output, or {fromSlot: true}."),
  }).strict(),
]);

function isOfficialComponent(component: string, name: string) {
  return component === name || component === `@ontomato/sdk:${name}`;
}

const inlineMemberSchema = z.object({
  id: productCurrentIdParamsSchema.shape.id.optional().describe("Stable projection ID written by registration or by the offline check for a packaged panel. Keep it when renaming or moving the member."),
  component: z.union([
    z.string().regex(/^[^@\s/:]+$/u, "Expected an SDK component name"),
    directProjectionPortsSchema.shape.componentId,
  ]).describe("Component name from the released SDK catalogue. Use its package-qualified ID if the name is ambiguous."),
  type: ownerType.optional().describe("Default owner type ID from the type table for this member's reads and operations."),
  target: z.union([
    stateKey,
    z.object({ fromSlot: z.literal(true) }).strict(),
  ]).optional().describe("Panel state field holding the target object (or object list), or {fromSlot: true} when supplied by an enclosing Vue slot via <Projection :inputs=\"{ target: ref }\">."),
  data: z.record(readName, authoringDataSchema).optional().describe("Map the component's datum names to owner reads. Use a read name or {read, type?, params?}. Each params value is {state: stateName}, {state: stateName, field: primaryKey or objectType}, {literal: value}, {output: {member, name, path?}} for another member's read-only output, or {fromSlot: true}."),
  operation: panelOperationDeclarationSchema.shape.id.optional().describe("Single operation ID from the owner's entry in the type table."),
  operationParams: z.record(readName, authoringOperationParamSchema).optional().describe("Bind input parameters for `operation` to {literal: value}, {state: fieldName}, {input: portName}, {row: 'primaryKey' | 'label'}, {rowField: fieldKey}, {formField: '/fieldPath'}, or {formFields: {key: '/fieldPath'}}."),
  operations: z.record(readName, authoringOperationEntrySchema).optional().describe("Map local operation names to owner operations (e.g. row actions on ObjectList or multiple actions on ObjectHeader). Each value is an operation ID or {operation, type?, target?, params?, draft?} where target may be 'row', {row: true}, {rowField: key}, a state field name, {state: fieldName}, or {literal: ref}, and draft names a form member in this panel."),
  draft: panelReadOperationInputsSchema.shape.draft.unwrap().shape.slot.optional()
    .describe("Form member key in this panel. Required when the declared read operation takes a draft; optional on a write operation to submit that form member's draft."),
  parameters: panelReadOperationInputsSchema.shape.parameters.optional()
    .describe("Parameters for a draft read operation. Use {state: fieldName}, {formField: {slot, path}}, or {fields: {parameterName: source}}. Defaults to an empty object."),
  bindingId: panelReadOperationInputsSchema.shape.bindingId
    .describe("Optional binding ID for a draft read operation, from {state: fieldName} or {formField: {slot, path}}."),
  state: z.record(stateKey, stateKey).optional().describe("Map typed component port names or owner read parameter names to panel state fields."),
  inputs: z.record(stateKey, authoringInputBindingSchema).optional().describe("Explicit projection input bindings: {state: stateName}, {state: stateName, field: primaryKey or objectType}, {literal: value}, {output: {member, name, path?}}, or {fromSlot: true} when supplied by an enclosing Vue slot."),
  config: runtimeJsonObjectSchema.optional().describe("Component configuration from the released SDK catalogue."),
  agent: z.union([z.literal("page-default"), defaultAgentSchema]).optional().describe('Required for ConversationEntry and AgentChat. Use "page-default", {kind:"id", id}, or {kind:"preset", agentKind}.'),
  prefill: panelConversationEntryFields.shape.prefill.describe("ConversationEntry text placed in the page composer without sending it."),
  prefillKey: panelConversationEntryFields.shape.prefillKey.describe("ConversationEntry opening sentence as a key in this panel's content.messages, read in the reader's language. Use it instead of prefill in a panel shipped to several languages."),
  submit: panelConversationEntryFields.shape.submit.describe("ConversationEntry flag to submit non-empty prefill immediately on a reader click."),
  newSession: panelConversationEntryFields.shape.newSession.describe("ConversationEntry flag to start a fresh conversation session on a reader click."),
  sourceCard: dashboardCardRequestSchema.optional().describe("Optional for MetricChart. Use {dashboardId, cardId} to bind an existing dashboard card through the chart owner, or omit it and bind MetricChart data directly."),
  name: z.string().optional().describe("Projection display name. Defaults to the member name."),
  description: z.string().optional().describe("Projection description. Defaults to the member name."),
}).strict().superRefine((member, ctx) => {
  const issue = (field: string[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: field, message });
  if (isOfficialComponent(member.component, "MetricChart") && member.sourceCard !== undefined) {
    for (const field of ["id", "type", "target", "data", "operation", "operationParams", "operations", "draft", "parameters", "bindingId", "inputs", "config", "agent", "prefill", "prefillKey", "submit", "newSession", "name", "description"] as const) {
      if (member[field] !== undefined) issue([field], "MetricChart takes its projection definition from the source card");
    }
    return;
  }
  if (!isOfficialComponent(member.component, "MetricChart") && member.sourceCard !== undefined) {
    issue(["sourceCard"], "This field is only for MetricChart");
  }

  if (isOfficialComponent(member.component, "ConversationEntry")) {
    if (member.agent === undefined) issue(["agent"], "ConversationEntry needs an agent target");
    if (member.prefill !== undefined && member.prefillKey !== undefined) issue(["prefillKey"], "Write the opening sentence out or name its message key, not both");
    for (const field of ["type", "target", "data", "operation", "operationParams", "operations", "draft", "parameters", "bindingId", "state", "inputs"] as const) {
      if (member[field] !== undefined) issue([field], "ConversationEntry uses only its declared agent and optional prefill");
    }
    return;
  }
  if (isOfficialComponent(member.component, "AgentChat")) {
    if (member.agent === undefined) issue(["agent"], "AgentChat needs an agent target");
    for (const field of ["type", "target", "data", "operation", "operationParams", "operations", "draft", "parameters", "bindingId", "prefill", "prefillKey", "submit", "newSession"] as const) {
      if (member[field] !== undefined) issue([field], "AgentChat uses only its declared agent, optional session state/inputs, and config");
    }
    return;
  }
  for (const field of ["agent", "prefill", "prefillKey", "submit", "newSession"] as const) {
    if (member[field] !== undefined) issue([field], field === "agent" ? "This field is only for ConversationEntry or AgentChat" : "This field is only for ConversationEntry");
  }

  const data = Object.entries(member.data ?? {});
  const hasOperations = member.operation !== undefined || (member.operations !== undefined && Object.keys(member.operations).length > 0);
  const isStaticGroupedGrid = isOfficialComponent(member.component, "GroupedGrid")
    && (Array.isArray(member.config?.items) || member.state?.layout !== undefined || member.inputs?.layout !== undefined);
  if (!data.length && !hasOperations && !isStaticGroupedGrid) {
    issue(["data"], "Declare a named read or an operation");
  }
  if (member.operationParams !== undefined && member.operation === undefined) {
    issue(["operationParams"], "operationParams requires an operation");
  }
  if (member.type === undefined && (member.target === undefined || typeof member.target !== "string")) {
    for (const [name, datum] of data) {
      if (typeof datum === "string" || datum.type === undefined) {
        issue(["data", name], "A datum needs an owner type or a member target state field");
      }
    }
  }
});

/** The authoring tool accepts a short inline member or an existing formal placement. */
export const panelAuthoringMemberSchema = z.union([inlineMemberSchema, panelMemberSchema]);
export type PanelAuthoringMember = z.infer<typeof panelAuthoringMemberSchema>;

/** The tool expands short members before checking the resulting formal manifest and registrations. */
export const panelAuthoringManifestSchema = panelManifestSchema.innerType().extend({
  members: z.record(memberKey, panelAuthoringMemberSchema),
}).strict();
export type PanelAuthoringManifest = z.infer<typeof panelAuthoringManifestSchema>;
