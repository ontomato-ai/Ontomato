import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { RouteRecordRaw } from "vue-router";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import { managerPaths } from "./navigation";

const DATA_BROWSER_PATH = "/browser/data";
const OBJECT_DETAIL_PATH = "/browser/views";

function firstQueryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function objectViewLocation(reference: ObjectReference, returnTo?: string) {
  return panelAddress(OBJECT_DETAIL_PATH, {
    selected: { className: reference.className, primaryKey: reference.primaryKey },
    ...(returnTo ? { returnTo } : {}),
  });
}

function legacyObjectDetailRedirect(to: { params: Record<string, unknown>; query: Record<string, unknown> }) {
  const className = typeof to.params.className === "string" ? to.params.className : "";
  const primaryKey = firstQueryString(to.query.key);
  const returnTo = firstQueryString(to.query.returnTo) || firstQueryString(to.query.from);
  if (className && primaryKey) {
    return objectViewLocation({ className, primaryKey }, returnTo || undefined);
  }
  return returnTo ? panelAddress(OBJECT_DETAIL_PATH, { returnTo }) : OBJECT_DETAIL_PATH;
}

function legacyObjectViewEditorRedirect(to: { params: Record<string, unknown> }) {
  const className = typeof to.params.className === "string" ? to.params.className : "";
  return className ? panelAddress(managerPaths.objects, { selected: className }) : managerPaths.objects;
}

function legacyDataBrowserClassRedirect(to: { params: Record<string, unknown>; query: Record<string, unknown> }) {
  const className = typeof to.params.className === "string" ? to.params.className : "";
  const requestedViewMode = firstQueryString(to.query.viewMode);
  const viewMode = requestedViewMode === "graph" || requestedViewMode === "table" ? requestedViewMode : "table";
  return className ? panelAddress(DATA_BROWSER_PATH, { selectedClass: className, viewMode }) : DATA_BROWSER_PATH;
}

/**
 * Legacy Manager redirect routes: all Manager and Object Browser pages now run as built-in panels, while old deep
 * links continue to forward to their panel addresses.
 */
export function managerRoutes(): RouteRecordRaw[] {
  return [
    { path: "/browser/data/:className", redirect: legacyDataBrowserClassRedirect },
    { path: "/data", redirect: DATA_BROWSER_PATH },
    { path: "/data/:className", redirect: legacyDataBrowserClassRedirect },
    { ...routes.objectView, redirect: legacyObjectDetailRedirect },
    { ...routes.objectViewEditor, redirect: legacyObjectViewEditorRedirect },
    {
      path: "/views/:className",
      redirect: (to) =>
        to.query.edit === "true" ? legacyObjectViewEditorRedirect(to) : legacyObjectDetailRedirect(to),
    },
  ];
}

/** Manager routes that redirect old standalone paths to their unified destinations. */
export function managerStandaloneRoutes(): RouteRecordRaw[] {
  return [
    { path: "/ontology/models", redirect: routes.usage.path },
    { path: "/settings/model-config/ontology", redirect: routes.usage.path },
  ];
}
