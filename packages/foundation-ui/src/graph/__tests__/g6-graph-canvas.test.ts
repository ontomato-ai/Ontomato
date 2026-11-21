import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { GraphCanvasEdge, GraphCanvasNode } from "../types";
import { g6Edges, type G6Colors } from "../g6-elements";

/*
 * What callers of the G6 canvas build on: it changes only the elements whose props changed (a graph grows by a longer
 * list, a dragged node stays put until its caller moves it), it draws large additions in bounded batches with every
 * edge after its ends, and a choice hands back a selection without keeping one. G6 itself is replaced by a recorder:
 * happy-dom cannot draw, and what is checked is what the canvas hands G6.
 */

const calls: Array<[string, unknown]> = [];
const handlers: Record<string, (event: any) => void> = {};
const nodeData = new Map<string, any>();
/** The zoom G6 reports, and the zoom its fitView would choose for the whole graph. */
const view = { zoom: 1, fitted: 1, options: null as any };

vi.mock("@antv/g6", () => ({
  Graph: class {
    constructor(options: any) {
      view.options = options;
    }
    getViewportByCanvas(point: number[]) {
      // The view is 800 by 600, its middle on the canvas origin before any move.
      return [400 + point[0]! * view.zoom, 300 + point[1]! * view.zoom];
    }
    async translateBy(offset: number[]) {
      calls.push(["translate", offset.map(Math.round)]);
    }
    on(name: string, handler: (event: any) => void) {
      handlers[name] = handler;
    }
    async render() {}
    async draw() {
      calls.push(["draw", null]);
    }
    addData(data: { nodes?: any[]; edges?: any[] }) {
      calls.push(["add", data]);
      for (const node of data.nodes ?? []) nodeData.set(node.id, node);
    }
    updateNodeData(nodes: any[]) {
      calls.push(["updateNodes", nodes]);
    }
    updateEdgeData(edges: any[]) {
      calls.push(["updateEdges", edges]);
    }
    removeNodeData(ids: string[]) {
      calls.push(["removeNodes", ids]);
    }
    removeEdgeData(ids: string[]) {
      calls.push(["removeEdges", ids]);
    }
    setElementState(states: Record<string, string[]>) {
      calls.push(["states", states]);
    }
    getNodeData() {
      return [...nodeData.values()];
    }
    getElementPosition(id: string) {
      return [nodeData.get(id).style.x + 5, nodeData.get(id).style.y + 7];
    }
    getZoom() {
      return view.zoom;
    }
    setOptions(options: unknown) {
      calls.push(["options", options]);
    }
    async fitView() {
      view.zoom = view.fitted;
      calls.push(["fitView", view.zoom]);
    }
    async zoomTo(zoom: number) {
      view.zoom = zoom;
      calls.push(["zoomTo", zoom]);
    }
    async fitCenter() {
      calls.push(["fitCenter", null]);
    }
    async focusElement(id: string) {
      calls.push(["focus", id]);
    }
    getCanvasByViewport(point: number[]) {
      return point;
    }
    setNode() {}
    setEdge() {}
    destroy() {}
  },
}));

const { default: G6GraphCanvas } = await import("../G6GraphCanvas.vue");

beforeEach(() => {
  Object.assign(view, { zoom: 1, fitted: 1 });
  calls.length = 0;
  nodeData.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const of = (kind: string) => calls.filter(([name]) => name === kind).map(([, value]) => value as any);
const placed = (count: number, prefix = "n"): GraphCanvasNode[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, label: `Node ${index}`, x: index * 10, y: 0 }));

it("draws a large addition in bounded batches, every edge after both its ends, and reports progress to the end", async () => {
  const nodes = placed(450);
  const edges = nodes.slice(1).map((node) => ({ id: `e-${node.id}`, source: "n0", target: node.id }));
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes, edges, layout: { type: "preset" } } });
  // Batches yield to the browser between them; wait for the last.
  await vi.waitFor(() => expect(wrapper.emitted("progress")?.at(-1)).toEqual([899, 899]));
  const added = of("add");
  expect(added.every((batch) => (batch.nodes?.length ?? 0) + (batch.edges?.length ?? 0) <= 200)).toBe(true);
  const seen = new Set<string>();
  for (const batch of added) {
    for (const node of batch.nodes ?? []) seen.add(node.id);
    for (const edge of batch.edges ?? []) expect(seen.has(edge.source) && seen.has(edge.target)).toBe(true);
  }
  expect(seen.size).toBe(450);
  wrapper.unmount();
});

