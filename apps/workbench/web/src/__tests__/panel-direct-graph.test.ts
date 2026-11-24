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
  ONTOLOGY_RELATION_KIND,
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
  options: {
    initial?: Record<string, unknown>;
    members?: readonly string[];
    memberSlots?: (instance: ReturnType<typeof createDirectPanelInstance>) => Record<string, Record<string, () => ReturnType<typeof h>[]>>;
  } = {},
) {
  const reads: Read[] = [];
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "direct-graph",
    url: () => "/direct-graph",
    label: () => "Direct Graph",
    initial: options.initial as never,
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
  const resolvedSlots = options.memberSlots?.(instance);
  const app = createApp({
    setup: () => () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member, key: member }, resolvedSlots?.[member]))),
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
      scope: { target: { projectionId: "agent-data-scope" } },
    },
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
          save: { method: "PUT", path: "/agents/:id", bodySchema: {} },
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
    {
      initial: { selectedAgent: { className: AGENT_DEFINITION, primaryKey: "agent-1" } },
      members: ["definition"],
      memberSlots: (inst) => ({ definition: { "field-classNames": () => [h(PanelMember, { instance: inst, member: "scope" })] } }),
    },
  );

  const adjacentBtn = await vi.waitFor(() => {
    const button = element.querySelector<HTMLButtonElement>(".sdk-object-graph-adjacent");
    if (!button || button.disabled) throw new Error("Direct PanelMember ObjectGraph adjacent button is not ready");
    return button;
  }, { timeout: 5000 });
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
        save: { method: "PUT" as const, path: "/agents/:id", bodySchema: {} },
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
      scope: { target: { projectionId: "agent-data-scope" }, inputs: {} },
    },
  });

  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "agent-settings",
    url: () => "/agents",
    label: () => "Agents",
    initial: { selectedAgent: { className: AGENT_DEFINITION, primaryKey: "agent-1" } },
    ...noOperations,
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
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        notify: () => { throw new Error("This test tells the reader nothing"); },
        readPanelData: async (request) => {
          if (request.operations) {
            return ready({
              save: {
                kind: "form.save",
                handlerRef: `${AGENT_DEFINITION}.save`,
                label: "Save",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            });
          }
          throw new Error("This test reads no member data through the platform");
        },
        navigate: async () => { throw new Error("This test opens no address"); },
        // A frame panel's own frame is not an application's frame: no current entry, no menu.
        currentEntry: computed(() => null), entryMenu: computed(() => null),
      });
      return () => h("div", [h(Projection, { slot: "definition" }, { "field-classNames": () => h(Projection, { slot: "scope" }) })]);
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
  const { formFieldSlotKey } = await import("../../../../../packages/apps-sdk/src/panel/slot-context");

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
      scope: { target: { projectionId: "agent-data-scope" }, inputs: {} },
    },
  });
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "agent-settings",
    url: () => "/agents",
    label: () => "Agents",
    ...noOperations,
    readProjection: async () => scopeProjection,
  });
  const chooseScope = vi.fn();
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
      dirty: ref(false),
      dirtyFields: ref(new Set<string>()),
      submitting: ref(false),
      canSubmit: ref(false),
      set: chooseScope,
      refreshDraft: async () => {},
      submit: async () => ({}),
      reset: async () => true,
    },
    submit: async () => ({}),
    dirty: () => false,
    editingTarget: () => null,
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
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        notify: () => { throw new Error("This test tells the reader nothing"); }, readPanelData: async () => { throw new Error("This test reads no member data through the platform"); }, navigate: async () => { throw new Error("This test opens no address"); },
        // A frame panel's own frame is not an application's frame: no current entry, no menu.
        currentEntry: computed(() => null), entryMenu: computed(() => null),
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
      provide(formFieldSlotKey, {
        formSlot: "definition",
        path: computed(() => "/classNames"),
        field: computed(() => ({
          path: "/classNames",
          label: "Data scope",
          control: { kind: "string-array" as const },
          valueSchema: {},
          required: false,
          readOnly: false,
        })),
        index: computed(() => undefined),
      });
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

  // Ready nodes with a forbidden edges datum keep all readable nodes and show a non-blocking notice instead of a blocking error.
  nodesState.value = { status: "ready", value: [{ primaryKey: "Order", label: "Order", fields: {} }] };
  edgesState.value = { status: "forbidden" };
  await nextTick();
  expect(element.querySelector(".el-form-item__error")?.textContent?.trim() ?? "").toBe("");
  expect(element.querySelector(".el-empty")).toBeNull();
  expect(element.textContent).toContain("Order");
  expect(element.querySelector("[data-graph-edges-notice]")?.textContent?.trim()).toBe(publicEn.platform.graphEdgesForbidden);

  // Ready nodes with an empty edges datum still draw the nodes rather than collapsing to an empty graph.
  edgesState.value = { status: "empty" };
  await nextTick();
  expect(element.querySelector("[data-graph-edges-notice]")).toBeNull();
  expect(element.querySelector(".el-empty")).toBeNull();
  expect(element.textContent).toContain("Order");

  // The choice summed up over the graph, its looks named under it, and the same choice offered as a list for a reader
  // who would rather pick from names (原页面对照《智能体设置》, 2026-11-22).
  expect(element.querySelector(".sdk-object-graph-summary")?.textContent?.trim()).toBe("None chosen");
  expect([...element.querySelectorAll(".sdk-object-graph-legend > span")].map((item) => item.textContent?.trim())).toEqual(["Chosen", "Adjacent", "Not chosen"]);
  element.querySelector<HTMLElement>(".sdk-object-graph-list .el-select__wrapper")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const order = await vi.waitFor(() => {
    const item = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((option) => option.textContent?.trim() === "Order");
    if (!item) throw new Error("Order is not offered");
    return item;
  });
  order.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(chooseScope).toHaveBeenCalledWith("/classNames", ["Order"]));
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

