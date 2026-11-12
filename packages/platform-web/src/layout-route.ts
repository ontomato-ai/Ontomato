import { RouterView, type RouteComponent, type RouteRecordRaw } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/**
 * The layout route every page of the platform sits under: one address space, one mounted layout, so switching
 * applications or pages never reloads the document. This is assembly, not page data, hence it lives here and not in the
 * route table.
 */
export function platformLayoutRoute(children: RouteRecordRaw[], component: RouteComponent = RouterView): RouteRecordRaw {
  return {
    ...platformRoutes.layout,
    component,
    redirect: { name: platformRoutes.personalWorkspace.name },
    children: [{ path: "", name: "PlatformHome", redirect: { name: platformRoutes.personalWorkspace.name } }, { path: "/applications/:applicationId", component: () => import("./pages/ApplicationRoute.vue") }, ...children],
  };
}
