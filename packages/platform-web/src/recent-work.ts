import type { RouteLocationNormalizedLoaded } from "vue-router";
import type { PlatformAppDeclaration } from "./apps";
import { recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";

/** Settling window for coalescing transient panel redirects and initial state writes into one recent-visit report. */
export const RECENT_VISIT_SETTLE_MS = 300;

/** Retain business destinations only, with the minimum parameters needed to resume them. */
export function recentDestination(
  route: RouteLocationNormalizedLoaded,
  app: PlatformAppDeclaration | undefined,
  options: { panelApplication?: boolean } = {},
) {
  if (!app) return null;
  // A panel application's bare `/applications/<id>` root redirects immediately to its first entry; skip that transient hop.
  if (options.panelApplication && route.path === app.prefix) return null;
  if (!["/agents/chat", "/dashboards", "/browser/data", "/browser/views", "/app-builder", "/apps"].some(
    prefix => route.path === prefix || route.path.startsWith(`${prefix}/`),
  ) && !app.prefix.startsWith("/applications/")) return null;
  const query = new URLSearchParams();
  for (const key of ["dashboardId", "sessionId", "primaryKey", "key", "selected"]) {
    const value = route.query[key];
    if (typeof value === "string") query.set(key, value);
  }
  const suffix = query.toString();
  const parsed = recentWorkInputSchema.safeParse({ appId: app.id, title: app.label, path: `${route.path}${suffix ? `?${suffix}` : ""}` });
  return parsed.success ? parsed.data : null;
}

/**
 * Coalesces rapid destination changes (such as a panel application landing on its first entry and then writing its
 * default `?selected=...` state) so one opening reports only the final settled destination once.
 */
export function createRecentVisitReporter(
  send: (payload: string) => void,
  settleMs = RECENT_VISIT_SETTLE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastReported: string | null = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(payload: string | null) {
    cancel();
    if (!payload || payload === lastReported) return;
    timer = setTimeout(() => {
      timer = null;
      if (payload === lastReported) return;
      lastReported = payload;
      send(payload);
    }, settleMs);
  }

  return { schedule, cancel };
}