it("shows truncated edges alongside a refused direction and hides an unbound start action", async () => {
  const relationProjection: ProductProjection = {
    ...meta,
    id: "customer-relations",
    name: "Customer relations",
    componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: { kind: "object", objectType: "Customer" } },
    outputs: { start: { kind: "object", objectType: "Customer" } },
    config: { showSummary: true, allowSetStart: false },
    data: {
      neighbors: {
        source: { type: { kind: "Relationship", id: "refers" } },
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
  };
  const { instance, element } = mountDirect(
    manifest,
    { "customer-relations": relationProjection },
    ({ inputs }) => {
      const node = inputs.selected as { className: string; primaryKey: string };
      return ready({
        node: { ...node, label: "Acme", typeLabel: "Customer account", layer: "fact" },
        neighbors: [{ className: "Customer", primaryKey: "cust-2", label: "Globex", typeLabel: "Customer account", layer: "fact" }],
        edges: [
          {
            id: "rel-edge-1",
            relationKind: "refers",
            label: "Referral edge",
            from: node,
            to: { className: "Customer", primaryKey: "cust-2" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [{
          relationKind: "refers", label: "Referrals", status: "refused",
          reason: "Incoming referrals require permission", edgeCount: 1, truncated: node.primaryKey === "cust-1",
        }],
      });
    },
    { initial: { selected: { className: "Customer", primaryKey: "cust-0" } } },
  );
  await vi.waitFor(() => expect(instance.outputs.relations?.edgeCount).toBe(1));
  instance.state.set("selected", { className: "Customer", primaryKey: "cust-1" });
  await vi.waitFor(() => expect(instance.outputs.relations.edgeCount).toBeNull());
  const group = element.querySelector('[data-relation-kind="refers"][data-status="refused"][data-truncated="true"]')!;
  expect(group.querySelector(".sdk-object-relations-peer-name")?.textContent).toBe("Globex");
  expect(group.querySelector(".sdk-object-relations-reason")?.textContent).toBe("Incoming referrals require permission");
  expect(group.querySelector(".sdk-object-relations-kind")?.textContent).toBe("Referrals");
  expect(group.querySelector(".sdk-object-relations-peer-type")?.textContent).toBe("Customer account");
  expect(element.querySelector(".sdk-object-relations-type")?.textContent).toBe("Customer account");
  expect(group.querySelector(".sdk-object-relations-count")?.textContent?.trim())
    .toBe(publicEn.platform.relationsGroupTruncated.replace("{count}", "1"));
  expect(element.querySelector(".sdk-object-relations-summary-count")?.textContent?.trim())
    .toBe(publicEn.platform.relationsSummaryTruncated.replace("{count}", "1"));
  expect(instance.outputs.relations.edgeCount).toBeNull();
  expect(group.querySelector(".sdk-object-relations-set-start")).toBeNull();
});

it("syncs string relation kinds from education panel state to ObjectRelations and back", async () => {
  const selection = { kind: "object-union", objectTypes: ["Student", "Class", "Course"] } satisfies ProductProjection["inputs"][string];
  const kinds = { kind: "list", items: { kind: "scalar", type: "string" } } as const;
  const projection: ProductProjection = {
    ...meta, id: "class-relations", name: "Class Relations", componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: selection, visibleRelationKinds: kinds },
    outputs: { visibleRelationKinds: kinds },
    config: { showRelationFilter: true },
    data: { neighbors: {
      source: { type: { kind: "Relationship", id: "covers" } }, read: "neighbors",
      params: { node: { input: "selected" } },
    } },
  };
  const manifest = definePanel({
    state: {
      selected: { type: selection },
      kinds: { type: kinds },
    },
    members: {
      relations: {
        target: { projectionId: projection.id },
        inputs: { selected: { state: "selected" }, visibleRelationKinds: { state: "kinds" } },
        outputs: { visibleRelationKinds: { state: "kinds" } },
      },
    },
  });
  const node = { className: "Class", primaryKey: "class-1" };
  const course = { className: "Course", primaryKey: "course-1" };
  const { instance, element } = mountDirect(manifest, { [projection.id]: projection }, () => ready({
    node: { ...node, label: "Class 1", layer: "fact" },
    neighbors: [{ ...course, label: "Course 1", layer: "fact" }],
    edges: [{ id: "class-1-covers-course-1", relationKind: "covers", from: node, to: course, direction: "outgoing", derived: false }],
    relations: [{ relationKind: "covers", status: "ok", edgeCount: 1, truncated: false }],
  }), { initial: { selected: node } });

  const group = '[data-relation-kind="covers"]';
  await vi.waitFor(() => expect(element.querySelector(group)).not.toBeNull());
  expect(instance.outputs.relations.edgeCount).toBe(1);
  instance.state.set("kinds", ["enrolledIn"]);
  await vi.waitFor(() => expect(element.querySelector('[data-status="filtered-empty"]')).not.toBeNull());
  element.querySelector<HTMLElement>(".sdk-object-relations-filter-select .el-select__wrapper")!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".el-select-dropdown__item")).toHaveLength(2));
  const options = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")];
  options.find(option => option.textContent?.trim() === "covers")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.kinds).toEqual(["enrolledIn", "covers"]));
  expect(element.querySelector(group)).not.toBeNull();
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
  });

  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "capability-frame",
    url: () => "/capability",
    label: () => "Capability",
    ...noOperations,
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
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
        notify: () => { throw new Error("This test tells the reader nothing"); }, readPanelData: async () => { throw new Error("This test reads no member data through the platform"); }, navigate: async () => { throw new Error("This test opens no address"); },
        // A frame panel's own frame is not an application's frame: no current entry, no menu.
        currentEntry: computed(() => null), entryMenu: computed(() => null),
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

  // Selecting the action node in the graph updates panel state and feeds ObjectRelations.
  canvasRecorder.emitSelect?.([encodeGraphNodeId(actionNode)]);
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-relations-peer-name")?.textContent).toBe("Alice"));
  expect(requests).toContain("GET /platform-ontology/start");
  expect(requests).toContain("POST /platform-ontology/neighbors");

  // Clicking a peer in ObjectRelations moves selection.
  element.querySelector<HTMLButtonElement>(".sdk-object-relations-peer")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual({ className: USER, primaryKey: "u-1" }));
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

