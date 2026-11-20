import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  ACTION,
  AGENT_DEFINITION,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  RELATIONSHIP,
  USER,
  WORKFLOW,
  platformOntologyLayers,
} from "@ontomato/contracts/platform-object-types";
import type {
  GraphCanvasEdge,
  GraphCanvasNode,
  GraphCanvasPoint,
  GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
import { createDirectPanelInstance, type MemberDataState } from "../../../../../packages/apps-sdk/src/panel/direct";
import { encodeGraphNodeId } from "../../../../../packages/apps-sdk/src/base/ontology-graph-layout";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { memberProjectionId } from "../../../../../packages/apps-sdk/src/panel/projection-element";

/*
 * Direct-read regression for ObjectGraph, OntologyGraph, and ObjectRelations:
 * - ObjectGraph reads `nodes` and `edges` (`panelRecordList`) with `config.edgeEnds` (`source`, `target`) instead of
 *   legacy `projection.graph`, edits the paired form field through `useFormField`, and shows forbidden/error states.
 * - OntologyGraph reads `schema`, `counts`, `start`, and `neighbors` through the member read port with no resource
 *   adapters registered, preserving type/instance behavior, complete `{ className, primaryKey }` identities, drag
 *   positions, viewport, layer filters, query highlights, three-state relation notices, and forbidden/error states.
 * - ObjectRelations reads `neighbors` through `useMemberData` with no resource adapters registered, groups by relation
 *   kind with direction, line semantics, and distinct statuses, updates `selected` with full identity on peer click,
 *   and distinguishes forbidden/error host read states.
 */

const canvasRecorder = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  viewport: null as GraphCanvasViewport | null,
  fitCalls: 0,
  relayoutCalls: 0,
  emitSelect: null as ((ids: string[]) => void) | null,
  emitBlank: null as (() => void) | null,
  emitMove: null as ((id: string, pos: GraphCanvasPoint) => void) | null,
  emitViewport: null as ((viewport: GraphCanvasViewport) => void) | null,
};

function resetCanvasRecorder() {
  canvasRecorder.nodes = [];
  canvasRecorder.edges = [];
  canvasRecorder.selected = [];
  canvasRecorder.viewport = null;
  canvasRecorder.fitCalls = 0;
  canvasRecorder.relayoutCalls = 0;
  canvasRecorder.emitSelect = null;
  canvasRecorder.emitBlank = null;
  canvasRecorder.emitMove = null;
  canvasRecorder.emitViewport = null;
}

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>(
    "@ontomato/foundation-ui/graph/g6",
  );
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, required: true },
      edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] },
      selection: { type: String, default: "single" },
      layout: { type: Object, default: () => ({ type: "grid" }) },
      categories: { type: Array, default: () => [] },
      maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "blank", "move", "viewport"],
    setup(props, { emit, expose }) {
      canvasRecorder.emitSelect = (ids: string[]) => emit("update:selected", ids);
      canvasRecorder.emitBlank = () => emit("blank");
      canvasRecorder.emitMove = (id: string, pos: GraphCanvasPoint) => emit("move", id, pos);
      canvasRecorder.emitViewport = (viewport: GraphCanvasViewport) => {
        canvasRecorder.viewport = viewport;
        emit("viewport", viewport);
      };
      expose({
        fit: async () => {
          canvasRecorder.fitCalls += 1;
        },
        relayout: async () => {
          canvasRecorder.relayoutCalls += 1;
        },
      });
      return () => {
        canvasRecorder.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasRecorder.edges = props.edges as readonly GraphCanvasEdge[];
        canvasRecorder.selected = props.selected as readonly string[];
        return h("div", { class: "mock-g6-canvas", "aria-label": props.label });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

type Layer = (typeof platformOntologyLayers)[number];
const allLayers: [Layer, ...Layer[]] = [platformOntologyLayers[0], ...platformOntologyLayers.slice(1)];

type Read = PanelMemberReadRequest;

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const typeSource = (id: string) => ({ type: { kind: "PlatformObjectType" as const, id } });

let cleanup: (() => void) | null = null;

function mountDirect(
  manifest: PanelManifest,
  projections: Record<string, ProductProjection>,
  answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: { initial?: Record<string, unknown>; members?: readonly string[] } = {},
) {
  const reads: Read[] = [];
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "direct-graph",
    url: () => "/direct-graph",
    label: () => "Direct Graph",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      // A member's operations are its owners' (here a form's save of the chosen object); the data reads are the test's.
      if (request.operations) {
        const projection = projections[memberProjectionId(manifest, request.memberPath[0]!.member)]!;
        return ready(Object.fromEntries(Object.entries(projection.operations ?? {}).flatMap(([name, { operation, target }]) =>
          target && "input" in target && request.inputs[target.input]
            ? [[name, { kind: "form.save", handlerRef: operation.id, label: "Save", effect: "write", target: { source: "input", input: target.input },
              inputSchema: {}, resultSchema: {}, batch: false }]]
            : [])));
      }
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member, key: member }))),
  })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element, reads };
}

