import {
  homeApplicationOpenedSchema,
  homeDashboardsSchema,
  homeFavoritesSchema,
  homeStateSchema,
  type HomeItemRef,
} from "@ontomato/contracts/platform-home";
import { nodeApiGet, nodeApiPost, nodeApiPut } from "@ontomato/workbench-ui";
export const HOME_PREFERENCES_CHANGED='ontomato:home-preferences-changed';

/** The reader's own home state in the current domain: their choices and when they last used each item. */
export async function readHomeState() {
  return homeStateSchema.parse(await nodeApiGet("/platform/home"));
}

/** Replaces the reader's favourites, in their order; the answer is the order the server kept. */
export async function saveFavorites(items: HomeItemRef[]) {
  const saved=homeFavoritesSchema.parse(await nodeApiPut("/platform/home/favorites", { items })).items;
  window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
  return saved;
}

/** Replaces the dashboards the home shows, in tab order. */
export async function saveDashboards(ids: string[]) {
  return homeDashboardsSchema.parse(await nodeApiPut("/platform/home/dashboards", { ids })).ids;
}

/** Records that the reader opened an application now; the time is the server's. */
export async function recordApplicationOpened(applicationId: string) {
  return homeApplicationOpenedSchema.parse(
    await nodeApiPost(`/platform/home/applications/${encodeURIComponent(applicationId)}/open`, {}),
  );
}