it("changes only what changed, and keeps a dragged node where it was let go until its caller moves it", async () => {
  const nodes = placed(3);
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes, layout: { type: "preset" } } });
  await flushPromises();
  handlers["node:dragend"]({ target: { id: "n1" } });
  expect(wrapper.emitted("move")).toEqual([["n1", { x: 15, y: 7 }]]);

  calls.length = 0;
  // A longer list adds one node; a new label updates one without its position; a dropped node is removed.
  await wrapper.setProps({ nodes: [{ ...nodes[0]!, label: "Renamed" }, nodes[1]!, { id: "n3", label: "New", x: 1, y: 2 }] });
  await flushPromises();
  expect(of("add")).toEqual([{ nodes: [expect.objectContaining({ id: "n3", style: expect.objectContaining({ x: 1, y: 2 }) })], edges: [] }]);
  expect(of("updateNodes")).toEqual([[expect.objectContaining({ id: "n0" })]]);
  expect(of("updateNodes")[0][0].style).not.toHaveProperty("x");
  expect(of("removeNodes")).toEqual([["n2"]]);

  calls.length = 0;
  await wrapper.setProps({ nodes: [{ ...nodes[0]!, label: "Renamed" }, { ...nodes[1]!, x: 15, y: 7 }, { id: "n3", label: "New", x: 1, y: 2 }] });
  await flushPromises();
  expect(of("updateNodes")).toEqual([[expect.objectContaining({ id: "n1", style: expect.objectContaining({ x: 15, y: 7 }) })]]);
  expect(of("add")).toEqual([]);
});

it("hands back a choice without keeping it, ignores the second click of a double-click, and reports the double-click", async () => {
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes: placed(2), layout: { type: "preset" }, selected: ["n0"] } });
  await flushPromises();
  expect(of("states")).toEqual([{ n0: ["selected"] }]);
  handlers["node:click"]({ target: { id: "n1" }, detail: 1 });
  handlers["node:click"]({ target: { id: "n1" }, detail: 2 });
  handlers["node:dblclick"]({ target: { id: "n1" } });
  handlers["node:click"]({ target: { id: "n0" }, detail: 1 });
  handlers["canvas:click"]({});
  expect(wrapper.emitted("update:selected")).toEqual([[["n1"]], [[]]]);
  expect(wrapper.emitted("activate")).toEqual([[{ kind: "node", id: "n1" }]]);
  expect(wrapper.emitted("blank")).toHaveLength(1);

  calls.length = 0;
  await wrapper.setProps({ selected: ["n1"] });
  await flushPromises();
  expect(of("states")).toEqual([{ n0: [], n1: ["selected"] }]);
});

it("chooses edges as it chooses nodes, handing them back on their own event", async () => {
  const nodes = placed(2);
  const wrapper = mount(G6GraphCanvas, {
    props: { label: "Graph", nodes, edges: [{ id: "e", source: "n0", target: "n1" }], layout: { type: "preset" }, selected: ["n0"] },
  });
  await flushPromises();
  handlers["edge:click"]({ target: { id: "e" }, detail: 1 });
  expect(wrapper.emitted("update:selectedEdges")).toEqual([[["e"]]]);
  expect(wrapper.emitted("update:selected")).toBeUndefined();
  calls.length = 0;
  await wrapper.setProps({ selected: [], selectedEdges: ["e"] });
  await flushPromises();
  expect(of("states")).toEqual([{ n0: [], e: ["selected"] }]);
});

const colors: G6Colors = { text: "t", muted: "m", surface: "s", edge: "e", primary: "p", accent: "a", palette: ["c1", "c2"] };
const node = (id: string, extra: Partial<GraphCanvasNode> = {}): [string, GraphCanvasNode] => [id, { id, label: id, ...extra }];

it("fans parallel edges into arcs, loops a self-relation round its anchor's group, and leaves out edges to undrawn nodes", () => {
  const nodes = new Map([node("A"), node("B"), node("G", { anchor: { radius: 100 } })]);
  const edges: GraphCanvasEdge[] = [
    { id: "owns", source: "A", target: "B" },
    { id: "reviews", source: "A", target: "B", line: "dashed", weight: 3, tone: "muted" },
    { id: "self", source: "A", target: "A" },
    { id: "group", source: "G", target: "G" },
    { id: "lost", source: "A", target: "Missing" },
  ];
  const drawn = Object.fromEntries(g6Edges(edges, nodes, colors).map((edge) => [edge.id, edge]));
  expect(Object.keys(drawn)).toEqual(["owns", "reviews", "self", "group"]);
  expect(drawn.owns!.type).toBe("quadratic");
  expect(drawn.owns!.style!.curveOffset).not.toBe(drawn.reviews!.style!.curveOffset);
  expect(drawn.reviews!.style).toMatchObject({ lineDash: [5, 4], opacity: 0.15, lineWidth: 3.5 });
  expect(drawn.self!.style).toMatchObject({ loop: true, loopDist: 60 });
  expect(drawn.group!.style).toMatchObject({ loop: true, loopDist: 160 });
});