beforeEach(() => {
  resetCanvasRecorder();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

it("draws direct ObjectGraph in a direct panel via PanelMember with member.formField and no resource adapters", async () => {
  const projections: Record<string, ProductProjection> = {
    "agent-form": {
      ...meta,
      id: "agent-form",
      name: "Agent form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION } },
      outputs: {},
      config: {},
      data: { form: { source: { object: { input: "agent" } }, read: "form", params: {} } },
      operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
    },
    "agent-data-scope": {
      ...meta,
      id: "agent-data-scope",
      name: "Data scope",
      componentId: "@ontomato/sdk:ObjectGraph",
      inputs: {},
      outputs: {},
      config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
      data: {
        nodes: { source: typeSource(OBJECT_TYPE), read: "list", params: {} },
        edges: { source: typeSource(RELATIONSHIP), read: "list", params: {} },
      },
    },
  };
  const manifest: PanelManifest = {
    state: {
      selectedAgent: { type: { kind: "object", objectType: AGENT_DEFINITION }, personal: false, deepLink: true, external: false },
    },
    members: {
      definition: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selectedAgent" } } },
      scope: { target: { projectionId: "agent-data-scope" }, formField: { slot: "definition", path: "/classNames" } },
    },
    events: {},
  };

  const { instance, element, reads } = mountDirect(
    manifest,
    projections,
    (request) => {
      if (request.dataName === "form") {
        return ready({
          fields: [
            {
              path: "/classNames",
              label: "Data scope",
              help: "Empty means all classes",
              control: { kind: "string-array" },
              valueSchema: {},
              required: false,
              readOnly: false,
            },
          ],
          values: { classNames: ["Customer"] },
          errors: [],
          save: { method: "PUT", path: "/agents/:id", bodySchema: {}, draftOperation: `${AGENT_DEFINITION}.save` },
        });
      }
      if (request.dataName === "nodes") {
        return ready([
          { primaryKey: "Customer", label: "Customer", fields: {} },
          { primaryKey: "Order", label: "Order", fields: {} },
        ]);
      }
      if (request.dataName === "edges") {
        return ready([
          { primaryKey: "rel-1", label: "places", fields: { fromclass: "Customer", toclass: "Order" } },
        ]);
      }
      throw new Error(`Unexpected read ${request.dataName}`);
    },
    { initial: { selectedAgent: { className: AGENT_DEFINITION, primaryKey: "agent-1" } } },
  );

  const adjacentBtn = await vi.waitFor(() => {
    const button = element.querySelector<HTMLButtonElement>(".sdk-object-graph-adjacent");
    if (!button || button.disabled) throw new Error("Direct PanelMember ObjectGraph adjacent button is not ready");
    return button;
  });
  expect(reads.map((r) => r.dataName).sort()).toEqual(["edges", "form", "nodes"]);
  adjacentBtn.click();
  await vi.waitFor(() => {
    expect(instance.forms.handle("definition")?.values.value.classNames).toEqual(["Customer", "Order"]);
  });
});

it("draws direct ObjectGraph in a frame via frameMemberData and edits the paired form field using config.edgeEnds", async () => {
  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const { createPanelInstance } = await import("../../../../../packages/apps-sdk/src/panel/instance");
  const { panelContextKey } = await import("../../../../../packages/apps-sdk/src/panel/context");
  const { default: Projection } = await import("../../../../../packages/apps-sdk/src/panel/Projection.vue");

  registerPlatformObjectAdapter({
    objectType: AGENT_DEFINITION,
    forms: {
      describe: async () => ({
        fields: [
          {
            path: "/classNames",
            label: "Data scope",
            help: "Empty means all classes",
            control: { kind: "string-array" as const },
            valueSchema: {},
            required: false,
            readOnly: false,
          },
        ],
        values: { classNames: ["Customer"] },
        errors: [],
        save: { method: "PUT" as const, path: "/agents/:id", bodySchema: {}, draftOperation: `${AGENT_DEFINITION}.save` },
      }),
      save: vi.fn(async () => ({ primaryKey: "agent-1", label: "Agent", fields: {} })),
    },
  });
  registerPlatformObjectAdapter({
    objectType: OBJECT_TYPE,
    list: async () => [
      { primaryKey: "Customer", label: "Customer", fields: {} },
      { primaryKey: "Order", label: "Order", fields: {} },
      { primaryKey: "Invoice", label: "Invoice", fields: {} },
    ],
  });
  registerPlatformObjectAdapter({
    objectType: RELATIONSHIP,
    list: async () => [
      { primaryKey: "rel-1", label: "places", fields: { fromclass: "Customer", toclass: "Order" } },
      { primaryKey: "rel-2", label: "billed-by", fields: { fromclass: "Order", toclass: "Invoice" } },
    ],
  });

  const projections: Record<string, ProductProjection> = {
    "agent-form": {
      ...meta,
      id: "agent-form",
      name: "Agent form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION } },
      outputs: {},
      config: {},
      data: { form: { source: { object: { input: "agent" } }, read: "form", params: {} } },
      operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
    },
    "agent-data-scope": {
      ...meta,
      id: "agent-data-scope",
      name: "Data scope",
      componentId: "@ontomato/sdk:ObjectGraph",
      inputs: {},
      outputs: {},
      config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
      data: {
        nodes: { source: typeSource(OBJECT_TYPE), read: "list", params: {} },
        edges: { source: typeSource(RELATIONSHIP), read: "list", params: {} },
      },
    },
  };

  const panel = definePanel({
    state: { selectedAgent: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true } },
    members: {
      definition: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selectedAgent" } } },
      scope: { target: { projectionId: "agent-data-scope" }, inputs: {}, formField: { slot: "definition", path: "/classNames" } },
    },
    events: {},
  });

  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "agent-settings",
    url: () => "/agents",
    label: () => "Agents",
    initial: { selectedAgent: { className: AGENT_DEFINITION, primaryKey: "agent-1" } },
    ...noOperations,
    recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest: panel },
        manifest: panel,
        instance,
        projection: (id: string) => instance.projection(id),
        invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
        projectionsChanged: () => () => {},
        draft: instance.draft,
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
      });
      return () => h("div", [h(Projection, { slot: "definition" }), h(Projection, { slot: "scope" })]);
    },
  }))
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };

  // Renders the graph from direct `nodes`/`edges` datums with `Order` marked adjacent to `Customer`.
  const adjacentBtn = await vi.waitFor(() => {
    const button = element.querySelector<HTMLButtonElement>(".sdk-object-graph-adjacent");
    if (!button || button.disabled) throw new Error("ObjectGraph adjacent button is not ready");
    return button;
  });
  expect(adjacentBtn.textContent).toContain("1");
  expect(element.querySelectorAll(".sdk-object-graph svg [data-node-id]")).toHaveLength(3);

  // Clicking includeAdjacent writes `Order` into the paired form's `/classNames` field.
  adjacentBtn.click();
  await vi.waitFor(() => {
    expect(instance.forms.handle("definition")?.values.value.classNames).toEqual(["Customer", "Order"]);
  });
});