/*
 * The relation kinds the graph draws follow the panel's state (M3's capability map, 2026-11-21): the page's own kind
 * filter writes a list of relation kinds, and the canvas draws only those — their edges between types, and in instance
 * mode only the neighbors they reach. Holding nothing, every kind is drawn; the graph's own reads are unchanged.
 */
it("draws only the relation kinds the panel's state holds, in type and instance modes", async () => {
  const kindsType = { kind: "list" as const, items: { kind: "object" as const, objectType: ONTOLOGY_RELATION_KIND } };
  const graphProjection: ProductProjection = {
    ...meta, id: "kinds-graph", name: "Kinds", componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { mode: { kind: "scalar", type: "string" }, node: { kind: "object-union", layers: allLayers } },
    outputs: { visibleRelationKinds: kindsType },
    config: {},
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      counts: { source: typeSource(ONTOLOGY_TYPE), read: "counts", params: {} },
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: { node: { input: "node" } } },
    },
  };
  const manifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false, default: "type" },
      kinds: { type: kindsType, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: { target: { projectionId: "kinds-graph" }, inputs: { mode: { state: "mode" } }, outputs: { visibleRelationKinds: { state: "kinds" } } },
    },
  };
  const actionNode = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const workflowNode = { className: WORKFLOW, primaryKey: "wf-1", label: "Order Pipeline", layer: "capability" as const };
  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };
  const { instance } = mountDirect(manifest, { "kinds-graph": graphProjection }, (request) => {
    if (request.dataName === "schema") return ready({
      layers: ["capability", "governance"],
      objectTypes: [
        { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
        { id: WORKFLOW, layer: "capability", labelKey: "platformOntology.types.workflow" },
        { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
      ],
      relationKinds: [
        { id: "action.hasOwner", from: ACTION, to: USER, derived: false, owner: "java-action", labelKey: "platformOntology.relations.actionHasOwner" },
        { id: "workflow.invokesAction", from: WORKFLOW, to: ACTION, derived: true, owner: "java-workflow", labelKey: "platformOntology.relations.workflowInvokesAction" },
      ],
    });
    if (request.dataName === "counts") return ready({ counts: [] });
    if (request.dataName === "start") return ready({ node: actionNode });
    return ready({
      node: actionNode, neighbors: [workflowNode, userNode],
      edges: [
        { id: "e-1", relationKind: "workflow.invokesAction", from: { className: WORKFLOW, primaryKey: "wf-1" }, to: { className: ACTION, primaryKey: "act-1" }, direction: "incoming", derived: true },
        { id: "e-2", relationKind: "action.hasOwner", from: { className: ACTION, primaryKey: "act-1" }, to: { className: USER, primaryKey: "u-1" }, direction: "outgoing", derived: false },
      ],
      relations: [{ relationKind: "workflow.invokesAction", status: "ok", edgeCount: 1 }, { relationKind: "action.hasOwner", status: "ok", edgeCount: 1 }],
    });
  });
  const kind = (id: string) => ({ className: ONTOLOGY_RELATION_KIND, primaryKey: id });
  const edgeKinds = () => canvasRecorder.edges.map((edge) => edge.id.split(":")[0]).sort();

  // Type mode: every kind while the state holds none, then only the kinds it holds.
  await vi.waitFor(() => expect(edgeKinds()).toEqual(["action.hasOwner", "workflow.invokesAction"]));
  instance.state.set("kinds", [kind("action.hasOwner")]);
  await vi.waitFor(() => expect(edgeKinds()).toEqual(["action.hasOwner"]));

  // Instance mode: only the neighbor an edge of a kind shown reaches, beside the start.
  instance.state.set("mode", "instance");
  await vi.waitFor(() => expect(canvasRecorder.edges.map((edge) => edge.id)).toEqual(["e-2"]));
  expect(canvasRecorder.nodes.map((node) => node.id).sort()).toEqual([encodeGraphNodeId(actionNode), encodeGraphNodeId(userNode)].sort());
  instance.state.set("kinds", null);
  await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(3));
  expect(canvasRecorder.edges.map((edge) => edge.id).sort()).toEqual(["e-1", "e-2"]);
});

