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

vi.mock("@antv/g6", () => ({
  Graph: class {
    constructor() {}
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
      return 1;
    }
    getCanvasByViewport(point: number[]) {
      return point;
    }
    setNode() {}
    destroy() {}
  },
}));

const { default: G6GraphCanvas } = await import("../G6GraphCanvas.vue");

beforeEach(() => {
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