it("shows forbidden and error datum states on direct ObjectGraph without pretending the graph is empty", async () => {
  const { createPanelInstance } = await import("../../../../../packages/apps-sdk/src/panel/instance");
  const { panelContextKey, projectionKey } = await import("../../../../../packages/apps-sdk/src/panel/context");
  const { panelMemberKey } = await import("../../../../../packages/apps-sdk/src/panel/member");
  const { default: ObjectGraph } = await import("../../../../../packages/apps-sdk/src/base/ObjectGraph.vue");

  const scopeProjection: ProductProjection = {
    ...meta,
    id: "agent-data-scope",
    name: "Data scope",
    componentId: "@ontomato/sdk:ObjectGraph",
    inputs: {},
    outputs: {},
    config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
    data: {
      nodes: { source: typeSource(OBJECT_TYPE), read: "list", params: {} },
      edges: { source: typeSource(RELATIONSHIP), read: "list", params: {} },
    },
  };
  const panel = definePanel({
    state: {},
    members: {
      definition: { target: { projectionId: "agent-form" }, inputs: {} },
      scope: { target: { projectionId: "agent-data-scope" }, inputs: {}, formField: { slot: "definition", path: "/classNames" } },
    },
    events: {},
  });
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "agent-settings",
    url: () => "/agents",
    label: () => "Agents",
    ...noOperations,
    recordDraftCreated: async () => {},
    readProjection: async () => scopeProjection,
  });
  instance.forms.register("definition", {
    handle: {
      fields: ref([
        {
          path: "/classNames",
          label: "Data scope",
          control: { kind: "string-array" },
          valueSchema: {},
          required: false,
          readOnly: false,
        },
      ]),
      values: ref({ classNames: [] }),
      errors: ref({}),
      changed: ref(new Set<string>()),
      busy: ref(false),
      set: vi.fn(),
    },
    receive: async () => null,
    submit: async () => ({}),
    dirty: () => false,
    discard: () => {},
  });

  const nodesState = shallowRef<MemberDataState>({ status: "forbidden" });
  const edgesState = shallowRef<MemberDataState>({ status: "ready", value: [] });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest: panel },
        manifest: panel,
        instance,
        projection: () => Promise.reject(new Error("unused")),
        invoke: () => Promise.reject(new Error("unused")),
        projectionsChanged: () => () => {},
        draft: instance.draft,
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
      });
      provide(projectionKey, {
        slot: "scope",
        projection: scopeProjection,
        inputs: {},
      });
      provide(panelMemberKey, () => ({
        key: "scope",
        projection: scopeProjection,
        inputs: computed(() => ({})),
        operations: computed(() => ({ status: "ready" as const, value: {} })),
        data: {
          use: (name) => computed(() => (name === "nodes" ? nodesState.value : edgesState.value)),
          read: async (name) => (name === "nodes" ? nodesState.value : edgesState.value),
        },
      }));
      return () => h(ObjectGraph, { edgeEnds: { source: "/fromclass", target: "/toclass" } });
    },
  }))
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };

  await vi.waitFor(() => expect(element.querySelector(".el-form-item__error")?.textContent).toContain("You do not have access to this"));
  expect(element.querySelector(".el-empty")).toBeNull();

  nodesState.value = { status: "error", message: "Metadata service unavailable" };
  await nextTick();
  expect(element.querySelector(".el-form-item__error")?.textContent).toContain("Metadata service unavailable");

  // Ready nodes with an empty edges datum still draw the nodes rather than collapsing to an empty graph.
  nodesState.value = { status: "ready", value: [{ primaryKey: "Order", label: "Order", fields: {} }] };
  edgesState.value = { status: "empty" };
  await nextTick();
  expect(element.querySelector(".el-empty")).toBeNull();
  expect(element.textContent).toContain("Order");
});

