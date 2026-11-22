import { z } from "zod";

/** An object reference in panel state. */
export const panelObjectRefSchema = z.object({
  className: z.string().min(1).max(200),
  primaryKey: z.string().min(1).max(1000),
}).strict();
export type PanelObjectRef = z.infer<typeof panelObjectRefSchema>;

/** Stable row identity inside a list: primaryKey for homogeneous lists, or `{className, primaryKey}` for heterogeneous lists. */
export const panelMemberItemKeySchema = z.union([
  panelObjectRefSchema.shape.primaryKey,
  panelObjectRefSchema,
]);
export type PanelMemberItemKey = z.infer<typeof panelMemberItemKeySchema>;
