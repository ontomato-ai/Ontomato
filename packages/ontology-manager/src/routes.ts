import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { AgentModelsPage, ontologyAgentModelPages, ontologyAgentModelSource } from "@ontomato/platform-shell";
import { defineAsyncComponent, defineComponent, h, ref, type Component, type PropType } from "vue";
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import { useManagerClient, useManagerCounts } from "./context";
import ManagerFrame from "./ManagerFrame.vue";
import BusinessKnowledge from "./components/BusinessKnowledge.vue";
import OntologyAssetCatalog from "./components/OntologyAssetCatalog.vue";
import OntologyModelCatalog from "./components/OntologyModelCatalog.vue";
import OntologyObjectCreateDialog from "./components/OntologyObjectCreateDialog.vue";
import OntologyObjectDetail from "./components/OntologyObjectDetail.vue";
import OntologyRelationDetail from "./components/OntologyRelationDetail.vue";
import WorkflowCatalog from "./components/WorkflowCatalog.vue";
import TriggerCatalog from "./components/TriggerCatalog.vue";
import CapabilityMap from "./components/CapabilityMap.vue";
import { managerPaths } from "./navigation";
import type { AssetTab, ModelResource } from "./workspace";

/*
 * Heavy pages load when first entered, so their graph, chart and Markdown libraries stay out of the entry script:
 * the graph view and visual modeling bring AntV G6/X6, data browsing loads G6 only for its graph view, asset details
 * bring Markdown and code highlighting, and knowledge governance brings the agent shell.
 */
const GovernancePage = defineAsyncComponent(() => import("./knowledge-governance/GovernancePage.vue"));
const DataBrowser = defineAsyncComponent(() => import("./data-browser/DataBrowser.vue"));
const VisualModeling = defineAsyncComponent(() => import("./visual-modeling/VisualModeling.vue"));
const OntologyAssetDetail = defineAsyncComponent(() => import("./components/OntologyAssetDetail.vue"));
const OntologyPlayground = defineAsyncComponent(() => import("./components/OntologyPlayground.vue"));
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
      onBack: () => void router.push({ name: routes.object.name, params: { className: route.params.className } }),
    });
  },
});

const assetDetails = { metrics: routes.metric, actions: routes.action, functions: routes.function };
const ASSET_KINDS: readonly AssetTab[] = ["metrics", "actions", "functions"];

const GraphPage = defineComponent({
  name: "ManagerGraphPage",
  setup() {
    const router = useRouter();
    return () =>
      h(OntologyPlayground, {
        class: "playground-surface",
        onOpenModeling: (focus: "object" | "relation", id: string) =>
          void router.push({ path: managerPaths.visualModeling, query: { focus, id, back: "playground" } }),
        onOpenProduct:(id:string)=>void router.push(`${routes.products.path}/${encodeURIComponent(id)}`),
      });
  },
});

const ModelCatalogPage = defineComponent({
  name: "ManagerModelCatalogPage",
  props: { resource: { type: String as PropType<ModelResource>, required: true } },
  setup(props) {
    const router = useRouter();
    const counts = useManagerCounts();
    const creating = ref(false);
    return () =>
      h("section", { class: "model-surface" }, [
        h(OntologyModelCatalog, {
          resource: props.resource,
          onCreateObject: () => (creating.value = true),
          onEditObject: (className: string) => void router.push({ name: "manager-object", params: { className } }),
          onEditRelation: (relationship: string) =>
            void router.push({ name: "manager-relation", params: { relationship }, query: { from: "catalog" } }),
        }),
        h(OntologyObjectCreateDialog, {
          modelValue: creating.value,
          "onUpdate:modelValue": (open: boolean) => (creating.value = open),
          onCreated: (className: string) => {
            void counts.refresh();
            void router.push({ name: "manager-object", params: { className } });
          },
        }),
      ]);
  },
});

const ObjectDetailPage = defineComponent({
  name: "ManagerObjectDetailPage",
  props: { className: { type: String, required: true } },
  setup(props) {
    const router = useRouter();
    const counts = useManagerCounts();
    return () =>
      h("section", { class: "model-surface" }, [
        h(OntologyObjectDetail, {
          className: props.className,
          onBack: () => {
            void router.push(managerPaths.objects);
            void counts.refresh();
          },
          onUpdated: () => void counts.refresh(),
          onConfigureView: () => void router.push({ name: routes.objectViewEditor.name, params: { className: props.className } }),
          onBrowse: (className: string) => void router.push({ name: "manager-data", params: { className } }),
          onRelation: (relationship: string) =>
            void router.push({ name: "manager-relation", params: { relationship }, query: { from: "object" } }),
        }),
      ]);
  },
});

