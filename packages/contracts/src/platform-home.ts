import { z } from "zod";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";

/**
 * The platform home's personal state: what a user pinned, which of their dashboards the home shows, when they last
 * opened each application, and their latest conversations. These are references only; names, entries and access always come from the
 * application catalog and the agent list, and a reference the reader can no longer open is simply not shown.
 */
export const homeItemRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("application"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("agent"), id: runtimeIdSchema }).strict(),
]);
export type HomeItemRef = z.infer<typeof homeItemRefSchema>;

const distinct = <T>(key: (item: T) => string) => (items: T[]) => new Set(items.map(key)).size === items.length;

/** The pinned items in the user's order; the array position is the order. */
export const homeFavoritesSchema = z
  .object({ items: z.array(homeItemRefSchema).refine(distinct((item) => `${item.kind}:${item.id}`), "duplicate item") })
  .strict();
export type HomeFavorites = z.infer<typeof homeFavoritesSchema>;

/** The dashboards shown on the home, in tab order. */
export const homeDashboardsSchema = z
  .object({ ids: z.array(z.string().min(1)).refine(distinct((id) => id), "duplicate dashboard") })
  .strict();
export type HomeDashboards = z.infer<typeof homeDashboardsSchema>;

export const homeStateSchema = z
  .object({
    favorites: homeFavoritesSchema.shape.items,
    dashboardIds: homeDashboardsSchema.shape.ids,
    /** One row per application: the last time its entry was opened. */
    recentApplications: z.array(z.object({ applicationId: z.string().min(1), lastOpenedAt: runtimeTimestampSchema }).strict()),
    /**
     * The user's own latest conversations, newest first and at most six: ones they started themselves (scheduled runs do
     * not count) and that have run at least once. The title is empty until the conversation has one.
     */
    recentConversations: z.array(
      z.object({ sessionId: runtimeIdSchema, agentId: runtimeIdSchema, title: z.string(), updatedAt: runtimeTimestampSchema }).strict(),
    ),
  })
  .strict();
export type HomeState = z.infer<typeof homeStateSchema>;

export const homeApplicationOpenedSchema = z
  .object({ applicationId: z.string().min(1), lastOpenedAt: runtimeTimestampSchema })
  .strict();
export type HomeApplicationOpened = z.infer<typeof homeApplicationOpenedSchema>;
