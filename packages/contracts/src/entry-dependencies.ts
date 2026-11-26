import { z } from "zod";
import { applicationPanelInputsSchema } from "./product-panels";

const id = z.string().min(1);
const eventSequence = z.string().regex(/^(0|[1-9][0-9]*)$/);

const dependencyScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all"), className: z.null().optional(), field: z.null().optional() }).strict(),
  z.object({
    kind: z.enum(["self_organization", "self_subtree", "self_descendants", "initiated_by_self", "assigned_to_self"]),
    className: id,
    field: id,
  }).strict(),
]);

export const entryDependencySchema = z.object({
  objectType: z.enum(["PANEL", "PROJECTION", "COMPONENT", "AGENT", "ACTION", "METRIC", "READ_FUNCTION", "WORKFLOW"]),
  objectKey: id,
  verb: z.enum(["USE", "VIEW", "EXECUTE"]),
  scope: dependencyScopeSchema.optional(),
});
export type EntryDependency = z.infer<typeof entryDependencySchema>;

const boundPanelRootSchema = z.object({
  panelId: id,
  inputs: applicationPanelInputsSchema,
  alsoUnbound: z.boolean(),
}).strict();
export type BoundPanelRoot = z.infer<typeof boundPanelRootSchema>;

export const entryRootsSchema = z.object({
  panelIds: z.array(id),
  agentIds: z.array(id),
  boundPanelRoot: boundPanelRootSchema.nullish(),
});
export type EntryRoots = z.infer<typeof entryRootsSchema>;

export interface ReadAffectedEntryRootsRequest {
  domainId: string;
  panelIds: string[];
}
export const affectedEntryRootsSchema = z.array(z.object({ entryId: id, roots: entryRootsSchema }));

export const entryDependencyChangeRequestSchema = z.object({
  domainId: id,
  source: z.object({
    kind: z.enum(["panel", "application", "object-detail"]),
    sequence: eventSequence.refine(value => value !== "0"),
    actorId: id,
  }),
  entries: z.array(z.object({ entryId: id, before: z.array(entryDependencySchema), after: z.array(entryDependencySchema) })),
});
export type EntryDependencyChangeRequest = z.infer<typeof entryDependencyChangeRequestSchema>;

export const applicationEntryRootsChangedSchema = z.object({
  type: z.literal("application.entry-roots.changed"),
  sequence: eventSequence,
  occurredAt: z.string().datetime(),
  domainId: id,
  actorId: id,
  entryId: id,
  before: entryRootsSchema,
  after: entryRootsSchema,
});
export type ApplicationEntryRootsChanged = z.infer<typeof applicationEntryRootsChangedSchema>;