const RelationDetailPage = defineComponent({
  name: "ManagerRelationDetailPage",
  props: { relationship: { type: String, required: true } },
  setup(props) {
    const router = useRouter();
    const route = useRoute();
    const counts = useManagerCounts();
    const { loadOntology } = useManagerClient();
    // Back from a relation opened on an object returns to that object; otherwise to the relation catalog.
    async function back() {
      let target: string | { name: string; params: { className: string } } = managerPaths.relations;
      if (route.query.from === "object") {
        const ontology = await loadOntology();
        const relation = ontology.relations.find((item) => item.relationship === props.relationship);
        if (relation) target = { name: "manager-object", params: { className: relation.fromclass } };
      }
      void router.push(target);
      void counts.refresh();
    }
    return () =>
      h("section", { class: "model-surface" }, [
        h(OntologyRelationDetail, {
          relationship: props.relationship,
          onBack: () => void back(),
          onUpdated: () => void counts.refresh(),
          onObject: (className: string) => void router.push({ name: "manager-object", params: { className } }),
        }),
      ]);
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

const AssetCatalogPage = defineComponent({
  name: "ManagerAssetCatalogPage",
  props: { kind: { type: String as PropType<AssetTab>, required: true } },
  setup(props) {
    const router = useRouter();
    return () =>
      h("section", { class: "asset-surface" }, [
        h(OntologyAssetCatalog, {
          kind: props.kind,
          onSelect: (asset: { id?: string }) => {
            if (asset.id) void router.push({ name: assetDetails[props.kind].name, params: { id: asset.id } });
          },
          onCreate: () => void router.push({ name: assetDetails[props.kind].name, params: { id: "new" } }),
        }),
      ]);
  },
});

const AssetDetailPage = defineComponent({
  name: "ManagerAssetDetailPage",
  props: {
    kind: { type: String as PropType<AssetTab>, required: true },
    id: { type: String, required: true },
  },
  setup(props) {
    const router = useRouter();
    const counts = useManagerCounts();
    return () =>
      h("section", { class: "asset-surface" }, [
        h(OntologyAssetDetail, {
          kind: props.kind,
          asset: props.id === "new" ? null : { id: props.id, name: props.id },
          creating: props.id === "new",
          onBack: () => {
            void router.push(routes[props.kind].path);
            void counts.refresh();
          },
          onSaved: () => void counts.refresh(),
          onCreated: () => void counts.refresh(),
        }),
      ]);
  },
});

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

const CapabilityMapPage = defineComponent({
  name: "ManagerCapabilityMapPage",
  setup() {
    return () => h("section", { class: "asset-surface" }, [h(CapabilityMap)]);
  },
});

const VisualModelingPage = defineComponent({
  name: "ManagerVisualModelingPage",
  setup() {
    const router = useRouter();
    const route = useRoute();
    const query = (key: string) => (typeof route.query[key] === "string" ? (route.query[key] as string) : "");
    return () =>
      h("section", { class: "visual-content" }, [
        h(VisualModeling, {
          focus: query("focus"),
          focusId: query("id"),
          backToPlayground: query("back") === "playground",
          onBack: () => void router.push(managerPaths.graph),
        }),
      ]);
  },
});

/** The ontology manager's models: the modeling agents', at the foot of its menu, over the Manager's own requests. */
const OntologyModelsPage = defineComponent({
  name: "ManagerOntologyModelsPage",
  setup() {
    const page = ontologyAgentModelPages.find((candidate) => candidate.app === "ontology")!;
    const source = ontologyAgentModelSource(useManagerClient().dataEngine, page);
    return () => h("section", { class: "models-surface" }, [h(AgentModelsPage, { source, path: page.path })]);
  },
});

/** The draft an address names: the originating run and the draft's path inside it, when all three are there. */
function draftOf(query: Record<string, unknown>) {
  const sessionId = query.draftSessionId, runId = query.draftRunId, path = query.draftPath;
  return typeof sessionId === "string" && typeof runId === "string" && typeof path === "string"
    ? { sessionId, runId, path }
    : null;
}

/**
 * Business knowledge, and the draft an agent wrote for it: a page link carries the originating run and the draft's path
 * (`draftSessionId/draftRunId/draftPath`), and the page reads the draft through that run's own artifacts. A saved draft
 * leaves the address, so a reload does not fill it again.
 */
const KnowledgePage = defineComponent({
  name: "ManagerKnowledgePage",
  setup() {
    const router = useRouter();
    const route = useRoute();
    return () =>
      h("section", { class: "knowledge-surface" }, [
        h(BusinessKnowledge, {
          pageDraft: draftOf(route.query),
          // The saved draft's parameters leave the address, so a reload does not fill the form again.
          onDraftApplied: () => {
            const { draftSessionId: _session, draftRunId: _run, draftPath: _path, ...query } = route.query;
            void router.replace({ query });
          },
          // The governance conversation is the agent platform's page: this page only names the agent it maps to.
          onGovernance: (agentId: string) =>
            void router.push({ path: routes.chat.path, query: { agentId } }),
        }),
      ]);
  },
});

/**
 * The knowledge governance app's pages that another package ships. The feedback records belong to the platform's pages
 * (they read the workbench's records through the platform host), so the edition that assembles both registers the
 * screen here instead of this package importing another application's module (DESIGN.md "Applications and shells").
 */
const governanceScreens: { feedback?: Component } = {};

/** Registers a page of the governance application the edition supplies; called once, before the routes mount. */
export function registerGovernanceScreen(id: "feedback", screen: Component) {
  governanceScreens[id] = screen;
}


/** The feedback records: a page of this application, its screen supplied by the edition that holds both. */
const FeedbackPage = defineComponent({
  name: "ManagerGovernanceFeedbackPage",
  setup: () => () => h(governanceScreens.feedback!),
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
        { ...routes.playground, component: GraphPage, meta: { page: managerPaths.graph } },
        ...(["objects", "attributes", "relations"] as const).map((resource) => ({
          ...routes[resource],
          component: ModelCatalogPage,
          props: { resource },
          meta: { page: managerPaths[resource] },
        })),
        {
          ...routes.object,
          component: ObjectDetailPage,
          props: stringParam("className"),
          meta: { page: managerPaths.objects },
        },
        {
          ...routes.relation,
          component: RelationDetailPage,
          props: stringParam("relationship"),
          meta: { page: managerPaths.relations },
        },
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
        ...ASSET_KINDS.flatMap((kind) => [
          { ...routes[kind], component: AssetCatalogPage, props: { kind }, meta: { page: routes[kind].path } },
          {
            ...assetDetails[kind],
            component: AssetDetailPage,
            props: (route: { params: Record<string, unknown> }) => ({ kind, ...stringParam("id")(route) }),
            meta: { page: routes[kind].path },
          },
        ]),
        { ...routes.workflows, component: WorkflowPage, meta: { page: managerPaths.workflows } },
        { ...routes.triggers, component: TriggerPage, meta: { page: managerPaths.triggers } },
        { ...routes.capabilityMap, component: CapabilityMapPage, meta: { page: managerPaths.capabilityMap } },
        { ...routes.modeling, component: VisualModelingPage, meta: { page: managerPaths.visualModeling } },
        { ...routes.knowledge, component: KnowledgePage, meta: { page: managerPaths.knowledge } },
        { ...routes.ontologyModels, component: OntologyModelsPage, meta: { page: routes.ontologyModels.path } },
      ],
    },
  ];
}

/**
 * The Manager pages that fill the window, outside the service layout and its sidebar: one governance record's report,
 * entered from the task or conversation that produced it and left through its back link. It is still a page of the
 * business knowledge entry (`meta.page`), so the same permission opens it. The feedback records and business knowledge
 * open at their own addresses, so a link to either lands on that page.
 */
export function managerStandaloneRoutes(): RouteRecordRaw[] {
  return [
    {path:'/ontology/models',redirect:{name:routes.ontologyModels.name}},
    {
      path: routes.governanceKnowledge.path,
      meta: { service: true },
      component: ManagerFrame,
      children: [
        { ...routes.governanceKnowledge, component: KnowledgePage, meta: { page: managerPaths.knowledge } },
      ],
    },
    {
      path: routes.feedback.path,
      meta: { service: true },
      component: ManagerFrame,
      children: [
        { ...routes.feedback, component: FeedbackPage, meta: { page: routes.feedback.path } },
      ],
    },
  ];
}
