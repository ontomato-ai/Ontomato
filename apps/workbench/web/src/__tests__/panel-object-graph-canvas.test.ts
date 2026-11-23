import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { type GraphCanvasEdge, type GraphCanvasNode, type GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
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
  fits: [] as unknown[],
  zooms: [] as unknown[],
  categories: [] as readonly string[],
  readableLabels: false,
  /** The node and name sizes the member asks for; undefined is the canvas's own. */
  look: {} as Record<string, unknown>,
  /** Whether the canvas's next fit holds the whole graph. */
  fitsWhole: true,
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
      categories: { type: Array, default: () => [] }, readableLabels: { type: Boolean, default: false },
      nodeSize: { type: Number, default: undefined }, labelSize: { type: Number, default: undefined },
    },
    emits: ["update:selected", "update:selectedEdges", "blank", "connect", "move", "activate", "viewport", "resized"],
    setup(props, { emit, expose }) {
      canvas.emit = emit as never;
      expose({
        zoomBy: async (ratio: number) => void canvas.zooms.push(["by", ratio]),
        zoomTo: async (zoom: number) => void canvas.zooms.push(["to", zoom]),
        focus: async (id: string) => void canvas.zooms.push(["focus", id]),
        fit: async (options: unknown) => { canvas.fits.push(options); return canvas.fitsWhole; }, relayout: async () => {}, exportImage: async () => new Blob(["png"], { type: "image/png" }) });
      return () => {
        canvas.nodes = props.nodes as never;
        canvas.edges = props.edges as never;
        canvas.selected = props.selected as never;
        canvas.selectedEdges = props.selectedEdges as never;
        canvas.editable = props.editable;
        canvas.categories = props.categories as never;
        canvas.readableLabels = props.readableLabels;
        canvas.look = { nodeSize: props.nodeSize, labelSize: props.labelSize };
        return h("div", { class: "mock-g6-canvas" });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const graph = (editable: boolean, look: Record<string, unknown> = {}): DirectProjection => ({
  ...record, id: editable ? "model-graph-editable" : "model-graph", name: "Model graph", componentId: "@ontomato/sdk:ObjectGraph",
  inputs: {
    highlightedNodes: { kind: "list", items: { kind: "object", objectType: OBJECT_TYPE } },
    highlightedEdges: { kind: "list", items: { kind: "object", objectType: RELATIONSHIP } },
    pathFrom: { kind: "object", objectType: OBJECT_TYPE },
    pathTo: { kind: "object", objectType: OBJECT_TYPE },
  },
  outputs: {
    selectedNode: { kind: "object", objectType: OBJECT_TYPE }, selectedEdge: { kind: "object", objectType: RELATIONSHIP },
    connectFrom: { kind: "scalar", type: "string" }, connectTo: { kind: "scalar", type: "string" },
    positions: { kind: "node-positions" }, zoom: { kind: "scalar", type: "number" },
  },
  config: {
    edgeEnds: { source: "/fromclass", target: "/toclass" }, ...(editable ? { editable: true } : {}),
    // The layer each class is drawn in the colour of, in a fixed order.
    categories: ["fact", "capability"], nodeCategory: "/layer", ...look,
  },
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
    pathClasses: { type: { kind: "list", items: { kind: "object", objectType: OBJECT_TYPE } }, personal: false, deepLink: false, external: false },
    pathRelations: { type: { kind: "list", items: { kind: "object", objectType: RELATIONSHIP } }, personal: false, deepLink: false, external: false },
    pathFrom: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    pathTo: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    graphZoom: { type: { kind: "scalar", type: "number" }, personal: false, deepLink: false, external: false },
  },
  members: {
    graph: {
      target: { projectionId },
      inputs: {
        highlightedNodes: { state: "pathClasses" }, highlightedEdges: { state: "pathRelations" },
        pathFrom: { state: "pathFrom" }, pathTo: { state: "pathTo" }, zoom: { state: "graphZoom" },
      },
      outputs: {
        selectedNode: { state: "selectedClass" }, selectedEdge: { state: "selectedRelation" },
        connectFrom: { state: "connectFrom" }, connectTo: { state: "connectTo" }, positions: { state: "positions" }, zoom: { state: "graphZoom" },
      },
    },
  },
});
const twoClasses = [
  { primaryKey: "org", label: "Organization", fields: { layer: "fact" } },
  { primaryKey: "person", label: "Person", fields: { layer: "capability" } },
];
const oneRelation = [{ primaryKey: "works-in", label: "Works in", fields: { fromclass: "person", toclass: "org" } }];
let classes = twoClasses;
let relations = oneRelation;
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.innerHTML = "";
  Object.assign(canvas, { nodes: [], edges: [], selected: [], selectedEdges: [], editable: false, emit: null, fits: [], zooms: [], categories: [], look: {}, fitsWhole: true });
});

