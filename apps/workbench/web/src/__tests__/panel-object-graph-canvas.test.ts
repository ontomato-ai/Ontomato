import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * The graph canvas a panel places as a member (2026-11-21, the ontology graph and visual modeling on one canvas): the
 * owner's classes and relationships, read through the projection, drawn on the platform's G6 canvas. A chosen class or
 * relationship is the panel's state of that type; on an editable graph a line drawn from one class to another hands the
 * panel its two ends for the owner's new-relationship form; where the reader puts the classes is the reader's own, kept
 * per person and drawn again from there.
 *
 * G6 is replaced by a recorder (happy-dom cannot draw): what is checked is what the member hands the canvas and what it
 * makes of what the canvas reports.
 */

const canvas = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  selectedEdges: [] as readonly string[],
  editable: false,
  emit: null as null | ((event: string, ...args: unknown[]) => void),
};
vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>("@ontomato/foundation-ui/graph/g6");
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true }, nodes: { type: Array, required: true }, edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] }, selectedEdges: { type: Array, default: () => [] },
      selection: { type: String, default: "single" }, layout: { type: Object, default: () => ({ type: "grid" }) },
      editable: { type: Boolean, default: false }, maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "update:selectedEdges", "blank", "connect", "move", "activate", "viewport"],
    setup(props, { emit, expose }) {
      canvas.emit = emit as never;
      expose({ fit: async () => {}, relayout: async () => {}, exportImage: async () => new Blob(["png"], { type: "image/png" }) });
      return () => {
        canvas.nodes = props.nodes as never;
        canvas.edges = props.edges as never;
        canvas.selected = props.selected as never;
        canvas.selectedEdges = props.selectedEdges as never;
        canvas.editable = props.editable;
        return h("div", { class: "mock-g6-canvas" });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const graph = (editable: boolean): DirectProjection => ({
  ...record, id: editable ? "model-graph-editable" : "model-graph", name: "Model graph", componentId: "@ontomato/sdk:ObjectGraph",
  inputs: {}, outputs: {
    selectedNode: { kind: "object", objectType: OBJECT_TYPE }, selectedEdge: { kind: "object", objectType: RELATIONSHIP },
    connectFrom: { kind: "scalar", type: "string" }, connectTo: { kind: "scalar", type: "string" },
    positions: { kind: "node-positions" },
  },
  config: { edgeEnds: { source: "/fromclass", target: "/toclass" }, ...(editable ? { editable: true } : {}) },
  data: {
    nodes: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
    edges: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} },
  },
});
const manifest = (projectionId: string): DirectPanelManifest => ({
  state: {
    selectedClass: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: true, external: false },
    selectedRelation: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: true, external: false },
    connectFrom: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    connectTo: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    positions: { type: { kind: "node-positions" }, personal: true, deepLink: false, external: false },
  },
  members: {
    graph: {
      target: { projectionId },
      outputs: {
        selectedNode: { state: "selectedClass" }, selectedEdge: { state: "selectedRelation" },
        connectFrom: { state: "connectFrom" }, connectTo: { state: "connectTo" }, positions: { state: "positions" },
      },
    },
  },
  commands: {},
});
const classes = [
  { primaryKey: "org", label: "Organization", fields: {} },
  { primaryKey: "person", label: "Person", fields: {} },
];
const relations = [{ primaryKey: "works-in", label: "Works in", fields: { fromclass: "person", toclass: "org" } }];
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.innerHTML = "";
  Object.assign(canvas, { nodes: [], edges: [], selected: [], selectedEdges: [], editable: false, emit: null });
});

function mount(editable: boolean, initial: Record<string, unknown> = {}) {
  const projection = graph(editable);
  const instance = createDirectPanelInstance(manifest(projection.id), {
    pageKey: "modeling", url: () => "/modeling", label: () => "Modeling", initial: initial as never,
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => {
      if (request.operations) return ready({});
      return ready(request.dataName === "nodes" ? classes : relations);
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "graph" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  mounted.push(app);
  return { instance, element };
}

it("draws the owner's classes and relationships on the platform's canvas, and a choice is the panel's state of its type", async () => {
  const { instance } = mount(false);
  await vi.waitFor(() => expect(canvas.nodes.map((node) => node.id)).toEqual(["org", "person"]));
  expect(canvas.edges.map(({ id, source, target }) => ({ id, source, target }))).toEqual([{ id: "works-in", source: "person", target: "org" }]);
  expect(canvas.editable).toBe(false);

  canvas.emit!("update:selected", ["person"]);
  await nextTick();
  expect(instance.state.values.value.selectedClass).toEqual({ className: OBJECT_TYPE, primaryKey: "person" });
  expect(canvas.selected).toEqual(["person"]);
  canvas.emit!("update:selectedEdges", ["works-in"]);
  await nextTick();
  expect(instance.state.values.value.selectedRelation).toEqual({ className: RELATIONSHIP, primaryKey: "works-in" });
  canvas.emit!("blank");
  await nextTick();
  expect(instance.state.values.value).toMatchObject({ selectedClass: null, selectedRelation: null });
});

it("hands the panel a new relationship's two ends only where it is editable, and keeps where the reader put the classes", async () => {
  const { instance } = mount(true, { positions: { org: { x: 400, y: 120 } } });
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  expect(canvas.editable).toBe(true);
  // A saved place is drawn there; a class never placed gets one of its own.
  expect(canvas.nodes.find((node) => node.id === "org")).toMatchObject({ x: 400, y: 120 });
  expect(canvas.nodes.find((node) => node.id === "person")?.x).toEqual(expect.any(Number));

  canvas.emit!("connect", "person", "person");
  await nextTick();
  expect(instance.state.values.value).toMatchObject({ connectFrom: "person", connectTo: "person" });

  canvas.emit!("move", "person", { x: 10, y: 20 } satisfies GraphCanvasPoint);
  await nextTick();
  expect(instance.state.values.value.positions).toEqual({ org: { x: 400, y: 120 }, person: { x: 10, y: 20 } });
});