it("syncs visibleRelationKinds bidirectionally between direct ObjectRelations and OntologyGraph and promotes start via bound start output", async () => {
  const nodeUnion = { kind: "object-union" as const, layers: allLayers };
  const kindsType = { kind: "list" as const, items: { kind: "object" as const, objectType: ONTOLOGY_RELATION_KIND } };
  const graphProjection: ProductProjection = {
    ...meta, id: "sync-graph", name: "Sync Graph", componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { mode: { kind: "scalar", type: "string" }, start: nodeUnion, selected: nodeUnion, node: nodeUnion },
    outputs: { selected: nodeUnion, visibleRelationKinds: kindsType },
    config: {},
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      counts: { source: typeSource(ONTOLOGY_TYPE), read: "counts", params: {} },
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: { node: { input: "node" } } },
    },
  };
  const relationsProjection: ProductProjection = {
    ...meta, id: "sync-relations", name: "Sync Relations", componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: nodeUnion, visibleRelationKinds: kindsType },
    outputs: { selected: nodeUnion, start: nodeUnion, visibleRelationKinds: kindsType },
    config: { showRelationFilter: true, showSummary: true, collapseEmptyGroups: true },
    data: {
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: { node: { input: "selected" } } },
    },
  };
  const manifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "instance" },
      start: { type: nodeUnion, personal: false, deepLink: false, external: false },
      selected: { type: nodeUnion, personal: false, deepLink: false, external: false },
      kinds: { type: kindsType, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId: "sync-graph" },
        inputs: { mode: { state: "mode" }, start: { state: "start" }, selected: { state: "selected" } },
        outputs: { selected: { state: "selected" }, visibleRelationKinds: { state: "kinds" } },
      },
      relations: {
        target: { projectionId: "sync-relations" },
        inputs: { selected: { state: "selected" }, visibleRelationKinds: { state: "kinds" } },
        outputs: { selected: { state: "selected" }, start: { state: "start" }, visibleRelationKinds: { state: "kinds" } },
      },
    },
  };
  const actionNode = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const workflowNode = { className: WORKFLOW, primaryKey: "wf-1", label: "Order Pipeline", layer: "capability" as const };
  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };

  const { instance, element } = mountDirect(
    manifest,
    { "sync-graph": graphProjection, "sync-relations": relationsProjection },
    (request) => {
      if (request.dataName === "schema") return ready({
        layers: ["capability", "governance"],
        objectTypes: [
          { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
          { id: WORKFLOW, layer: "capability", labelKey: "platformOntology.types.workflow" },
          { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
        ],
        relationKinds: [
          { id: "action.hasOwner", from: ACTION, to: USER, derived: false, owner: "java-action", labelKey: "platformOntology.relations.actionHasOwner" },
          { id: "workflow.invokesAction", from: WORKFLOW, to: ACTION, derived: true, owner: "java-workflow", labelKey: "platformOntology.relations.workflowInvokesAction" },
        ],
      });
      if (request.dataName === "counts") return ready({ counts: [] });
      if (request.dataName === "start") return ready({ node: actionNode });
      return ready({
        node: actionNode,
        neighbors: [workflowNode, userNode],
        edges: [
          { id: "e-1", relationKind: "workflow.invokesAction", from: { className: WORKFLOW, primaryKey: "wf-1" }, to: { className: ACTION, primaryKey: "act-1" }, direction: "incoming", derived: true },
          { id: "e-2", relationKind: "action.hasOwner", from: { className: ACTION, primaryKey: "act-1" }, to: { className: USER, primaryKey: "u-1" }, direction: "outgoing", derived: false },
        ],
        relations: [
          { relationKind: "workflow.invokesAction", status: "ok", edgeCount: 1 },
          { relationKind: "action.hasOwner", status: "ok", edgeCount: 1 },
        ],
      });
    },
  );

  // Select Approve Order so both graph and relations show both relation kinds
  instance.state.set("selected", { className: ACTION, primaryKey: "act-1" });
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-relations-group")).toHaveLength(2));
  await vi.waitFor(() => expect(canvasRecorder.edges.map((edge) => edge.id).sort()).toEqual(["e-1", "e-2"]));

  // Changing the ObjectRelations multi-select filter updates shared panel state and filters OntologyGraph too
  const selectTrigger = element.querySelector<HTMLElement>(".sdk-object-relations-filter-select .el-select__wrapper")
    ?? element.querySelector<HTMLElement>(".sdk-object-relations-filter-select");
  expect(selectTrigger).not.toBeNull();
  selectTrigger!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".el-select-dropdown__item").length).toBeGreaterThanOrEqual(2));
  const ownerOption = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((item) =>
    item.textContent?.includes("action.hasOwner") || item.textContent?.toLowerCase().includes("owner"),
  );
  expect(ownerOption).not.toBeUndefined();
  ownerOption!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-relations-group")).toHaveLength(1));
  expect(element.querySelector(".sdk-object-relations-group")?.getAttribute("data-relation-kind")).toBe("action.hasOwner");
  await vi.waitFor(() => expect(canvasRecorder.edges.map((edge) => edge.id)).toEqual(["e-2"]));
  expect(instance.state.values.value.kinds).toEqual([
    { className: ONTOLOGY_RELATION_KIND, primaryKey: "action.hasOwner" },
  ]);

  // "Set as start" button is shown automatically because outputs.start is bound, and promotes Alice to start
  const setStartButton = element.querySelector<HTMLButtonElement>(
    '[data-relation-kind="action.hasOwner"] .sdk-object-relations-set-start',
  )!;
  expect(setStartButton).not.toBeNull();
  setStartButton.click();
  await vi.waitFor(() =>
    expect(instance.state.values.value.start).toEqual({ className: USER, primaryKey: "u-1" }),
  );

  // Clearing the selected option resets visibleRelationKinds to null and restores all groups & graph edges
  ownerOption!.click();
  await vi.waitFor(() => expect(instance.state.values.value.kinds).toBeNull());
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-relations-group")).toHaveLength(2));
  await vi.waitFor(() => expect(canvasRecorder.edges.map((edge) => edge.id).sort()).toEqual(["e-1", "e-2"]));
});