it("drives direct OntologyGraph in type and instance modes through member reads with no resource adapters", async () => {
  const graphProjection: ProductProjection = {
    ...meta,
    id: "capability-graph",
    name: "Capability map",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      mode: { kind: "scalar", type: "string" },
      selected: { kind: "object-union", layers: allLayers },
      selectedType: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
      node: { kind: "object-union", layers: allLayers },
      layers: { kind: "json" },
    },
    outputs: {
      selectedNode: { kind: "object-union", layers: allLayers },
      selectedType: { kind: "scalar", type: "string" },
    },
    config: {},
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      counts: { source: typeSource(ONTOLOGY_TYPE), read: "counts", params: {} },
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: {
        source: typeSource(ONTOLOGY_TYPE),
        read: "neighbors",
        params: { node: { input: "node" }, layers: { input: "layers" } },
      },
    },
  };

  const manifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false, default: "type" },
      selected: { type: { kind: "object-union", layers: allLayers }, personal: false, deepLink: true, external: true },
      selectedType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false },
      query: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "" },
    },
    members: {
      graph: {
        target: { projectionId: "capability-graph" },
        inputs: {
          mode: { state: "mode" },
          selected: { state: "selected" },
          selectedType: { state: "selectedType" },
          query: { state: "query" },
        },
        outputs: {
          selectedNode: { state: "selected" },
          selectedType: { state: "selectedType" },
        },
      },
    },
    events: {},
  };

  const actionNode = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const workflowNode = { className: WORKFLOW, primaryKey: "wf-1", label: "Order Pipeline", layer: "capability" as const };
  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };

  const { instance, element, reads } = mountDirect(manifest, { "capability-graph": graphProjection }, (request) => {
    if (request.dataName === "schema") {
      return ready({
        layers: ["capability", "governance"],
        objectTypes: [
          { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
          { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
        ],
        relationKinds: [
          {
            id: "action.hasOwner",
            from: ACTION,
            to: USER,
            derived: false,
            owner: "java-action",
            labelKey: "platformOntology.relations.actionHasOwner",
          },
        ],
      });
    }
    if (request.dataName === "counts") {
      return ready({
        counts: [
          { type: ACTION, layer: "capability", status: "ok", count: 5 },
          { type: USER, layer: "governance", status: "refused", reason: "Owner denied" },
        ],
      });
    }
    if (request.dataName === "start") {
      return ready({ node: actionNode });
    }
    if (request.dataName === "neighbors") {
      const node = request.inputs.node as { className: string; primaryKey: string };
      if (node.primaryKey === "act-1") {
        return ready({
          node: actionNode,
          neighbors: [workflowNode],
          edges: [
            {
              id: "e-1",
              relationKind: "workflow.invokesAction",
              from: { className: WORKFLOW, primaryKey: "wf-1" },
              to: { className: ACTION, primaryKey: "act-1" },
              direction: "incoming",
              derived: true,
            },
          ],
          relations: [
            { relationKind: "workflow.invokesAction", status: "ok", edgeCount: 1 },
            { relationKind: "action.hasOwner", status: "refused", edgeCount: 0, reason: "No user read" },
          ],
        });
      }
      return ready({
        node: workflowNode,
        neighbors: [userNode],
        edges: [
          {
            id: "e-2",
            relationKind: "workflow.hasOwner",
            from: { className: WORKFLOW, primaryKey: "wf-1" },
            to: { className: USER, primaryKey: "u-1" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [{ relationKind: "workflow.hasOwner", status: "ok", edgeCount: 1 }],
      });
    }
    throw new Error(`Unexpected read ${request.dataName}`);
  });

  // Type mode loads schema + counts through host read port and renders counts/refusal badges.
  await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(2));
  expect(reads.map((r) => r.dataName).sort()).toEqual(["counts", "schema"]);
  expect(canvasRecorder.nodes.find((n) => n.id === ACTION)?.label).toContain("(5)");
  expect(canvasRecorder.nodes.find((n) => n.id === USER)?.label).toContain("No permission");

  // Type selection writes selectedType state.
  canvasRecorder.emitSelect?.([ACTION]);
  await nextTick();
  expect(instance.state.values.value.selectedType).toBe(ACTION);

  // Switching to instance mode reads start + neighbors and renders the 3-state refused notice.
  const actionId = encodeGraphNodeId(actionNode);
  const workflowId = encodeGraphNodeId(workflowNode);
  const userId = encodeGraphNodeId(userNode);
  instance.state.set("mode", "instance");
  await vi.waitFor(() => expect(canvasRecorder.nodes.map((n) => n.id)).toContain(workflowId));
  expect(element.querySelector("[data-graph-state='refused']")?.textContent).toContain("No user read");

  // Dragging a node and panning viewport are preserved across 1-hop expansion; internal layer filter narrows neighbor layers.
  canvasRecorder.emitMove?.(actionId, { x: 180, y: -90 });
  canvasRecorder.emitViewport?.({ x: 40, y: 20, width: 800, height: 600, zoom: 1.4 });
  element.querySelector<HTMLButtonElement>("[data-graph-layer='fact']")!.click();
  await nextTick();

  // Clicking unexpanded neighbor writes full { className, primaryKey } identity, registers owner label for pageContext, and expands 1-hop via neighbors read.
  canvasRecorder.emitSelect?.([workflowId]);
  await vi.waitFor(() => expect(canvasRecorder.nodes.map((n) => n.id)).toContain(userId));
  expect(instance.state.values.value.selected).toEqual({ className: WORKFLOW, primaryKey: "wf-1" });
  expect(instance.pageContext.value.selection?.[0]?.label).toContain("Order Pipeline");
  expect(canvasRecorder.nodes.find((n) => n.id === actionId)).toMatchObject({ x: 180, y: -90 });
  expect(canvasRecorder.viewport).toEqual({ x: 40, y: 20, width: 800, height: 600, zoom: 1.4 });
  const lastNeighborRead = reads.filter((r) => r.dataName === "neighbors").at(-1)!;
  expect(lastNeighborRead.inputs.node).toEqual({ className: WORKFLOW, primaryKey: "wf-1" });
  expect(lastNeighborRead.inputs.layers).toEqual(["capability", "governance", "product"]);
});

it("surfaces forbidden and error host read states on direct OntologyGraph without showing empty graph", async () => {
  const graphProjection: ProductProjection = {
    ...meta,
    id: "capability-graph",
    name: "Capability map",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { mode: { kind: "scalar", type: "string" }, node: { kind: "object-union", layers: allLayers } },
    outputs: {},
    config: {},
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: { node: { input: "node" } } },
    },
  };
  const manifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "type" },
    },
    members: {
      graph: { target: { projectionId: "capability-graph" }, inputs: { mode: { state: "mode" } } },
    },
    events: {},
  };

  let response: ProductPanelReadResponse = { status: "forbidden" };
  const { instance, element } = mountDirect(manifest, { "capability-graph": graphProjection }, () => response);

  await vi.waitFor(() => expect(element.querySelector("[data-graph-state='forbidden']")).not.toBeNull());
  expect(element.querySelector(".el-empty")).toBeNull();

  response = { status: "error", message: "Ontology service failed" };
  instance.state.set("mode", "instance");
  await nextTick();
  instance.state.set("mode", "type");
  await vi.waitFor(() => expect(element.querySelector("[data-graph-state='error']")?.textContent).toContain("Ontology service failed"));
  expect(element.querySelector(".el-empty")).toBeNull();
});

