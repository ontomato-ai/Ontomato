import {
  homeDashboardCardsSchema,
  homeDashboardsSchema,
  homeFavoritesSchema,
  homeItemRefSchema,
  homePinnedObjectSchema,
  homePinnedObjectsSchema,
  homePinnedSessionsSchema,
  type HomeDashboardCards,
  type HomeItemRef,
  type HomePinnedObject,
} from "@ontomato/contracts/platform-home";
import { personalWorkspaceSchema } from "@ontomato/contracts/personal-workspace";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const PLATFORM_HOME_FAVORITES_VERSION = "20261125_platform_home_favorites_v1";
export const PLATFORM_HOME_FAVORITES_NAME = "migrate personal home favorites and dashboards to platform_home_preferences";
export const PLATFORM_HOME_FAVORITES_V2_VERSION = "20261125_platform_home_favorites_v2";
export const PLATFORM_HOME_FAVORITES_V2_NAME = "migrate legacy dashboard cards, pinned sessions, and pinned objects to platform_home_preferences";

const EXCLUDED_APP_IDS = new Set(["home", "personal-workspace", "workplace", "application-gallery"]);

function mergeFavorites(existing: readonly HomeItemRef[], additions: readonly HomeItemRef[]): HomeItemRef[] {
  const seen = new Set<string>();
  const merged: HomeItemRef[] = [];
  for (const item of [...existing, ...additions]) {
    if (item.kind === "application" && EXCLUDED_APP_IDS.has(item.id)) continue;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeDashboards(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...existing, ...additions]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

function favoritesFromWorkspace(raw: unknown): { favorites: HomeItemRef[]; dashboardIds: string[] } {
  const parsed = personalWorkspaceSchema.safeParse(raw);
  if (!parsed.success) return { favorites: [], dashboardIds: [] };
  const favorites: HomeItemRef[] = [];
  for (const id of parsed.data.applicationIds) {
    if (!EXCLUDED_APP_IDS.has(id)) favorites.push({ kind: "application", id });
  }
  for (const id of parsed.data.agentIds) {
    const candidate = homeItemRefSchema.safeParse({ kind: "agent", id });
    if (candidate.success) favorites.push(candidate.data);
  }
  return { favorites, dashboardIds: parsed.data.dashboardIds };
}

/** Copies favorites and followed dashboards from personal workspace preferences during startup. */
export async function migratePlatformHomeFavorites(client: QueryableClient): Promise<{ migrated: number }> {
  const buckets = new Map<string, { domainId: string; userId: string; favorites: HomeItemRef[]; dashboardIds: string[] }>();
  const bucketFor = (domainId: string, userId: string) => {
    const key = `${domainId}\u0000${userId}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = { domainId, userId, favorites: [], dashboardIds: [] };
      buckets.set(key, entry);
    }
    return entry;
  };

  const legacyPrefs = await client.query<{ user_id: string; key: string; value: unknown }>(
    `SELECT user_id, key, value FROM ${t("user_preferences")}
     WHERE key LIKE 'personal-workspace:%' AND key NOT LIKE '%:recent'`,
  );
  for (const row of legacyPrefs.rows) {
    const domainId = row.key.slice("personal-workspace:".length);
    if (!domainId) continue;
    const extracted = favoritesFromWorkspace(row.value);
    if (!extracted.favorites.length && !extracted.dashboardIds.length) continue;
    const entry = bucketFor(domainId, row.user_id);
    entry.favorites = mergeFavorites(entry.favorites, extracted.favorites);
    entry.dashboardIds = mergeDashboards(entry.dashboardIds, extracted.dashboardIds);
  }

  let migrated = 0;
  for (const entry of buckets.values()) {
    const current = await client.query<{ favorites: unknown; dashboard_ids: unknown }>(
      `SELECT favorites, dashboard_ids FROM ${t("platform_home_preferences")} WHERE domain_id=$1 AND user_id=$2`,
      [entry.domainId, entry.userId],
    );
    const existingFavorites = current.rows[0]
      ? homeFavoritesSchema.shape.items.catch([]).parse(current.rows[0].favorites)
      : [];
    const existingDashboards = current.rows[0]
      ? homeDashboardsSchema.shape.ids.catch([]).parse(current.rows[0].dashboard_ids)
      : [];
    const nextFavorites = mergeFavorites(entry.favorites, existingFavorites);
    const nextDashboards = mergeDashboards(entry.dashboardIds, existingDashboards);
    await client.query(
      `INSERT INTO ${t("platform_home_preferences")} (domain_id, user_id, favorites, dashboard_ids)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       ON CONFLICT (domain_id, user_id) DO UPDATE
       SET favorites = EXCLUDED.favorites, dashboard_ids = EXCLUDED.dashboard_ids`,
      [entry.domainId, entry.userId, JSON.stringify(nextFavorites), JSON.stringify(nextDashboards)],
    );
    migrated += 1;
  }

  return { migrated };
}

function mergeDashboardCards(
  primary: HomeDashboardCards,
  secondary: HomeDashboardCards,
): HomeDashboardCards {
  const merged: HomeDashboardCards = { ...secondary };
  for (const [dashboardId, cardIds] of Object.entries(primary)) {
    const existing = merged[dashboardId] ?? [];
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const id of [...cardIds, ...existing]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      combined.push(id);
    }
    merged[dashboardId] = combined;
  }
  return merged;
}

function mergePinnedSessions(primary: readonly string[], secondary: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...primary, ...secondary]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
    if (merged.length >= 20) break;
  }
  return merged;
}

function mergePinnedObjects(primary: readonly HomePinnedObject[], secondary: readonly HomePinnedObject[]): HomePinnedObject[] {
  const seen = new Set<string>();
  const merged: HomePinnedObject[] = [];
  for (const item of [...primary, ...secondary]) {
    const key = JSON.stringify([item.className, item.primaryKey]);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= 30) break;
  }
  return merged;
}

function workspaceDetailsFromRaw(raw: unknown): {
  dashboardCards: HomeDashboardCards;
  pinnedSessions: string[];
  pinnedObjects: HomePinnedObject[];
} {
  const parsed = personalWorkspaceSchema.safeParse(raw);
  if (!parsed.success) return { dashboardCards: {}, pinnedSessions: [], pinnedObjects: [] };
  const dashboardCards = homeDashboardCardsSchema.catch({}).parse(parsed.data.dashboardCards);
  const pinnedSessions = homePinnedSessionsSchema.catch([]).parse(
    parsed.data.pinnedAnalyses.map(item => item.sessionId),
  );
  const pinnedObjects: HomePinnedObject[] = [];
  for (const item of parsed.data.pinnedObjects) {
    const valid = homePinnedObjectSchema.safeParse(item);
    if (valid.success) pinnedObjects.push(valid.data);
  }
  return { dashboardCards, pinnedSessions, pinnedObjects };
}

/** Copies dashboard cards, pinned sessions, and pinned objects from personal workspace preferences. */
export async function migratePlatformHomeWorkspaceFavoritesV2(client: QueryableClient): Promise<{ migrated: number }> {
  const buckets = new Map<string, {
    domainId: string;
    userId: string;
    dashboardCards: HomeDashboardCards;
    pinnedSessions: string[];
    pinnedObjects: HomePinnedObject[];
  }>();
  const bucketFor = (domainId: string, userId: string) => {
    const key = `${domainId}\u0000${userId}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = { domainId, userId, dashboardCards: {}, pinnedSessions: [], pinnedObjects: [] };
      buckets.set(key, entry);
    }
    return entry;
  };

  const legacyPrefs = await client.query<{ user_id: string; key: string; value: unknown }>(
    `SELECT user_id, key, value FROM ${t("user_preferences")}
     WHERE key LIKE 'personal-workspace:%' AND key NOT LIKE '%:recent'`,
  );
  for (const row of legacyPrefs.rows) {
    const domainId = row.key.slice("personal-workspace:".length);
    if (!domainId) continue;
    const extracted = workspaceDetailsFromRaw(row.value);
    if (!Object.keys(extracted.dashboardCards).length && !extracted.pinnedSessions.length && !extracted.pinnedObjects.length) continue;
    const entry = bucketFor(domainId, row.user_id);
    entry.dashboardCards = mergeDashboardCards(entry.dashboardCards, extracted.dashboardCards);
    entry.pinnedSessions = mergePinnedSessions(entry.pinnedSessions, extracted.pinnedSessions);
    entry.pinnedObjects = mergePinnedObjects(entry.pinnedObjects, extracted.pinnedObjects);
  }

  let migrated = 0;
  for (const entry of buckets.values()) {
    const current = await client.query<{ dashboard_cards: unknown; pinned_sessions: unknown; pinned_objects: unknown }>(
      `SELECT dashboard_cards, pinned_sessions, pinned_objects FROM ${t("platform_home_preferences")} WHERE domain_id=$1 AND user_id=$2`,
      [entry.domainId, entry.userId],
    );
    const existingCards = current.rows[0]
      ? homeDashboardCardsSchema.catch({}).parse(current.rows[0].dashboard_cards ?? {})
      : {};
    const existingSessions = current.rows[0]
      ? homePinnedSessionsSchema.catch([]).parse(current.rows[0].pinned_sessions ?? [])
      : [];
    const existingObjects = current.rows[0]
      ? homePinnedObjectsSchema.shape.items.catch([]).parse(current.rows[0].pinned_objects ?? [])
      : [];
    const nextCards = mergeDashboardCards(existingCards, entry.dashboardCards);
    const nextSessions = mergePinnedSessions(existingSessions, entry.pinnedSessions);
    const nextObjects = mergePinnedObjects(existingObjects, entry.pinnedObjects);
    await client.query(
      `INSERT INTO ${t("platform_home_preferences")} (domain_id, user_id, dashboard_cards, pinned_sessions, pinned_objects)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       ON CONFLICT (domain_id, user_id) DO UPDATE
       SET dashboard_cards = EXCLUDED.dashboard_cards,
           pinned_sessions = EXCLUDED.pinned_sessions,
           pinned_objects = EXCLUDED.pinned_objects`,
      [entry.domainId, entry.userId, JSON.stringify(nextCards), JSON.stringify(nextSessions), JSON.stringify(nextObjects)],
    );
    migrated += 1;
  }

  return { migrated };
}
