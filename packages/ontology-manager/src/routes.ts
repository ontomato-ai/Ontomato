import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { defineAsyncComponent, defineComponent, h } from "vue";
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import ManagerFrame from "./ManagerFrame.vue";
import WorkflowCatalog from "./components/WorkflowCatalog.vue";
import TriggerCatalog from "./components/TriggerCatalog.vue";
import { managerPaths } from "./navigation";

/*
 * Heavy pages load when first entered, so their graph, chart and Markdown libraries stay out of the entry script:
 * visual modeling brings AntV G6/X6 and data browsing loads G6 only for its graph view.
 */
const DataBrowser = defineAsyncComponent(() => import("./data-browser/DataBrowser.vue"));
const ObjectViewPage = defineAsyncComponent(() => import("./object-views/ObjectViewPage.vue"));
const ObjectViewBuilder = defineAsyncComponent(() => import("./object-views/ObjectViewBuilder.vue"));
const ProductAssetCatalog=defineAsyncComponent(()=>import("./products/ProductAssetCatalog.vue"));
const ProductAssetDirectory=defineAsyncComponent(()=>import('./products/ProductAssetDirectory.vue'));
const ProductAssetRoute=defineComponent({setup(){
   const route=useRoute(),router=useRouter();
  const directoryQuery=()=>Object.fromEntries(Object.entries(route.query).filter(([key])=>['search','kind','scope','pageForm','sort','page','pageSize'].includes(key)));
  const open=(id:string)=>void router.push({path:`${routes.products.path}/${encodeURIComponent(id)}`,query:directoryQuery()});
  return ()=>route.params.productId||route.query.create||route.query.id?h(ProductAssetCatalog,{key:String(route.params.productId??route.query.create??route.query.id),assetId:String(route.params.productId??route.query.id??''),createKind:typeof route.query.create==='string'?route.query.create:undefined,onSelect:open,onHome:()=>void router.push('/home'),onOpen:(id:string)=>void router.push(`/products/${encodeURIComponent(id)}`),onBack:()=>void router.push({path:routes.products.path,query:directoryQuery()})}):h(ProductAssetDirectory,{query:{...directoryQuery(),page:Number(route.query.page??1),pageSize:Number(route.query.pageSize??20)},onQuery:(query:Record<string,unknown>)=>void router.replace({query:Object.fromEntries(Object.entries(query).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)]))}),onOpen:open,onCreate:(kind:string)=>void router.push({path:routes.products.path,query:{...directoryQuery(),create:kind}})});
}});

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
        selected: { className: OBJECT_TYPE, primaryKey: String(route.params.className) },
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

const WorkflowPage = defineComponent({
  name: "ManagerWorkflowPage",
  setup() {
    return () => h("section", { class: "asset-surface" }, [h(WorkflowCatalog)]);
  },
});

const TriggerPage = defineComponent({
  name: "ManagerTriggerPage",
  setup() {
    return () => h("section", { class: "asset-surface" }, [h(TriggerCatalog)]);
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
        { ...routes.products, component: ProductAssetRoute, meta: {page:managerPaths.products} },
        {path:routes.products.path+'/:productId',component:ProductAssetRoute,meta:{page:managerPaths.products}},
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
        { ...routes.workflows, component: WorkflowPage, meta: { page: managerPaths.workflows } },
        { ...routes.triggers, component: TriggerPage, meta: { page: managerPaths.triggers } },
      ],
    },
  ];
}

/** Manager routes that redirect old standalone paths to their unified destinations. */
export function managerStandaloneRoutes(): RouteRecordRaw[] {
  const ontologyModelsTarget = { name: routes.systemAgentModels.name, query: { category: "ontology" } };
  return [
    { path: "/ontology/models", redirect: ontologyModelsTarget },
    { path: "/settings/model-config/ontology", redirect: ontologyModelsTarget },
  ];
}