it("syncs visibleLayers and expandedNodes bidirectionally and publishes startLabel, startDetail, and visibleRelationKindLabels read-only outputs", async () => {
  const nodeUnion = { kind: "object-union" as const, layers: allLayers, objectTypes: [ONTOLOGY_TYPE] };
  const stringList = { kind: "list" as const, items: { kind: "scalar" as const, type: "string" as const } };
  const nodeList = { kind: "list" as const, items: nodeUnion };
  const kindsType = { kind: "list" as const, items: { kind: "object" as const, objectType: ONTOLOGY_RELATION_KIND } };

  const graphProjection: ProductProjection = {
    ...meta,
    id: "stateful-graph",
    name: "Stateful Graph",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      mode: { kind: "scalar", type: "string" },
      start: nodeUnion,
      selected: nodeUnion,
      visibleLayers: stringList,
      expandedNodes: nodeList,
    },
    outputs: {
      selected: nodeUnion,
      visibleRelationKinds: kindsType,
      visibleLayers: stringList,
      expandedNodes: nodeList,
    },
    config: { showLayerFilter: true },
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      counts: { source: typeSource(ONTOLOGY_TYPE), read: "counts", params: {} },
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: {} },
    },
  };

  const manifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "instance" },
      start: { type: nodeUnion, personal: false, deepLink: false, external: false },
      selected: { type: nodeUnion, personal: false, deepLink: false, external: false },
      kinds: { type: kindsType, personal: false, deepLink: false, external: false },
      visibleLayers: { type: stringList, personal: false, deepLink: false, external: false },
      expandedNodes: { type: nodeList, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId: "stateful-graph" },
        inputs: {
          mode: { state: "mode" },
          start: { state: "start" },
          selected: { state: "selected" },
          visibleLayers: { state: "visibleLayers" },
          expandedNodes: { state: "expandedNodes" },
        },
        outputs: {
          selected: { state: "selected" },
          visibleRelationKinds: { state: "kinds" },
          visibleLayers: { state: "visibleLayers" },
          expandedNodes: { state: "expandedNodes" },
        },
      },
    },
  };

  const userNode = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" as const };
  const actionOne = { className: ACTION, primaryKey: "act-1", label: "Approve Order", layer: "capability" as const };
  const actionTwo = { className: ACTION, primaryKey: "act-2", label: "Approve Order", layer: "capability" as const };
  const orderType = { className: OBJECT_TYPE, primaryKey: "Order", label: "Order", layer: "fact" as const };
  const neighborReads: Array<{ node: { className: string; primaryKey: string }; layers?: string[] }> = [];

  const { instance, element } = mountDirect(
    manifest,
    { "stateful-graph": graphProjection },
    (request) => {
      if (request.dataName === "schema") {
        return ready({
          layers: ["fact", "capability", "governance", "product"],
          objectTypes: [
            { id: OBJECT_TYPE, layer: "fact", labelKey: "platformOntology.types.objectType" },
            { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
            { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
          ],
          relationKinds: [
            { id: "action.hasOwner", from: ACTION, to: USER, derived: false, owner: "java", labelKey: "Owned by user" },
            { id: "action.targetsObject", from: ACTION, to: OBJECT_TYPE, derived: false, owner: "java", labelKey: "platformOntology.relations.action.targets-object-type" },
          ],
        });
      }
      if (request.dataName === "counts") return ready({ counts: [] });
      if (request.dataName === "start") return ready({ node: userNode });
      const node = (request.runtimeParams?.node ?? request.inputs.node) as { className: string; primaryKey: string };
      const layers = (request.runtimeParams?.layers ?? request.inputs.layers) as string[] | undefined;
      neighborReads.push({ node, layers });
      if (node.className === USER && node.primaryKey === "u-1") {
        const allowCapability = !layers || layers.includes("capability");
        return ready({
          node: userNode,
          neighbors: allowCapability ? [actionOne] : [],
          edges: allowCapability
            ? [{ id: "e-u-act", relationKind: "action.hasOwner", from: { className: ACTION, primaryKey: "act-1" }, to: { className: USER, primaryKey: "u-1" }, direction: "incoming", derived: false }]
            : [],
          relations: [{ relationKind: "action.hasOwner", status: "ok", edgeCount: allowCapability ? 1 : 0 }],
        });
      }
      if (node.className === ACTION && node.primaryKey === "act-1") {
        return ready({
          node: actionOne,
          neighbors: [userNode, orderType],
          edges: [
            { id: "e-act-order", relationKind: "action.targetsObject", from: { className: ACTION, primaryKey: "act-1" }, to: { className: OBJECT_TYPE, primaryKey: "Order" }, direction: "outgoing", derived: false },
          ],
          relations: [{ relationKind: "action.targetsObject", status: "ok", edgeCount: 1 }],
        });
      }
      return ready({
        node: actionTwo,
        neighbors: [],
        edges: [],
        relations: [],
      });
    },
    { initial: { visibleLayers: ["governance"] } },
  );

  // 1) Initial visibleLayers=["governance"] restricts initial neighbor fetch and hides capability layer.
  await vi.waitFor(() => {
    expect(instance.outputs.graph?.startLabel).toBe("Alice");
    expect(instance.outputs.graph?.startDetail).toContain("u-1");
    expect(canvasRecorder.nodes.map((n) => n.id)).toEqual([encodeGraphNodeId(userNode)]);
  });

  // 2) Agent updating visibleLayers adds "capability" -> backfills neighbors for already expanded root.
  instance.state.set("visibleLayers", ["fact", "capability", "governance"]);
  await vi.waitFor(() => {
    expect(canvasRecorder.nodes.map((n) => n.id).sort()).toEqual([
      encodeGraphNodeId(actionOne),
      encodeGraphNodeId(userNode),
    ].sort());
  });
  expect(neighborReads.some((entry) => entry.layers?.includes("capability"))).toBe(true);

  // 3) Human toggling a layer pill writes back to visibleLayers state.
  const productPill = element.querySelector<HTMLButtonElement>('[data-graph-layer="product"]')!;
  expect(productPill).not.toBeNull();
  productPill.click();
  await vi.waitFor(() => expect(instance.state.values.value.visibleLayers).toBeNull());

  // 4) Human clicking a neighbor expands 1 hop and writes it to expandedNodes state.
  canvasRecorder.emitSelect?.([encodeGraphNodeId(actionOne)]);
  await vi.waitFor(() => {
    expect(instance.state.values.value.expandedNodes).toEqual([{ className: ACTION, primaryKey: "act-1" }]);
    expect(canvasRecorder.nodes.map((n) => n.id)).toContain(encodeGraphNodeId(orderType));
  });

  // 5) Agent clearing expandedNodes rebuilds subgraph back to start only; agent setting expandedNodes reproduces it.
  instance.state.set("expandedNodes", null);
  await vi.waitFor(() => {
    expect(canvasRecorder.nodes.map((n) => n.id)).not.toContain(encodeGraphNodeId(orderType));
  });
  instance.state.set("expandedNodes", [{ className: ACTION, primaryKey: "act-1" }]);
  await vi.waitFor(() => {
    expect(canvasRecorder.nodes.map((n) => n.id)).toContain(encodeGraphNodeId(orderType));
  });

  // 6) Two same-name custom start nodes publish distinct startDetail outputs.
  instance.state.setState({ start: { className: ACTION, primaryKey: "act-1" }, expandedNodes: null });
  await vi.waitFor(() => {
    expect(instance.outputs.graph?.startLabel).toBe("Approve Order");
    expect(instance.outputs.graph?.startDetail).toBe("Action · act-1");
  });
  instance.state.setState({ start: { className: ACTION, primaryKey: "act-2" }, expandedNodes: null });
  await vi.waitFor(() => {
    expect(instance.outputs.graph?.startLabel).toBe("Approve Order");
    expect(instance.outputs.graph?.startDetail).toBe("Action · act-2");
  });

  // 7) Type mode publishes localized visibleRelationKindLabels from schema.relationKinds.
  instance.state.setState({
    mode: "type",
    kinds: [{ className: ONTOLOGY_RELATION_KIND, primaryKey: "action.targetsObject" }],
  });
  await vi.waitFor(() => {
    expect(instance.outputs.graph?.visibleRelationKindLabels).toEqual(["Targets object type"]);
    expect(instance.outputs.graph?.startLabel).toBeNull();
    expect(instance.outputs.graph?.startDetail).toBeNull();
  });
  instance.state.set("kinds", null);
  await vi.waitFor(() => {
    expect(instance.outputs.graph?.visibleRelationKindLabels).toEqual([]);
  });
});
