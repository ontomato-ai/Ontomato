import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryLegendEntries,
  categorizedGraphView,
  toggledCategory,
} from "../object-graph-categories.ts";

// The graph's categories as the legend offers them: the configured order, each named as the projection names it.
const asConfigured = (text) => (text === "platformOntology.layers.fact" ? "Fact layer" : text);

test("categoryLegendEntries lists the configured categories in order, each under its configured name", () => {
  const entries = categoryLegendEntries(
    ["fact", "capability", "governance"],
    { capability: "Capability layer" },
    asConfigured,
  );
  assert.deepEqual(entries, [
    { category: "fact", label: "fact" },
    { category: "capability", label: "Capability layer" },
    { category: "governance", label: "governance" },
  ]);
});

// A projection that names only the names, without the order, still says which categories there are.
test("categoryLegendEntries falls back to the categories the labels name", () => {
  assert.deepEqual(categoryLegendEntries([], { fact: "platformOntology.layers.fact" }, asConfigured), [
    { category: "fact", label: "Fact layer" },
  ]);
});

test("categoryLegendEntries offers nothing when the projection configures no categories", () => {
  assert.deepEqual(categoryLegendEntries([], {}, asConfigured), []);
});

const nodes = [
  { id: "order", label: "Order", category: "fact" },
  { id: "flow", label: "Flow", category: "capability" },
  { id: "rule", label: "Rule", category: "governance" },
  { id: "note", label: "Note" },
];
const links = [
  { id: "order-flow", source: "order", target: "flow" },
  { id: "flow-rule", source: "flow", target: "rule" },
  { id: "rule-note", source: "rule", target: "note" },
];

test("categorizedGraphView leaves the graph as it is while no category is switched off", () => {
  const hidden = new Set();
  const view = categorizedGraphView(nodes, links, hidden);
  assert.deepEqual(view.nodes, nodes);
  assert.deepEqual(view.links, links);
});

test("categorizedGraphView drops one category's nodes and every edge that ends at one of them", () => {
  const view = categorizedGraphView(nodes, links, new Set(["capability"]));
  assert.deepEqual(view.nodes.map((node) => node.id), ["order", "rule", "note"]);
  assert.deepEqual(view.links.map((link) => link.id), ["rule-note"]);
});

// A node the projection gives no category takes none of the colours: no legend entry hides it.
test("categorizedGraphView keeps the nodes that name no category", () => {
  const view = categorizedGraphView(nodes, links, new Set(["fact", "capability", "governance"]));
  assert.deepEqual(view.nodes.map((node) => node.id), ["note"]);
  assert.deepEqual(view.links, []);
});

test("toggledCategory switches one category off and the next click back on, leaving the others alone", () => {
  const once = toggledCategory(new Set(), "capability");
  assert.deepEqual([...once], ["capability"]);
  const twice = toggledCategory(once, "capability");
  assert.deepEqual([...twice], []);

  const two = toggledCategory(once, "fact");
  assert.deepEqual([...two].sort(), ["capability", "fact"]);
  assert.deepEqual([...once], ["capability"]);
});
