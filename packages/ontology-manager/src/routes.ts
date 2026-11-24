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
const ObjectViewPage = defineAsyncComponent(() => import("./object-views/ObjectViewPage.vue"));
const ObjectViewBuilder = defineAsyncComponent(() => import("./object-views/ObjectViewBuilder.vue"));

function objectViewLocation(reference: ObjectReference) {
  return { name: routes.objectView.name, params: { className: reference.className }, query: { key: reference.primaryKey } };
}

const ObjectViewRoute = defineComponent({
  setup() {
    const route = useRoute();
    const router = useRouter();
    return () => h(ObjectViewPage, {
      reference: { className: String(route.params.className), primaryKey: String(route.query.key ?? "") },
      onOpen: (reference: ObjectReference) => void router.push({ ...objectViewLocation(reference), query: { key: reference.primaryKey, ...(route.query.from === "workspace" ? { from: "workspace" } : {}) } }),
      onEdit: () => void router.push({ name: routes.objectViewEditor.name, params: route.params, query: route.query }),
      onBack: () => void router.push(route.query.from === "workspace" ? { path: "/workspace" } : { name: routes.data.name, params: { className: route.params.className } }),
    });
  },
});

const ObjectViewEditorRoute = defineComponent({
  setup() {
    const route = useRoute();
    const router = useRouter();
    return () => h(ObjectViewBuilder, {
      className: String(route.params.className),
      initialPrimaryKey: String(route.query.key ?? ""),
      onOpen: (reference: ObjectReference) => void router.push(objectViewLocation(reference)),
      // Back goes to the object types panel with this class selected: the page that class's detail address opens.
      onBack: () => void router.push(panelAddress(managerPaths.objects, {
        selected: String(route.params.className),
      })),
    });
  },
});

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
          onConfigureView: (className: string) => void router.push({ name: routes.objectViewEditor.name, params: { className } }),
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
    {
      path: "",
      component: ManagerFrame,
      children: [
        { ...routes.objectView, component: ObjectViewRoute, meta: { page: managerPaths.dataBrowser, ownHeader: true } },
        { ...routes.objectViewEditor, component: ObjectViewEditorRoute, meta: { page: managerPaths.objects } },
        { path: "/views/:className", redirect: (to) => ({ name: to.query.edit === "true" ? routes.objectViewEditor.name : routes.objectView.name, params: to.params, query: to.query }) },
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
