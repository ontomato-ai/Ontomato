import type { RouteLocationNormalizedLoaded } from "vue-router";
import type { PlatformAppDeclaration } from "./apps";
import { recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";

/** Retain business destinations only, with the minimum parameters needed to resume them. */
export function recentDestination(route: RouteLocationNormalizedLoaded, app: PlatformAppDeclaration | undefined) {
  if (!app || !["/agents/chat", "/dashboards", "/browser/data", "/browser/views", "/app-builder", "/apps"].some(
    prefix => route.path === prefix || route.path.startsWith(`${prefix}/`),
  ) && !app.prefix.startsWith("/applications/")) return null;
  const query = new URLSearchParams();
  for (const key of ["dashboardId", "sessionId", "primaryKey", "key"]) {
    const value = route.query[key];
    if (typeof value === "string") query.set(key, value);
  }
  const suffix = query.toString();
  const parsed = recentWorkInputSchema.safeParse({ appId: app.id, title: app.label, path: `${route.path}${suffix ? `?${suffix}` : ""}` });
  return parsed.success ? parsed.data : null;
}
