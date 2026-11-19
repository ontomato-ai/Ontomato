import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasNode } from "../index";

/*
 * The canvas's interface is what every graph of the platform is drawn through, so these are its promises to a caller:
 * a choice hands back the selection it results in and keeps none of its own, the caller's tones and selection are what
 * is drawn, and the part in view is reported. A change that breaks one of them breaks every caller at once.
 */

const nodes: GraphCanvasNode[] = [
  { id: "Order", label: "Order" },
  { id: "Customer", label: "A customer of the business", title: "A customer of the business (Customer)", tone: "accent" },
  { id: "Invoice", label: "Invoice" },
];
const edges: GraphCanvasEdge[] = [
  { id: "order-customer", source: "Order", target: "Customer", tone: "accent" },
  { id: "order-missing", source: "Order", target: "Missing" },
];

const node = (wrapper: ReturnType<typeof mount>, id: string) => wrapper.get(`[data-node-id="${id}"]`);

it("hands back the selection a choice results in, and draws only the one it is given", async () => {
  const wrapper = mount(GraphCanvas, { props: { label: "Data scope", nodes, edges, selected: ["Order"], selection: "multiple" } });
  await node(wrapper, "Invoice").trigger("click");
  await node(wrapper, "Order").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("update:selected")).toEqual([[["Order", "Invoice"]], [[]]]);
  // Nothing changed until the caller passes the new selection back.
  expect(node(wrapper, "Invoice").classes()).not.toContain("selected");
  await wrapper.setProps({ selected: ["Order", "Invoice"] });
  expect(node(wrapper, "Invoice").classes()).toContain("selected");
  expect(node(wrapper, "Invoice").attributes("aria-pressed")).toBe("true");
});

it("keeps at most one chosen node in single selection, and lets go of it when chosen again", async () => {
  const wrapper = mount(GraphCanvas, { props: { label: "Graph", nodes, selected: ["Order"] } });
  await node(wrapper, "Invoice").trigger("click");
  await node(wrapper, "Order").trigger("click");
  expect(wrapper.emitted("update:selected")).toEqual([[["Invoice"]], [[]]]);
});

it("only draws when nothing may be chosen", async () => {
  const wrapper = mount(GraphCanvas, { props: { label: "Graph", nodes, selection: "none" } });
  await node(wrapper, "Order").trigger("click");
  expect(wrapper.emitted("update:selected")).toBeUndefined();
  expect(node(wrapper, "Order").attributes("role")).toBeUndefined();
  expect(node(wrapper, "Order").attributes("tabindex")).toBeUndefined();
});

it("draws the caller's tones, names each node in full and skips an edge to a node it does not draw", () => {
  const wrapper = mount(GraphCanvas, { props: { label: "Data scope", nodes, edges } });
  expect(wrapper.get("svg").attributes("aria-label")).toBe("Data scope");
  expect(node(wrapper, "Customer").classes()).toContain("accent");
  expect(node(wrapper, "Customer").attributes("aria-label")).toBe("A customer of the business (Customer)");
  expect(node(wrapper, "Customer").get("text").text()).toBe("A customer of t…");
  expect(wrapper.findAll("line").map((line) => line.classes())).toEqual([["graph-edge", "accent"]]);
});

it("places nodes where the caller says under the preset layout", () => {
  const wrapper = mount(GraphCanvas, {
    props: { label: "Graph", layout: { type: "preset" }, nodes: [{ id: "A", label: "A", x: 300, y: 40 }] },
  });
  expect(node(wrapper, "A").get("rect").attributes()).toMatchObject({ x: "300", y: "40" });
  expect(() => mount(GraphCanvas, { props: { label: "Graph", layout: { type: "preset" }, nodes: [{ id: "B", label: "B" }] } }))
    .toThrow(/no position/);
});

it("reports the part in view when it is drawn and when the reader scrolls", async () => {
  const wrapper = mount(GraphCanvas, { props: { label: "Graph", nodes } });
  const scroller = wrapper.get(".graph-canvas").element as HTMLElement;
  scroller.scrollTop = 30;
  await wrapper.get(".graph-canvas").trigger("scroll");
  expect(wrapper.emitted("viewport")?.map(([viewport]) => viewport)).toEqual([
    { x: 0, y: 0, width: scroller.clientWidth, height: scroller.clientHeight, zoom: 1 },
    { x: 0, y: 30, width: scroller.clientWidth, height: scroller.clientHeight, zoom: 1 },
  ]);
});
