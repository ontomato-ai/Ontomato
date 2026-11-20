import { z } from "zod";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import { panelManifestSchema, panelMemberSchema, panelObjectRefSchema, panelStateRefSchema } from "./panel-manifest";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { directProjectionDataSchema, directProjectionPortsSchema } from "./panel-projection";

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
    params: z.record(readName, authoringParameterSchema).optional().describe("Read parameters from the owner signature, supplied as literal values or panel state field names."),
  }).strict(),
]);

function isOfficialComponent(component: string, name: string) {
  return component === name || component === `@ontomato/sdk:${name}`;
}

const inlineMemberSchema = z.object({
  id: runtimeIdSchema.optional().describe("Projection UUID written by registration. Keep it when renaming or moving the member."),
  component: z.union([
    z.string().regex(/^[^@\s/:]+$/u, "Expected an SDK component name"),
    directProjectionPortsSchema.shape.componentId,
  ]).describe("Component name from the released SDK catalogue. Use its package-qualified ID if the name is ambiguous."),
  type: ownerType.optional().describe("Default owner type ID from the type table for this member's reads and operation."),
  target: stateKey.optional().describe("Panel state field holding the object for an object read or the object or object list targeted by an operation."),
  data: z.record(readName, authoringDataSchema).optional().describe("Map the component's datum names to owner reads. Use a read name or an object with read, optional owner type, and optional params."),
  operation: panelOperationDeclarationSchema.shape.id.optional().describe("Operation ID from the owner's entry in the type table."),
  state: z.record(stateKey, stateKey).optional().describe("Map typed component port names or owner read parameter names to panel state fields."),
  config: runtimeJsonObjectSchema.optional().describe("Component configuration from the released SDK catalogue."),
  agent: z.union([z.literal("page-default"), defaultAgentSchema]).optional().describe("ConversationEntry agent: the current page default, an agent definition ID, or a platform preset."),
  prefill: panelConversationEntrySchema.shape.prefill.describe("ConversationEntry text placed in the page composer without sending it."),
  name: z.string().optional().describe("Projection display name. Defaults to the member name."),
  description: z.string().optional().describe("Projection description. Defaults to the member name."),
}).strict().superRefine((member, ctx) => {
  const issue = (field: string[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: field, message });
  if (isOfficialComponent(member.component, "ConversationEntry")) {
    if (member.agent === undefined) issue(["agent"], "ConversationEntry needs an agent target");
    for (const field of ["type", "target", "data", "operation", "state"] as const) {
      if (member[field] !== undefined) issue([field], "ConversationEntry uses only its declared agent and optional prefill");
    }
    return;
  }
  for (const field of ["agent", "prefill"] as const) {
    if (member[field] !== undefined) issue([field], "This field is only for ConversationEntry");
  }

  const data = Object.entries(member.data ?? {});
  const hasStaticOptions = isOfficialComponent(member.component, "SegmentedControl")
    && Array.isArray(member.config?.options) && member.config.options.length > 0;
  if (!data.length && member.operation === undefined && !hasStaticOptions) {
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
