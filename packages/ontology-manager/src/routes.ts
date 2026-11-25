import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { defineAsyncComponent, defineComponent, h, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import ManagerFrame from "./ManagerFrame.vue";
import { useManagerClient } from "./context";
import {
  legacyProductAssetTarget,
  legacyProductIdFallbackTarget,
  legacyProductIdFromRoute,
  legacyProductsDirectoryTarget,
} from "./legacy-products-redirect";
import { managerPaths } from "./navigation";

/*
 * Heavy pages load when first entered, so their graph, chart and Markdown libraries stay out of the entry script:
 * visual modeling brings AntV G6/X6 and data browsing loads G6 only for its graph view.
 */
const DataBrowser = defineAsyncComponent(() => import("./data-browser/DataBrowser.vue"));

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

/** Where the data browser last was, kept per router so that the navigation entry returns to that object type. */
interface DataBrowserMemory {
  className: string;
}

function dataBrowserPage(memory: DataBrowserMemory) {
  return defineComponent({
    name: "ManagerDataBrowserPage",
    props: { className: { type: String, default: "" } },
    setup(props) {
      const router = useRouter();
      const onClassChange = (className: string) => {
        memory.className = className;
        if (className !== props.className) void router.replace({ name: "manager-data", params: { className } });
      };
      return () =>
        h("section", { class: "legacy-surface" }, [h(DataBrowser, {
          initialClass: props.className, onClassChange,
          onOpenObject: (reference: ObjectReference) => void router.push(objectViewLocation(reference)),
          onConfigureView: (className: string) => void router.push(panelAddress(managerPaths.objects, { selected: className })),
        })]);
    },
  });
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

const stringParam = (name: string) => (route: { params: Record<string, unknown> }) => {
  const value = route.params[name];
  return { [name]: typeof value === "string" ? value : "" };
};

/**
 * The Manager pages as routes of the service router: one parent route (the Manager frame, no path of its own) with a
 * child per page. Every page route names the navigation entry it belongs to in `meta.page`, which the router guard and
 * the navigation highlight read. The addresses are the ones the Manager has always used, so old deep links still land.
 */
export function managerRoutes(): RouteRecordRaw[] {
  const dataBrowser: DataBrowserMemory = { className: "" };
  return [
    { ...routes.objectView, redirect: legacyObjectDetailRedirect },
    { ...routes.objectViewEditor, redirect: legacyObjectViewEditorRedirect },
    {
      path: "/views/:className",
      redirect: (to) =>
        to.query.edit === "true" ? legacyObjectViewEditorRedirect(to) : legacyObjectDetailRedirect(to),
    },
    {
      path: "",
      component: ManagerFrame,
      children: [
        {
          ...routes.data,
          component: dataBrowserPage(dataBrowser),
          props: stringParam("className"),
          meta: { page: managerPaths.dataBrowser },
          beforeEnter: (to) =>
            !to.params.className && dataBrowser.className
              ? { name: "manager-data", params: { className: dataBrowser.className } }
              : true,
        },
      ],
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
