import { RouterView, type RouteComponent, type RouteRecordRaw } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { startPage } from "./shell";

/**
 * The layout route every page of the platform sits under: one address space, one mounted layout, so switching
 * applications or pages never reloads the document. This is assembly, not page data, hence it lives here and not in the
 * route table.
 *
 * The root lands where `startPage` says (an old launch link's view, the deployment's initial route, else the home), so
 * the platform has one default landing.
 */
export function platformLayoutRoute(children: RouteRecordRaw[], component: RouteComponent = RouterView): RouteRecordRaw {
  return {
    ...platformRoutes.layout,
    component,
    redirect: () => startPage(),
    children: [
      { path: "", name: "PlatformHome", redirect: () => startPage() },
      { ...platformRoutes.home, component: () => import("./pages/PersonalWorkspaceRoute.vue"), meta: { workbench: true } },
      { path: "/applications", component: () => import("./pages/HomeRoute.vue"), meta: { workbench: true } },
      { path: "/products/:productAssetId", component: () => import("./pages/ProductRoute.vue"), props:true, meta: {workbench:true} },
      { path: "/applications/:applicationId", component: () => import("./pages/ApplicationRoute.vue") },
      ...children,
    ],
  };
}
