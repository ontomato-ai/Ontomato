import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { defineComponent, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import { useManagerClient } from "./context";
import {
  legacyProductAssetTarget,
  legacyProductIdFallbackTarget,
  legacyProductIdFromRoute,
  legacyProductsDirectoryTarget,
} from "./legacy-products-redirect";
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
 * Redirect-only route component for retired `/ontology/products` and `/ontology/products/:productId` URLs.
 * Performs pure address location without enforcing legacy menu permissions.
 */
const LegacyProductsRedirectRoute = defineComponent({
  name: "LegacyProductsRedirectRoute",
  setup() {
    const route = useRoute();
    const router = useRouter();
    const client = useManagerClient();
    let generation = 0;
    let disposed = false;

    onBeforeUnmount(() => {
      disposed = true;
      generation += 1;
    });

    async function redirect() {
      const current = ++generation;
      const id = legacyProductIdFromRoute(route.params, route.query);
      if (!id) {
        await router.replace(legacyProductsDirectoryTarget(route.query));
        return;
      }

      let target: string;
      try {
        const asset = await client.products.get(id);
        target = legacyProductAssetTarget(asset);
      } catch {
        target = legacyProductIdFallbackTarget(id, route.query);
      }

      if (disposed || current !== generation) return;
      await router.replace(target);
    }

    watch(
      () => [route.params.productId, route.query.id, route.query.kind, route.query.create, route.query.search],
      () => {
        void redirect();
      },
      { immediate: true },
    );

    return () => null;
  },
});

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
    // Retired legacy product-asset URLs forward purely by location without legacy menu permission gating.
    {
      ...routes.products,
      component: LegacyProductsRedirectRoute,
      beforeEnter: (to) => (legacyProductIdFromRoute(to.params, to.query) ? true : legacyProductsDirectoryTarget(to.query)),
    },
    {
      path: `${routes.products.path}/:productId`,
      component: LegacyProductsRedirectRoute,
    },
  ];
}
