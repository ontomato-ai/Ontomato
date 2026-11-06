import { defineAsyncComponent, defineComponent, h, ref, type PropType } from "vue";
import { useRoute, useRouter, type RouteRecordRaw } from "vue-router";
import { useManagerClient, useManagerCounts } from "./context";
import ManagerFrame from "./ManagerFrame.vue";
import BusinessKnowledge from "./components/BusinessKnowledge.vue";
import OntologyAssetCatalog from "./components/OntologyAssetCatalog.vue";
import OntologyModelCatalog from "./components/OntologyModelCatalog.vue";
import OntologyObjectCreateDialog from "./components/OntologyObjectCreateDialog.vue";
import OntologyObjectDetail from "./components/OntologyObjectDetail.vue";
import OntologyRelationDetail from "./components/OntologyRelationDetail.vue";
import WorkflowCatalog from "./components/WorkflowCatalog.vue";
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

const ASSET_KINDS: readonly AssetTab[] = ["metrics", "actions", "functions", "tasks"];

const GraphPage = defineComponent({
  name: "ManagerGraphPage",
  setup() {
    const router = useRouter();
    return () =>
      h(OntologyPlayground, {
        class: "playground-surface",
        onOpenModeling: (focus: "object" | "relation", id: string) =>
          void router.push({ path: managerPaths.visualModeling, query: { focus, id, back: "playground" } }),
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
        h("section", { class: "legacy-surface" }, [h(DataBrowser, { initialClass: props.className, onClassChange })]);
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
            if (asset.id) void router.push(`/assets/${props.kind}/${encodeURIComponent(asset.id)}`);
          },
          onCreate: () => void router.push(`/assets/${props.kind}/new`),
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
            void router.push(`/assets/${props.kind}`);
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

const KnowledgePage = defineComponent({
  name: "ManagerKnowledgePage",
  setup() {
    const router = useRouter();
    return () =>
      h("section", { class: "knowledge-surface" }, [
        h(BusinessKnowledge, { onGovernance: () => void router.push("/knowledge-governance") }),
      ]);
  },
});

const KnowledgeGovernancePage = defineComponent({
  name: "ManagerKnowledgeGovernancePage",
  props: { sessionId: { type: String, default: "" } },
  setup(props) {
    const router = useRouter();
    return () =>
      h(GovernancePage, {
        sessionId: props.sessionId || null,
        // Opening or starting a conversation updates the address of the same page.
        onSession: (id: string | null) =>
          void router.replace(id ? `/knowledge-governance/${encodeURIComponent(id)}` : "/knowledge-governance"),
        onBack: () => void router.push(managerPaths.knowledge),
      });
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
        { path: managerPaths.graph, component: GraphPage, meta: { page: managerPaths.graph } },
        ...(["objects", "attributes", "relations"] as const).map((resource) => ({
          path: managerPaths[resource],
          component: ModelCatalogPage,
          props: { resource },
          meta: { page: managerPaths[resource] },
        })),
        {
          path: `${managerPaths.objects}/:className`,
          name: "manager-object",
          component: ObjectDetailPage,
          props: stringParam("className"),
          meta: { page: managerPaths.objects },
        },
        {
          path: `${managerPaths.relations}/:relationship`,
          name: "manager-relation",
          component: RelationDetailPage,
          props: stringParam("relationship"),
          meta: { page: managerPaths.relations },
        },
        {
          path: `${managerPaths.dataBrowser}/:className?`,
          name: "manager-data",
          component: dataBrowserPage(dataBrowser),
          props: stringParam("className"),
          meta: { page: managerPaths.dataBrowser },
          beforeEnter: (to) =>
            !to.params.className && dataBrowser.className
              ? { name: "manager-data", params: { className: dataBrowser.className } }
              : true,
        },
        ...ASSET_KINDS.flatMap((kind) => [
          { path: `/assets/${kind}`, component: AssetCatalogPage, props: { kind }, meta: { page: `/assets/${kind}` } },
          {
            path: `/assets/${kind}/:id`,
            component: AssetDetailPage,
            props: (route: { params: Record<string, unknown> }) => ({ kind, ...stringParam("id")(route) }),
            meta: { page: `/assets/${kind}` },
          },
        ]),
        { path: managerPaths.workflows, component: WorkflowPage, meta: { page: managerPaths.workflows } },
        { path: managerPaths.visualModeling, component: VisualModelingPage, meta: { page: managerPaths.visualModeling } },
        { path: managerPaths.knowledge, component: KnowledgePage, meta: { page: managerPaths.knowledge } },
      ],
    },
    // The old platform address of visual modeling.
    { path: "/admin/ontology/visual-modeling", redirect: managerPaths.visualModeling },
  ];
}

/**
 * The Manager pages that fill the window, outside the service layout and its sidebar: knowledge governance is a
 * conversation of its own, entered from business knowledge and left through its back link. It is still a page of the
 * business knowledge entry (`meta.page`), so the same permission opens it.
 */
export function managerStandaloneRoutes(): RouteRecordRaw[] {
  return [
    {
      path: "/knowledge-governance",
      component: ManagerFrame,
      children: [
        {
          path: ":sessionId?",
          component: KnowledgeGovernancePage,
          props: stringParam("sessionId"),
          meta: { page: managerPaths.knowledge },
        },
      ],
    },
  ];
}