it("drives direct ObjectRelations through useMemberData with complete identities and distinct access states", async () => {
  const relationsProjection: ProductProjection = {
    ...meta,
    id: "capability-relations",
    name: "Node relations",
    componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: { kind: "object-union", layers: allLayers } },
    outputs: { selected: { kind: "object-union", layers: allLayers } },
    config: {},
    data: {
      neighbors: {
        source: typeSource(ONTOLOGY_TYPE),
        read: "neighbors",
        params: { node: { input: "selected" } },
      },
    },
  };

  const manifest: PanelManifest = {
    state: {
      selected: { type: { kind: "object-union", layers: allLayers }, personal: false, deepLink: true, external: true },
    },
    members: {
      relations: {
        target: { projectionId: "capability-relations" },
        inputs: { selected: { state: "selected" } },
        outputs: { selected: { state: "selected" } },
      },
    },
    events: {},
  };

  const actionNode = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };

  let failNext = false;
  let forbidNext = false;

  const { instance, element, reads } = mountDirect(
    manifest,
    { "capability-relations": relationsProjection },
    (request) => {
      if (forbidNext) return { status: "forbidden" };
      if (failNext) return { status: "error", message: "Upstream graph failed" };
      const node = request.inputs.selected as { className: string; primaryKey: string };
      if (node.primaryKey === "act-1") {
        return ready({
          node: actionNode,
          neighbors: [userNode],
          edges: [
            {
              id: "e-owner",
              relationKind: "action.hasOwner",
              from: { className: ACTION, primaryKey: "act-1" },
              to: { className: USER, primaryKey: "u-1" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [
            { relationKind: "action.hasOwner", status: "ok", edgeCount: 1 },
            { relationKind: "workflow.invokesAction", status: "refused", edgeCount: 0, reason: "Workflow denied" },
            { relationKind: "action.targetsObjectType", status: "failed", edgeCount: 0, reason: "Timeout" },
          ],
        });
      }
      return ready({
        node: userNode,
        neighbors: [],
        edges: [],
        relations: [{ relationKind: "action.hasOwner", status: "ok", edgeCount: 0 }],
      });
    },
    { initial: { selected: null } },
  );

  // Before a node is selected, requiredParams keeps neighbors awaiting with zero reads sent.
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-prompt")).not.toBeNull());
  expect(reads).toHaveLength(0);

  // Selecting a node triggers neighbors read and renders grouped relations and distinct refused / failed statuses.
  instance.state.set("selected", { className: ACTION, primaryKey: "act-1" });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-peer-name")?.textContent).toBe("Alice"));
  expect(element.querySelector("[data-relation-kind='workflow.invokesAction'] [data-status='refused']")?.textContent).toContain("Workflow denied");
  expect(element.querySelector("[data-relation-kind='action.targetsObjectType'] [data-status='failed']")?.textContent).toContain("Timeout");

  // Clicking peer writes full { className, primaryKey } identity, registers owner label, and re-reads neighbors via member data.
  element.querySelector<HTMLButtonElement>(".sdk-object-relations-peer")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual({ className: USER, primaryKey: "u-1" }));
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-subject")?.textContent).toBe("Alice"));
  expect(instance.pageContext.value.selection?.[0]?.label).toContain("Alice");
  expect(element.querySelector("[data-relation-kind='action.hasOwner'] [data-status='empty']")).not.toBeNull();
  expect(reads).toHaveLength(2);

  // Forbidden host read is shown distinctly.
  forbidNext = true;
  instance.state.set("selected", { className: ACTION, primaryKey: "act-2" });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations [data-status='forbidden']")).not.toBeNull());

  // Error host read surfaces the error message.
  forbidNext = false;
  failNext = true;
  instance.state.set("selected", { className: ACTION, primaryKey: "act-3" });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-error")?.textContent).toContain("Upstream graph failed"));
});

