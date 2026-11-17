import type { Component } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/**
 * A page that may open beside the conversation, addressed by its page key: the platform knows the three pilots and no
 * more (DESIGN.md "Applications and shells"). Each resolver maps the address to the props the page's own component
 * takes, so the page keeps one component, one editor controller and one address; the page beside the conversation is
 * that same page, not a second, smaller version of it.
 *
 * A page is registered by the assembly that mounts it. The shell does not import an application's routes, and an
 * application's page does not import another application's.
 */
export interface PageResolver {
  pageKey: string;
  /** The application's own address, whose first pages open beside the conversation. */
  prefix: string;
  /** Whether this address is a page of this resolver. */
  matches(route: RouteLocationNormalizedLoaded): boolean;
  /** The page's component and its props for this address. */
  props(route: RouteLocationNormalizedLoaded): Record<string, unknown>;
  /** Enlarged, the page opens at its own address in the application. */
  component: () => Promise<Component>;
}

/**
 * The pilots the platform mounts beside the conversation. The dashboards and the knowledge report are registered by
 * their own lines; the agent settings are the workbench's, which mounts the page in its own conversation application.
 */
export const pageResolvers: readonly PageResolver[] = [
  {
    pageKey: "dashboards",
    prefix: platformRoutes.dashboards.path,
    matches: (route) => route.path === platformRoutes.dashboards.path,
    props: (route) => ({
      dashboardId: typeof route.query.dashboardId === "string" ? route.query.dashboardId : undefined,
    }),
    component: () => import("./pages/DashboardsRoute.vue"),
  },
];

/** The resolver of an address, when the address belongs to a page that may open beside the conversation. */
export function pageResolver(path: string): PageResolver | null {
  return pageResolvers.find((resolver) => path === resolver.prefix || path.startsWith(`${resolver.prefix}/`)) ?? null;
}
