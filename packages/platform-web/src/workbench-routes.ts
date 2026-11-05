import type { RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { observeRoutes } from "./observe-routes";
import PlatformSchedulesPage from "./pages/PlatformSchedulesRoute.vue";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

/** The agent platform's pages: the conversation, its two own pages, its scheduled tasks, and the diagnosis app's root. */
export function workbenchPages(
  component: PageComponent,
  observe: { component: PageComponent; meta?: RouteMeta; props?: Record<string, unknown> },
): RouteRecordRaw[] {
  return [
    ...[routes.chat, routes.agents, routes.dashboards].map((location) => ({
      ...location, component, meta: { workbench: true },
    })),
    // The agent platform's scheduled tasks are a page of the agent platform itself, so the application column stays the
    // conversation's: the workbench renders the platform's list for that entry.
    { ...routes.agentSchedules, component, meta: { workbench: true } },
    { ...observeRoutes.root, ...observe, children: observeRoutes.children },
  ];
}

/** The platform's scheduled tasks: one page for every task of every application. */
export const schedulePages = (): RouteRecordRaw[] => [{ ...routes.schedules, component: PlatformSchedulesPage }];