it("marks truncated customer Relationship neighbors (panelRelationNeighbors) on direct ObjectRelations", async () => {
  const relationProjection: ProductProjection = {
    ...meta,
    id: "customer-relations",
    name: "Customer relations",
    componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: { kind: "object", objectType: "Customer" } },
    outputs: { selected: { kind: "object", objectType: "Order" } },
    config: {},
    data: {
      neighbors: {
        source: { type: { kind: "Relationship", id: "places" } },
        read: "neighbors",
        params: { node: { input: "selected" } },
      },
    },
  };
  const manifest: PanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType: "Customer" }, personal: false, deepLink: false, external: false },
    },
    members: {
      relations: {
        target: { projectionId: "customer-relations" },
        inputs: { selected: { state: "selected" } },
      },
    },
    events: {},
  };
  const { element } = mountDirect(
    manifest,
    { "customer-relations": relationProjection },
    () => ready({
      node: { className: "Customer", primaryKey: "cust-1", label: "Acme", layer: "fact" },
      neighbors: [{ className: "Order", primaryKey: "ord-1", label: "Order #1", layer: "fact" }],
      edges: [
        {
          id: "rel-edge-1",
          relationKind: "places",
          from: { className: "Customer", primaryKey: "cust-1" },
          to: { className: "Order", primaryKey: "ord-1" },
          direction: "outgoing",
          derived: false,
        },
      ],
      relations: [{ relationKind: "places", status: "ok", edgeCount: 1, truncated: true }],
    }),
    { initial: { selected: { className: "Customer", primaryKey: "cust-1" } } },
  );
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-peer-name")?.textContent).toBe("Order #1"));
  expect(element.querySelector("[data-relation-kind='places']")?.getAttribute("data-truncated")).toBe("true");
});