function mount(
  editable: boolean,
  initial: Record<string, unknown> = {},
  look: Record<string, unknown> = {},
  overrides: { nodes?: ProductPanelReadResponse; edges?: ProductPanelReadResponse } = {},
) {
  const projection = graph(editable, look);
  const instance = createDirectPanelInstance(manifest(projection.id), {
    pageKey: "modeling", url: () => "/modeling", label: () => "Modeling", initial: initial as never,
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => {
      if (request.operations) return ready({});
      if (request.dataName === "nodes") return overrides.nodes ?? ready(classes);
      return overrides.edges ?? ready(relations);
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

it("places classes nobody placed by their relations, and opens on the chosen class, else the most connected, at a readable size", async () => {
  classes = ["award", "org", "person", "title", "paper"].map((key) => ({ primaryKey: key, label: key, fields: { layer: "fact" } }));
  relations = [["person", "org"], ["person", "award"], ["person", "title"], ["paper", "award"]]
    .map(([from, to]) => ({ primaryKey: `${from}-${to}`, label: `${from} to ${to}`, fields: { fromclass: from!, toclass: to! } }));
  try {
    mount(false);
    await vi.waitFor(() => expect(canvas.nodes).toHaveLength(5));
    const x = (id: string) => canvas.nodes.find((node) => node.id === id)!.x!;
    // The most connected class first, those one relation away next to it, the one two away after them.
    expect(x("org")).toBe(x("award"));
    expect(x("title")).toBe(x("award"));
    expect(x("person")).toBeLessThan(x("org"));
    expect(x("paper")).toBeGreaterThan(x("award"));
    // Each edge drawn with its relationship's name.
    expect(canvas.edges.map(({ label }) => label)).toContain("person to org");
    await vi.waitFor(() => expect(canvas.fits).toEqual([expect.objectContaining({ keepNames: true, around: "person" })]));

    for (const app of mounted.splice(0)) app.unmount();
    canvas.fits = [];
    mount(false, { selectedClass: { className: OBJECT_TYPE, primaryKey: "paper" } });
    await vi.waitFor(() => expect(canvas.fits).toEqual([expect.objectContaining({ keepNames: true, around: "paper" })]));
  } finally {
    classes = twoClasses;
    relations = oneRelation;
  }
});

it("draws what the panel highlights — a path, a search's hits — standing out and the rest faded, without choosing it", async () => {
  const { instance } = mount(false);
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  expect(canvas.nodes.map(({ tone }) => tone ?? "default")).toEqual(["default", "default"]);

  instance.state.set("pathClasses", [{ className: OBJECT_TYPE, primaryKey: "person" }] as never);
  await vi.waitFor(() => expect(canvas.nodes.map(({ id, tone }) => [id, tone])).toEqual([["org", "muted"], ["person", "accent"]]));
  expect(canvas.edges.map(({ tone }) => tone)).toEqual(["muted"]);
  instance.state.set("pathRelations", [{ className: RELATIONSHIP, primaryKey: "works-in" }] as never);
  await vi.waitFor(() => expect(canvas.edges.map(({ tone }) => tone)).toEqual(["accent"]));
  expect(canvas.selected).toEqual([]);
  expect(instance.state.values.value.selectedClass ?? null).toBeNull();

  instance.state.set("pathClasses", [] as never);
  instance.state.set("pathRelations", [] as never);
  await vi.waitFor(() => expect(canvas.nodes.map(({ tone }) => tone ?? "default")).toEqual(["default", "default"]));
});

it("zooms in and out from its own buttons, centres the chosen class, and keeps names readable however far it zooms", async () => {
  const { element } = mount(false);
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  expect(canvas.readableLabels).toBe(true);
  const button = (action: string) => element.querySelector<HTMLButtonElement>(`[data-graph-action="${action}"]`)!;
  button("zoom-in").click();
  button("zoom-out").click();
  expect(canvas.zooms).toEqual([["by", 1.25], ["by", 0.8]]);
  // Nothing chosen: there is nothing to centre.
  expect(button("focus-selected").disabled).toBe(true);
  canvas.emit!("update:selected", ["person"]);
  await nextTick();
  button("focus-selected").click();
  expect(canvas.zooms.at(-1)).toEqual(["focus", "person"]);
});

it("hands the page its zoom and follows the zoom the page sets, as one of its ports", async () => {
  const { instance } = mount(false);
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  canvas.emit!("viewport", { x: 0, y: 0, width: 800, height: 600, zoom: 0.7349 });
  await nextTick();
  expect(instance.state.values.value.graphZoom).toBe(0.73);
  // What the canvas itself reported is not zoomed to again.
  expect(canvas.zooms).toEqual([]);
  instance.state.set("graphZoom", 1.5 as never);
  await vi.waitFor(() => expect(canvas.zooms).toEqual([["to", 1.5]]));
});

it("fits again once its container settles at a new size, not on every step of the change", async () => {
  mount(false);
  await vi.waitFor(() => expect(canvas.fits).toHaveLength(1));
  canvas.emit!("resized", 900, 600);
  canvas.emit!("resized", 800, 600);
  canvas.emit!("resized", 700, 600);
  await vi.waitFor(() => expect(canvas.fits).toHaveLength(2), { timeout: 2000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(canvas.fits).toHaveLength(2);
});

it("colours each class by the category its record names, in the order the projection gives", async () => {
  mount(false);
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  expect(canvas.categories).toEqual(["fact", "capability"]);
  expect(canvas.nodes.map(({ id, category }) => [id, category])).toEqual([["org", "fact"], ["person", "capability"]]);
});

// A page that draws its graph as the ontology graph always did sets its nodes' and names' sizes (原页面对照《本体图谱》:
// 62 and 13); the rows of the layout make room for them.
it("draws its nodes and names at the sizes the projection sets, with rows to fit them", async () => {
  mount(false, {}, { nodeSize: 62, labelSize: 13 });
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));
  expect(canvas.look).toEqual({ nodeSize: 62, labelSize: 13 });
});

// A graph larger than the canvas at a readable size is shown in part (panelisation lead, 2026-11-22: never shrunk until its
// names cannot be read): a light line says so, and once the reader moves the view it steps back, never a pop-up.
it("says when the graph is larger than the canvas, and steps back once the reader moves the view", async () => {
  canvas.fitsWhole = false;
  const { element } = mount(false);
  const hint = () => element.querySelector<HTMLElement>("[data-graph-hint]");
  await vi.waitFor(() => expect(hint()?.textContent?.trim()).toBe("The graph is larger than the canvas: drag to see the rest"));
  expect(hint()!.classList.contains("quiet")).toBe(false);
  canvas.emit!("viewport", { x: 40, y: 0, width: 800, height: 600, zoom: 0.83 });
  await nextTick();
  expect(hint()!.classList.contains("quiet")).toBe(true);
});

it("says nothing when the whole graph is in view", async () => {
  const { element } = mount(false);
  await vi.waitFor(() => expect(canvas.fits).toHaveLength(1));
  await nextTick();
  expect(element.querySelector("[data-graph-hint]")).toBeNull();
});

it("keeps readable nodes and explains what is hidden when edges are forbidden, while node refusal still blocks the graph", async () => {
  const partial = mount(false, {}, {}, { edges: { status: "forbidden" } });
  await vi.waitFor(() => expect(canvas.nodes.map((node) => node.id)).toEqual(["org", "person"]));
  expect(canvas.edges).toEqual([]);
  expect(partial.element.querySelector('[role="alert"]')).toBeNull();
  const notice = partial.element.querySelector<HTMLElement>("[data-graph-edges-notice]");
  expect(notice?.textContent?.trim()).toBe(publicEn.platform.graphEdgesForbidden);

  const blocked = mount(false, {}, {}, { nodes: { status: "forbidden" } });
  await vi.waitFor(() => expect(blocked.element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(publicEn.platform.dataForbidden));
});

it("finds the shortest directed path from pathFrom to pathTo, highlights it with path tone, shows trail and hops, and reports path details in pageContext", async () => {
  classes = [
    { primaryKey: "person", label: "Person", fields: { layer: "fact" } },
    { primaryKey: "team", label: "Team", fields: { layer: "fact" } },
    { primaryKey: "dept", label: "Department", fields: { layer: "fact" } },
    { primaryKey: "org", label: "Organization", fields: { layer: "capability" } },
    { primaryKey: "isolated", label: "Isolated", fields: { layer: "capability" } },
  ];
  // Two directed paths from person -> org: 2 hops (person -> team -> org) and 3 hops (person -> team -> dept -> org).
  relations = [
    { primaryKey: "r-pt", label: "In team", fields: { fromclass: "person", toclass: "team" } },
    { primaryKey: "r-td", label: "Under dept", fields: { fromclass: "team", toclass: "dept" } },
    { primaryKey: "r-do", label: "Part of org", fields: { fromclass: "dept", toclass: "org" } },
    { primaryKey: "r-to", label: "Belongs to", fields: { fromclass: "team", toclass: "org" } },
  ];
  try {
    const { instance, element } = mount(false);
    await vi.waitFor(() => expect(canvas.nodes).toHaveLength(5));
    expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("none");
    expect(instance.pageContext.value.highlights).toBeUndefined();

    // Shortest directed path: person -> team -> org (2 hops).
    instance.state.setState({
      pathFrom: { className: OBJECT_TYPE, primaryKey: "person" } as never,
      pathTo: { className: OBJECT_TYPE, primaryKey: "org" } as never,
    });
    await vi.waitFor(() => expect(element.querySelector("[data-graph-path-banner]")).not.toBeNull());
    expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("path");
    const banner = element.querySelector<HTMLElement>("[data-graph-path-banner]")!;
    expect(banner.dataset.graphPathStatus).toBe("found");
    expect(banner.dataset.graphPathHops).toBe("2");
    expect(banner.textContent).toContain("2 hops");
    expect(banner.textContent).toContain("Person → Team → Organization");
    expect(canvas.nodes.map(({ id, tone }) => [id, tone])).toEqual([
      ["person", "path"],
      ["team", "path"],
      ["dept", "muted"],
      ["org", "path"],
      ["isolated", "muted"],
    ]);
    expect(canvas.edges.map(({ id, tone }) => [id, tone])).toEqual([
      ["r-pt", "path"],
      ["r-td", "muted"],
      ["r-do", "muted"],
      ["r-to", "path"],
    ]);
    expect(instance.pageContext.value.highlights).toEqual([{
      kind: "path",
      summary: "Path from Person to Organization (2 hops): Person → Team → Organization",
      from: { kind: OBJECT_TYPE, id: "person", label: "Person" },
      to: { kind: OBJECT_TYPE, id: "org", label: "Organization" },
      found: true,
      hops: 2,
      nodes: [
        { kind: OBJECT_TYPE, id: "person", label: "Person" },
        { kind: OBJECT_TYPE, id: "team", label: "Team" },
        { kind: OBJECT_TYPE, id: "org", label: "Organization" },
      ],
      edges: [
        { kind: RELATIONSHIP, id: "r-pt", label: "In team" },
        { kind: RELATIONSHIP, id: "r-to", label: "Belongs to" },
      ],
    }]);

    // Reverse direction (org -> person) has no directed path and leaves nodes plain without misleading highlight.
    instance.state.setState({
      pathFrom: { className: OBJECT_TYPE, primaryKey: "org" } as never,
      pathTo: { className: OBJECT_TYPE, primaryKey: "person" } as never,
    });
    await vi.waitFor(() => expect(element.querySelector<HTMLElement>("[data-graph-path-banner]")?.dataset.graphPathStatus).toBe("not-found"));
    expect(element.querySelector("[data-graph-path-banner]")?.textContent).toContain("No directed path from Organization to Person");
    expect(canvas.nodes.map(({ tone }) => tone ?? "default")).toEqual(["default", "default", "default", "default", "default"]);
    expect(instance.pageContext.value.highlights).toEqual([{
      kind: "path",
      summary: "No directed path from Organization to Person",
      from: { kind: OBJECT_TYPE, id: "org", label: "Organization" },
      to: { kind: OBJECT_TYPE, id: "person", label: "Person" },
      found: false,
      nodes: [],
      edges: [],
    }]);

    // Same start and target reports 0 hops and highlights only that node with path tone.
    instance.state.setState({
      pathFrom: { className: OBJECT_TYPE, primaryKey: "person" } as never,
      pathTo: { className: OBJECT_TYPE, primaryKey: "person" } as never,
    });
    await vi.waitFor(() => expect(element.querySelector<HTMLElement>("[data-graph-path-banner]")?.dataset.graphPathStatus).toBe("same-node"));
    expect(element.querySelector("[data-graph-path-banner]")?.textContent).toContain("Person is both start and target (0 hops)");
    expect(canvas.nodes.find((node) => node.id === "person")?.tone).toBe("path");
    expect(canvas.nodes.find((node) => node.id === "org")?.tone).toBe("muted");
    expect(instance.pageContext.value.highlights?.[0]).toMatchObject({ kind: "path", found: true, hops: 0 });
  } finally {
    classes = twoClasses;
    relations = oneRelation;
  }
});

it("distinguishes search hits from path results visually, in banners, and in pageContext.highlights", async () => {
  const { instance, element } = mount(false);
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));

  // Search hit uses accent tone + non-overlay search banner (without duplicated prefix) + kind:"search" in pageContext.
  instance.state.set("pathClasses", [{ className: OBJECT_TYPE, primaryKey: "person" }] as never);
  await vi.waitFor(() => expect(element.querySelector("[data-graph-search-banner]")).not.toBeNull());
  const stage = element.querySelector<HTMLElement>(".sdk-object-graph-canvas-stage")!;
  expect(stage).not.toBeNull();
  expect(stage.querySelector(".mock-g6-canvas")).not.toBeNull();
  const searchBanner = element.querySelector<HTMLElement>("[data-graph-search-banner]")!;
  expect(stage.contains(searchBanner)).toBe(false);
  expect(searchBanner.textContent?.split(publicEn.platform.graphSearchHighlightLabel).length).toBe(2);
  expect(searchBanner.getAttribute("title")).toBe("Search matches (1): Person");
  expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("search");
  expect(element.querySelector("[data-graph-path-banner]")).toBeNull();
  expect(canvas.nodes.map(({ id, tone }) => [id, tone])).toEqual([["org", "muted"], ["person", "accent"]]);
  expect(instance.pageContext.value.highlights).toEqual([{
    kind: "search",
    summary: "Search matches (1): Person",
    items: [{ kind: OBJECT_TYPE, id: "person", label: "Person" }],
  }]);

  // Setting pathFrom + pathTo switches cleanly to path tone + non-overlay path banner + kind:"path" in pageContext.
  instance.state.setState({
    pathFrom: { className: OBJECT_TYPE, primaryKey: "person" } as never,
    pathTo: { className: OBJECT_TYPE, primaryKey: "org" } as never,
  });
  await vi.waitFor(() => expect(element.querySelector("[data-graph-path-banner]")).not.toBeNull());
  const pathBanner = element.querySelector<HTMLElement>("[data-graph-path-banner]")!;
  expect(stage.contains(pathBanner)).toBe(false);
  expect(pathBanner.textContent).toContain(publicEn.platform.graphPathHighlightLabel);
  expect(pathBanner.textContent).not.toContain(publicEn.platform.graphSearchHighlightLabel);
  expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("path");
  expect(element.querySelector("[data-graph-search-banner]")).toBeNull();
  expect(canvas.nodes.map(({ id, tone }) => [id, tone])).toEqual([["org", "path"], ["person", "path"]]);
  expect(canvas.edges.map(({ id, tone }) => [id, tone])).toEqual([["works-in", "path"]]);
  expect(instance.pageContext.value.highlights?.[0]).toMatchObject({ kind: "path", found: true, hops: 1 });

  // Clearing path endpoints restores the active search highlight; clearing search removes the banner.
  instance.state.setState({ pathFrom: null, pathTo: null });
  await vi.waitFor(() => expect(element.querySelector("[data-graph-search-banner]")).not.toBeNull());
  expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("search");
  expect(instance.pageContext.value.highlights?.[0]).toMatchObject({ kind: "search" });

  instance.state.set("pathClasses", [] as never);
  await vi.waitFor(() => expect(element.querySelector("[data-graph-search-banner]")).toBeNull());
  expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("none");
  expect(instance.pageContext.value.highlights).toBeUndefined();
});

it("dims non-adjacent nodes and edges on selection without showing any highlight banner or search pageContext", async () => {
  classes = [
    { primaryKey: "person", label: "Person", fields: { layer: "fact" } },
    { primaryKey: "team", label: "Team", fields: { layer: "fact" } },
    { primaryKey: "dept", label: "Department", fields: { layer: "fact" } },
    { primaryKey: "org", label: "Organization", fields: { layer: "capability" } },
    { primaryKey: "isolated", label: "Isolated", fields: { layer: "capability" } },
  ];
  relations = [
    { primaryKey: "r-pt", label: "In team", fields: { fromclass: "person", toclass: "team" } },
    { primaryKey: "r-td", label: "Under dept", fields: { fromclass: "team", toclass: "dept" } },
    { primaryKey: "r-do", label: "Part of org", fields: { fromclass: "dept", toclass: "org" } },
  ];
  try {
    const { instance, element } = mount(false);
    await vi.waitFor(() => expect(canvas.nodes).toHaveLength(5));

    // Selecting only a node keeps it selected, marks its direct peers and connecting edges with the warm neighbor tone,
    // and dims unrelated elements without showing a banner.
    instance.state.setState({
      selectedClass: { className: OBJECT_TYPE, primaryKey: "person" } as never,
      selectedRelation: null,
    });
    await nextTick();
    expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("none");
    expect(element.querySelector("[data-graph-search-banner]")).toBeNull();
    expect(element.querySelector("[data-graph-path-banner]")).toBeNull();
    expect(instance.pageContext.value.highlights).toBeUndefined();
    expect(canvas.nodes.map(({ id, tone }) => [id, tone ?? "default"])).toEqual([
      ["person", "default"],
      ["team", "neighbor"],
      ["dept", "muted"],
      ["org", "muted"],
      ["isolated", "muted"],
    ]);
    expect(canvas.edges.map(({ id, tone }) => [id, tone ?? "default"])).toEqual([
      ["r-pt", "neighbor"],
      ["r-td", "muted"],
      ["r-do", "muted"],
    ]);

    // Selecting only an edge keeps that edge crisp, marks its two endpoints as neighbors, and dims the rest with no banner.
    instance.state.setState({
      selectedClass: null,
      selectedRelation: { className: RELATIONSHIP, primaryKey: "r-td" } as never,
    });
    await nextTick();
    expect(element.querySelector("[data-graph-highlight-kind]")?.getAttribute("data-graph-highlight-kind")).toBe("none");
    expect(element.querySelector("[data-graph-search-banner]")).toBeNull();
    expect(element.querySelector("[data-graph-path-banner]")).toBeNull();
    expect(instance.pageContext.value.highlights).toBeUndefined();
    expect(canvas.nodes.map(({ id, tone }) => [id, tone ?? "default"])).toEqual([
      ["person", "muted"],
      ["team", "neighbor"],
      ["dept", "neighbor"],
      ["org", "muted"],
      ["isolated", "muted"],
    ]);
    expect(canvas.edges.map(({ id, tone }) => [id, tone ?? "default"])).toEqual([
      ["r-pt", "muted"],
      ["r-td", "default"],
      ["r-do", "muted"],
    ]);

    // Clearing selection restores all nodes and edges to default tone.
    canvas.emit!("blank");
    await nextTick();
    expect(canvas.nodes.map(({ tone }) => tone ?? "default")).toEqual(["default", "default", "default", "default", "default"]);
    expect(canvas.edges.map(({ tone }) => tone ?? "default")).toEqual(["default", "default", "default"]);
  } finally {
    classes = twoClasses;
    relations = oneRelation;
  }
});

it("keeps unrelated nodes undimmed on editable canvases and supports force layout, hidden banners, compact toolbar, and hint", async () => {
  const { instance, element } = mount(true, {}, {
    layout: "force",
    highlightBanner: false,
    showFocusButton: false,
    hint: "Click a node to inspect",
  });
  await vi.waitFor(() => expect(canvas.nodes).toHaveLength(2));

  // Selecting a node on an editable canvas does not dim other nodes so users can connect them freely.
  instance.state.set("selectedClass", { className: OBJECT_TYPE, primaryKey: "person" } as never);
  await nextTick();
  expect(canvas.nodes.map(({ id, tone }) => [id, tone ?? "default"])).toEqual([
    ["org", "default"],
    ["person", "default"],
  ]);

  // Compact toolbar hides focus-selected; hint renders cleanly.
  expect(element.querySelector('[data-graph-action="focus-selected"]')).toBeNull();
  expect(element.querySelector('[data-graph-action="relayout"]')).not.toBeNull();
  expect(element.querySelector("[data-graph-op-hint]")?.textContent?.trim()).toBe("Click a node to inspect");

  // With highlightBanner disabled, path highlights still report to pageContext without rendering the inline banner.
  instance.state.setState({
    pathFrom: { className: OBJECT_TYPE, primaryKey: "person" } as never,
    pathTo: { className: OBJECT_TYPE, primaryKey: "org" } as never,
  });
  await nextTick();
  expect(element.querySelector("[data-graph-path-banner]")).toBeNull();
  expect(instance.pageContext.value.highlights?.[0]?.kind).toBe("path");
});

it("separates 'no path found in the visible graph' from 'relations hidden due to permissions' when edges are forbidden", async () => {
  const { instance, element } = mount(
    false,
    {
      pathFrom: { className: OBJECT_TYPE, primaryKey: "person" },
      pathTo: { className: OBJECT_TYPE, primaryKey: "org" },
    },
    {},
    { edges: { status: "forbidden" } },
  );
  await vi.waitFor(() => expect(canvas.nodes.map((node) => node.id)).toEqual(["org", "person"]));
  expect(canvas.edges).toEqual([]);

  const pathBanner = element.querySelector<HTMLElement>("[data-graph-path-banner]");
  const edgeNotice = element.querySelector<HTMLElement>("[data-graph-edges-notice]");
  expect(pathBanner?.dataset.graphPathStatus).toBe("not-found");
  expect(pathBanner?.textContent).toContain("No path found in the visible graph from Person to Organization");
  expect(edgeNotice?.textContent?.trim()).toBe(publicEn.platform.graphEdgesForbidden);

  expect(instance.pageContext.value.highlights).toEqual([{
    kind: "path",
    summary: "No path found in the visible graph from Person to Organization",
    from: { kind: OBJECT_TYPE, id: "person", label: "Person" },
    to: { kind: OBJECT_TYPE, id: "org", label: "Organization" },
    found: false,
    nodes: [],
    edges: [],
    partialEdges: true,
    partialNotice: publicEn.platform.graphEdgesForbidden,
  }]);
});