it("fits a graph no smaller than names stay readable at, and then shows the part around the node it is given", async () => {
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes: placed(3), layout: { type: "preset" } } });
  await flushPromises();
  const fit = (options: object) => (wrapper.vm as unknown as { fit(options: object): Promise<void> }).fit(options);
  const steps = () => calls.filter(([name]) => ["fitView", "zoomTo", "fitCenter", "focus"].includes(name));

  // A graph that fits at a readable size is shown whole.
  view.fitted = 0.9;
  calls.length = 0;
  await fit({ minZoom: 0.85, around: "n1" });
  expect(steps()).toEqual([["fitView", 0.9], ["fitCenter", null]]);

  // One that would shrink below it is shown at that size, around the node given.
  view.fitted = 0.3;
  calls.length = 0;
  await fit({ minZoom: 0.85, around: "n1" });
  expect(steps()).toEqual([["fitView", 0.3], ["zoomTo", 0.85]]);
  expect(of("translate")).toHaveLength(1);

  // Without a node, around the middle of the graph; a small graph is not blown up past maxZoom.
  calls.length = 0;
  await fit({ minZoom: 0.85 });
  expect(steps()).toEqual([["fitView", 0.3], ["zoomTo", 0.85]]);
  expect(of("translate")).toHaveLength(1);
  view.fitted = 3;
  calls.length = 0;
  await fit({ maxZoom: 1.15, minZoom: 0.85 });
  expect(steps()).toEqual([["fitView", 3], ["zoomTo", 1.15], ["fitCenter", null]]);
  wrapper.unmount();
});

it("keeps a node's name readable when the reader zooms out, and hides only names that would overlap", async () => {
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes: placed(2), layout: { type: "preset" }, readableLabels: true } });
  await flushPromises();
  const behaviors = view.options.behaviors as any[];
  const fixed = behaviors.find((behavior) => behavior.type === "fix-element-size");
  // The whole name is held at its size, at every zoom: G6 5.1 scales a label's own `fontSize` without its text (checked
  // in a browser, 2026-11-22), and a rule that held names only below zoom 1 left them enlarged when the reader zoomed in.
  expect(fixed).toMatchObject({ state: "", enable: true, node: [{ shape: "label" }], edge: [{ shape: "label" }] });
  expect(fixed.node[0]).not.toHaveProperty("fields");
  expect(behaviors.some((behavior) => behavior.type === "auto-adapt-label")).toBe(true);
  wrapper.unmount();
});

it("shows a graph too large to read whole from its own edge, around the node it is given, not past it into empty canvas", async () => {
  // Nodes from x 0 to 2000 and y 0 to 1000: at zoom 1 far wider and taller than the 800 by 600 view.
  const nodes = [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 2000, y: 1000 }];
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes, layout: { type: "preset" } } });
  await flushPromises();
  view.fitted = 0.2;
  calls.length = 0;
  await (wrapper.vm as unknown as { fit(options: object): Promise<void> }).fit({ minZoom: 1, around: "a", padding: 0 });
  // Around "a", at the top-left corner: the view moves so the graph's own corner, not "a", sits at the view's corner.
  const [translate] = of("translate");
  expect(of("focus")).toEqual([]);
  // Centring "a" would leave it where it is; the view moves on until the graph's own corner — a's position less its
  // name's half width and its node's half size — sits at the view's corner: a ends up 320 right and 284 down of centre.
  expect(translate).toEqual([-320, -284]);
  wrapper.unmount();
});

it("zooms by a step as a zoom to the level it reaches, so what reads the zoom sees where it is, not the step", async () => {
  const wrapper = mount(G6GraphCanvas, { props: { label: "Graph", nodes: placed(2), layout: { type: "preset" } } });
  await flushPromises();
  view.zoom = 0.8;
  calls.length = 0;
  await (wrapper.vm as unknown as { zoomBy(ratio: number): Promise<void> }).zoomBy(0.8);
  expect(of("zoomTo")).toEqual([expect.closeTo(0.64)]);
  wrapper.unmount();
});