it("draws direct OntologyGraph and ObjectRelations in a frame via frameMemberData and platformOntologyAdapters", async () => {
  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const { platformOntologyAdapters } = await import("../../../../../packages/apps-sdk/src/panel/platform-ontology");
  const { createPanelInstance } = await import("../../../../../packages/apps-sdk/src/panel/instance");
  const { panelContextKey } = await import("../../../../../packages/apps-sdk/src/panel/context");
  const { default: Projection } = await import("../../../../../packages/apps-sdk/src/panel/Projection.vue");

  const actionNode = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };

  const requests: string[] = [];
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const adapters = platformOntologyAdapters({
    request: async (path, init) => {
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/platform-ontology/start") return jsonResponse({ node: actionNode });
      if (path === "/platform-ontology/neighbors") {
        return jsonResponse({
          node: actionNode,
          neighbors: [userNode],
          edges: [
            {
              id: "e-frame-1",
              relationKind: "action.hasOwner",
              from: { className: ACTION, primaryKey: "act-1" },
              to: { className: USER, primaryKey: "u-1" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "action.hasOwner", status: "ok", edgeCount: 1 }],
        });
      }
      throw new Error(`Unexpected ontology request ${path}`);
    },
  });
  for (const adapter of adapters) registerPlatformObjectAdapter(adapter);

  const projections: Record<string, ProductProjection> = {
    "capability-graph": {
      ...meta,
      id: "capability-graph",
      name: "Capability map",
      componentId: "@ontomato/sdk:OntologyGraph",
      inputs: {
        mode: { kind: "scalar", type: "string" },
        selected: { kind: "object-union", layers: allLayers },
        node: { kind: "object-union", layers: allLayers },
        layers: { kind: "json" },
      },
      outputs: { selectedNode: { kind: "object-union", layers: allLayers } },
      config: { mode: "instance" },
      data: {
        start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
        neighbors: {
          source: typeSource(ONTOLOGY_TYPE),
          read: "neighbors",
          params: { node: { input: "node" }, layers: { input: "layers" } },
        },
      },
    },
    "capability-relations": {
      ...meta,
      id: "capability-relations",
      name: "Node relations",
      componentId: "@ontomato/sdk:ObjectRelations",
      inputs: { selected: { kind: "object-union", layers: allLayers } },
      outputs: { selected: { kind: "object-union", layers: allLayers } },
      config: {},
      data: {
        neighbors: {
          source: typeSource(ONTOLOGY_TYPE),
          read: "neighbors",
          params: { node: { input: "selected" } },
        },
      },
    },
  };

  const panel = definePanel({
    state: {
      selected: { type: { kind: "object-union", layers: allLayers }, deepLink: true },
      lastSource: { type: { kind: "scalar", type: "string" }, deepLink: false },
    },
    members: {
      graph: {
        target: { projectionId: "capability-graph" },
        inputs: { selected: { state: "selected" } },
        outputs: { selectedNode: { state: "selected" } },
      },
      relations: {
        target: { projectionId: "capability-relations" },
        inputs: { selected: { state: "selected" } },
        outputs: { selected: { state: "selected" } },
      },
    },
    events: {
      graphSelected: {
        on: { member: "graph", output: "selectedNode" },
        do: { set: { fields: { lastSource: { literal: "graph" } } } },
      },
      relationSelected: {
        on: { member: "relations", output: "selected" },
        do: { set: { fields: { lastSource: { literal: "relations" } } } },
      },
    },
  });

  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "capability-frame",
    url: () => "/capability",
    label: () => "Capability",
    ...noOperations,
    recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest: panel },
        manifest: panel,
        instance,
        projection: (id: string) => instance.projection(id),
        invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
        projectionsChanged: () => () => {},
        draft: instance.draft,
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
      });
      return () => h("div", [h(Projection, { slot: "graph" }), h(Projection, { slot: "relations" })]);
    },
  }))
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };

  // OntologyGraph loads start + neighbors via frameMemberData; ObjectRelations awaits selection.
  await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(2));
  expect(element.querySelector(".sdk-object-relations-prompt")).not.toBeNull();

  // Selecting the action node in the graph updates panel state, runs its declared event, and feeds ObjectRelations.
  canvasRecorder.emitSelect?.([encodeGraphNodeId(actionNode)]);
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-peer-name")?.textContent).toBe("Alice"));
  expect(instance.state.values.value.lastSource).toBe("graph");
  expect(requests).toContain("GET /platform-ontology/start");
  expect(requests).toContain("POST /platform-ontology/neighbors");

  // Clicking a peer in ObjectRelations moves selection and runs the declared relations output event.
  element.querySelector<HTMLButtonElement>(".sdk-object-relations-peer")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual({ className: USER, primaryKey: "u-1" }));
  expect(instance.state.values.value.lastSource).toBe("relations");
});

