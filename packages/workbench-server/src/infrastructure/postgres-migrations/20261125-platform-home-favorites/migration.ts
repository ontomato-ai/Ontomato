import { homeDashboardsSchema, homeFavoritesSchema, homeItemRefSchema, type HomeItemRef } from "@ontomato/contracts/platform-home";
import { personalWorkspaceSchema } from "@ontomato/contracts/personal-workspace";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const PLATFORM_HOME_FAVORITES_VERSION = "20261125_platform_home_favorites_v1";
export const PLATFORM_HOME_FAVORITES_NAME = "migrate personal home favorites and dashboards to platform_home_preferences";

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

/**
 * Copies legacy personal workspace favorites and followed dashboards stored in `product_user_overlays`,
 * `product_assets`, and `user_preferences` into `platform_home_preferences` once during startup migration,
 * so reading or updating home favorites never reads or recreates legacy product assets.
 */
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

  const overlays = await client.query<{ domain_id: string; user_id: string; overlay_prefs: unknown; doc_workspace: unknown }>(
    `SELECT h.domain_id, h.user_id, o.preferences AS overlay_prefs, a.document->'workspace' AS doc_workspace
     FROM ${t("product_home")} h
     LEFT JOIN ${t("product_user_overlays")} o
       ON o.domain_id = h.domain_id AND o.principal_id = h.user_id AND o.page_id = h.asset_id
     LEFT JOIN ${t("product_assets")} a
       ON a.domain_id = h.domain_id AND a.id = h.asset_id`,
  );
  for (const row of overlays.rows) {
    const extracted = favoritesFromWorkspace(row.overlay_prefs ?? row.doc_workspace);
    if (!extracted.favorites.length && !extracted.dashboardIds.length) continue;
    const entry = bucketFor(row.domain_id, row.user_id);
    entry.favorites = mergeFavorites(entry.favorites, extracted.favorites);
    entry.dashboardIds = mergeDashboards(entry.dashboardIds, extracted.dashboardIds);
  }

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
    // Legacy overlay takes precedence when it has records; preserve any newer entries already in platform_home_preferences.
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
