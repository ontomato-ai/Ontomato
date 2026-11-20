import { z } from "zod";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { panelManifestSchema, panelMemberSchema, panelObjectRefSchema, panelStateRefSchema } from "./panel-manifest";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { directProjectionDataSchema, directProjectionPortsSchema } from "./panel-projection";

const stateKey = panelStateRefSchema.shape.state;
const memberKey = panelManifestSchema.innerType().shape.members.keySchema;
const readName = directProjectionDataSchema.shape.read;
const authoringParameterSchema = z.union([
  panelStateRefSchema,
  z.object({ literal: runtimeJsonValueSchema }).strict(),
]);

const authoringDataSchema = z.union([
  readName,
  z.object({
    read: readName,
    params: z.record(readName, authoringParameterSchema).optional(),
  }).strict(),
]);

const inlineMemberSchema = z.object({
  /** Written back by the registration tool. Keeping it preserves the ordinary projection's identity. */
  id: runtimeIdSchema.optional(),
  component: z.union([
    z.string().regex(/^[^@\s/:]+$/u, "Expected an SDK component name"),
    directProjectionPortsSchema.shape.componentId,
  ]),
  type: panelObjectRefSchema.shape.className.optional(),
  target: stateKey.optional(),
  data: z.record(readName, authoringDataSchema).optional(),
  operation: panelOperationDeclarationSchema.shape.id.optional(),
  /** Keys name the component's ports or declared read parameters. Values name this panel's state fields. */
  state: z.record(stateKey, stateKey).optional(),
  config: runtimeJsonObjectSchema.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
}).strict().superRefine((member, ctx) => {
  const hasData = Object.keys(member.data ?? {}).length > 0;
  if (!hasData && member.operation === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data"], message: "Declare a named read or an operation" });
  }
  if (hasData && member.type === undefined && member.target === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "A data member needs a type or a target state field" });
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
