import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { dashboardCardRequestSchema } from "./dashboard";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntryFields } from "./panel-conversation-entry";
import { panelManifestSchema, panelMemberSchema, panelObjectRefSchema, panelStateRefSchema } from "./panel-manifest";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { directProjectionDataSchema, directProjectionPortsSchema } from "./panel-projection";
import { productCurrentIdParamsSchema } from "./product-record-id";

const stateKey = panelStateRefSchema.shape.state;
const memberKey = panelManifestSchema.innerType().shape.members.keySchema;
const readName = directProjectionDataSchema.shape.read;
const ownerType = panelObjectRefSchema.shape.className;
const authoringParameterSchema = z.union([
  panelStateRefSchema,
  z.object({ literal: runtimeJsonValueSchema }).strict(),
]);

const authoringDataSchema = z.union([
  readName,
  z.object({
    read: readName.describe("Read name from the owner's entry in the type table."),
    type: ownerType.optional().describe("Owner type for this datum. Omit to use the member's type or its target state's object type."),
    params: z.record(readName, authoringParameterSchema).optional().describe("Map owner read parameter names to {state: fieldName} or {literal: value}."),
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
  type: ownerType.optional().describe("Default owner type ID from the type table for this member's reads and operation."),
  target: stateKey.optional().describe("Panel state field holding the object for an object read or the object or object list targeted by an operation."),
  data: z.record(readName, authoringDataSchema).optional().describe("Map the component's datum names to owner reads. Use a read name or {read, type?, params?}. Each params value is {state: fieldName} or {literal: value}."),
  operation: panelOperationDeclarationSchema.shape.id.optional().describe("Operation ID from the owner's entry in the type table."),
  state: z.record(stateKey, stateKey).optional().describe("Map typed component port names or owner read parameter names to panel state fields."),
  config: runtimeJsonObjectSchema.optional().describe("Component configuration from the released SDK catalogue."),
  agent: z.union([z.literal("page-default"), defaultAgentSchema]).optional().describe('Required for ConversationEntry. Use "page-default", {kind:"id", id}, or {kind:"preset", agentKind}.'),
  prefill: panelConversationEntryFields.shape.prefill.describe("ConversationEntry text placed in the page composer without sending it."),
  prefillKey: panelConversationEntryFields.shape.prefillKey.describe("ConversationEntry opening sentence as a key in this panel's content.messages, read in the reader's language. Use it instead of prefill in a panel shipped to several languages."),
  sourceCard: dashboardCardRequestSchema.optional().describe("Required for MetricChart. Use {dashboardId, cardId}; the source owner registers the chart and assigns its projection ID."),
  name: z.string().optional().describe("Projection display name. Defaults to the member name."),
  description: z.string().optional().describe("Projection description. Defaults to the member name."),
}).strict().superRefine((member, ctx) => {
  const issue = (field: string[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: field, message });
  if (isOfficialComponent(member.component, "MetricChart")) {
    if (member.sourceCard === undefined) issue(["sourceCard"], "MetricChart needs a source card");
    for (const field of ["id", "type", "target", "data", "operation", "config", "agent", "prefill", "prefillKey", "name", "description"] as const) {
      if (member[field] !== undefined) issue([field], "MetricChart takes its projection definition from the source card");
    }
    return;
  }
  if (member.sourceCard !== undefined) issue(["sourceCard"], "This field is only for MetricChart");

  if (isOfficialComponent(member.component, "ConversationEntry")) {
    if (member.agent === undefined) issue(["agent"], "ConversationEntry needs an agent target");
    if (member.prefill !== undefined && member.prefillKey !== undefined) issue(["prefillKey"], "Write the opening sentence out or name its message key, not both");
    for (const field of ["type", "target", "data", "operation", "state"] as const) {
      if (member[field] !== undefined) issue([field], "ConversationEntry uses only its declared agent and optional prefill");
    }
    return;
  }
  for (const field of ["agent", "prefill", "prefillKey"] as const) {
    if (member[field] !== undefined) issue([field], "This field is only for ConversationEntry");
  }

  const data = Object.entries(member.data ?? {});
  if (!data.length && member.operation === undefined) {
    issue(["data"], "Declare a named read or an operation");
  }
  if (member.type === undefined && member.target === undefined) {
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
});
export type PanelAuthoringManifest = z.infer<typeof panelAuthoringManifestSchema>;
