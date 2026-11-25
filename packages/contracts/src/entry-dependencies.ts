import { z } from "zod";

const id = z.string().min(1);

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

export const entryRootsSchema = z.object({ panelIds: z.array(id), agentIds: z.array(id) });
export type EntryRoots = z.infer<typeof entryRootsSchema>;

export interface ReadAffectedEntryRootsRequest {
  domainId: string;
  panelIds: string[];
}
export const affectedEntryRootsSchema = z.array(z.object({ entryId: id, roots: entryRootsSchema }));

export interface EntryDependencyChangeRequest {
  domainId: string;
  source: { kind: "panel" | "application" | "object-detail"; id: string; actorId: string };
  entries: { entryId: string; before: EntryDependency[]; after: EntryDependency[] }[];
}

export const applicationEntryRootsChangedSchema = z.object({
  type: z.literal("application.entry-roots.changed"),
  sequence: z.string().regex(/^(0|[1-9][0-9]*)$/),
  occurredAt: z.string().datetime(),
  domainId: id,
  actorId: id,
  entryId: id,
  before: entryRootsSchema,
  after: entryRootsSchema,
});
export type ApplicationEntryRootsChanged = z.infer<typeof applicationEntryRootsChangedSchema>;
