import type { RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-admin/routes";
import { observeRoutes } from "./observe-routes";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

export function workbenchPages(
  component: PageComponent,
  observe: { component: PageComponent; meta?: RouteMeta; props?: Record<string, unknown> },
): RouteRecordRaw[] {
  return [
    ...[routes.chat, routes.agents, routes.dashboards, routes.agentTasks].map((location) => ({
      ...location, component, meta: { workbench: true },
    })),
    { ...routes.schedules, redirect: routes.agentTasks.path },
    { ...observeRoutes.root, ...observe, children: observeRoutes.children },
  ];
}