it("keeps newly discovered layers visible when OntologyGraph expands without declared layers", async () => {
  const ROLE = "platform:Role";
  const explicitTypes = { kind: "object-union" as const, objectTypes: [USER, ROLE, ACTION] as [string, ...string[]] };
  const graphProjection: ProductProjection = {
    ...meta,
    id: "dynamic-layers-graph",
    name: "Dynamic layers graph",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      start: explicitTypes,
      selected: explicitTypes,
      node: explicitTypes,
      layers: { kind: "json" },
    },
    outputs: { selectedNode: explicitTypes },
    config: {},
    data: {
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: { node: { input: "node" }, layers: { input: "layers" } } },
    },
  };
  const manifest: PanelManifest = {
    state: {
      selected: { type: explicitTypes, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId: "dynamic-layers-graph" },
        inputs: { selected: { state: "selected" } },
        outputs: { selectedNode: { state: "selected" } },
      },
    },
    events: {},
  };

  const alice = { className: USER, primaryKey: "u-alice", label: "Alice", layer: "governance" };
  const admin = { className: ROLE, primaryKey: "r-admin", label: "Admin", layer: "governance" };
  const approve = { className: ACTION, primaryKey: "act-approve", label: "Approve Order", layer: "capability" };
  const neighborLayerFilters: Array<unknown> = [];

  const { element } = mountDirect(manifest, { "dynamic-layers-graph": graphProjection }, (request) => {
    if (request.dataName === "start") return ready({ node: alice });
    if (request.dataName === "neighbors") {
      neighborLayerFilters.push(request.inputs.layers);
      const node = request.inputs.node as { className: string; primaryKey: string };
      if (node.className === USER) {
        return ready({
          node: alice,
          neighbors: [admin],
          edges: [{ id: "e-1", relationKind: "user.holdsRole", from: { className: USER, primaryKey: "u-alice" }, to: { className: ROLE, primaryKey: "r-admin" }, direction: "outgoing", derived: false }],
          relations: [{ relationKind: "user.holdsRole", status: "ok", edgeCount: 1 }],
        });
      }
      return ready({
        node: admin,
        neighbors: [approve],
        edges: [{ id: "e-2", relationKind: "role.canExecuteAction", from: { className: ROLE, primaryKey: "r-admin" }, to: { className: ACTION, primaryKey: "act-approve" }, direction: "outgoing", derived: false }],
        relations: [{ relationKind: "role.canExecuteAction", status: "ok", edgeCount: 1 }],
      });
    }
    throw new Error(`Unexpected read ${request.dataName}`);
  });

  // Initial load discovers only "governance" from Alice + Admin.
  await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(2));

  // Expanding Admin reaches Approve Order in "capability" without filtering out the new layer or sending layers=["governance"].
  canvasRecorder.emitSelect?.([encodeGraphNodeId(admin)]);
  await vi.waitFor(() => expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Admin", "Alice", "Approve Order"]));
  expect(neighborLayerFilters).toEqual([undefined, undefined]);

  // Manually toggling off "capability" still hides Approve Order.
  element.querySelector<HTMLButtonElement>("[data-graph-layer='capability']")!.click();
  await nextTick();
  expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Admin", "Alice"]);
});
