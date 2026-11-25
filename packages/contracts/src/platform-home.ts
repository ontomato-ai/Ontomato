import { z } from "zod";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";
import { currentPanelRecordSchema } from "./product-panels";
import { productCurrentIdParamsSchema } from "./product-record-id";

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

/** Ordered selected card IDs per followed dashboard; an absent or empty list displays all cards of that dashboard. */
export const homeDashboardCardsSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).refine(distinct((id) => id), "duplicate card"),
);
export type HomeDashboardCards = z.infer<typeof homeDashboardCardsSchema>;

/** Ordered pinned conversation session IDs (max 20); session titles belong to platform:AgentSession. */
export const homePinnedSessionsSchema = z
  .array(runtimeIdSchema)
  .max(20)
  .refine(distinct((id) => id), "duplicate pinned session");
export type HomePinnedSessions = z.infer<typeof homePinnedSessionsSchema>;

/** Target filter groups supported by platform:Favorite.list. */
export const favoriteTargetGroupSchema = z.enum([
  "all",
  "apps",
  "applications",
  "agents",
  "dashboards",
  "dashboardCards",
  "sessions",
  "objects",
]);
export type FavoriteTargetGroup = z.infer<typeof favoriteTargetGroupSchema>;

export const favoriteMoveDirectionSchema = z.enum(["up", "down"]);
export type FavoriteMoveDirection = z.infer<typeof favoriteMoveDirectionSchema>;

/** One pinned business object shown in the user's favorites, deduplicated by className + primaryKey. */
export const homePinnedObjectSchema = z
  .object({
    className: z.string().min(1).max(200),
    primaryKey: z.string().min(1).max(1000),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type HomePinnedObject = z.infer<typeof homePinnedObjectSchema>;

export const homePinnedObjectsSchema = z
  .object({
    items: z
      .array(homePinnedObjectSchema)
      .max(30)
      .refine(distinct((item) => JSON.stringify([item.className, item.primaryKey])), "duplicate pinned object"),
  })
  .strict();
export type HomePinnedObjects = z.infer<typeof homePinnedObjectsSchema>;

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

/** Null clears the caller's home panel preference for the current domain. */
export const homePanelPreferenceSchema = z.object({
  homePanelId: productCurrentIdParamsSchema.shape.id.nullable(),
}).strict();

/** Null means the caller uses the platform home rather than a chosen panel. */
export const homePanelResponseSchema = z.object({
  panel: currentPanelRecordSchema.nullable(),
}).strict();

export const homeApplicationOpenedSchema = z
  .object({ applicationId: z.string().min(1), lastOpenedAt: runtimeTimestampSchema })
  .strict();
export type HomeApplicationOpened = z.infer<typeof homeApplicationOpenedSchema>;
