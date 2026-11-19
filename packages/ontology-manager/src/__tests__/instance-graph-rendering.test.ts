import { describe, expect, it } from "vitest";
import {
  instanceNodePosition,
  neighborNodePosition,
  overviewPositions,
  overviewRelations,
  overviewClassHeadings,
} from "../data-browser/instance-graph-rendering";

const nodes = Array.from({ length: 451 }, (_, index) => ({
  id: `node:${index}`, name: `Node ${index}`, class: "Item",
}));

describe("instance graph incremental drawing", () => {
  it("keeps a multiline heading with its own cluster when another row blocks the space above", () => {
    const instances = [
      { x: 80, y: 200, width: 80, height: 58 },
      { x: 20, y: 90, width: 200, height: 58 },
    ];
    const headings = overviewClassHeadings([
      { name: "A", bounds: { x: 80, y: 200, width: 80, height: 58 }, width: 240, height: 94 },
    ], instances);
    for (const heading of headings) {
      expect(heading.x + heading.width / 2).toBe(120);
      for (const obstacle of [...instances, ...headings.filter(item => item !== heading)]) {
        expect(heading.x + heading.width <= obstacle.x || obstacle.x + obstacle.width <= heading.x
          || heading.y + heading.height <= obstacle.y - 8 || obstacle.y + obstacle.height <= heading.y - 8).toBe(true);
      }
    }
  });

  it("omits headings when both sides are crowded instead of covering instances", () => {
    const bounds = { x: 100, y: 200, width: 80, height: 58 };
    const headings = overviewClassHeadings([
      { name: "A", bounds, width: 200, height: 54 },
    ], [
      { x: 20, y: 70, width: 240, height: 114 },
      { x: 20, y: 274, width: 240, height: 114 },
    ]);
    expect(headings).toEqual([]);
  });

  it("does not overlap adjacent headings or pin offscreen headings to the viewport", () => {
    const headings = overviewClassHeadings(Array.from({ length: 20 }, (_, index) => ({
      name: String(index), bounds: { x: index * 40, y: 100, width: 0, height: 40 }, width: 100, height: 26,
    })), [], { x: 0, y: 0, width: 400, height: 200 });
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading.x).toBeGreaterThanOrEqual(0);
      expect(heading.x + heading.width).toBeLessThanOrEqual(400);
      for (const other of headings.filter(item => item !== heading)) {
        expect(heading.x + heading.width <= other.x || other.x + other.width <= heading.x
          || heading.y + heading.height <= other.y || other.y + other.height <= heading.y).toBe(true);
      }
    }
  });

  it("keeps an unobstructed class heading close to its instances", () => {
    const [heading] = overviewClassHeadings([
      { name: "A", bounds: { x: 100, y: 200, width: 80, height: 50 }, width: 200, height: 54 },
    ], []);
    expect(heading).toMatchObject({ name: "A", width: 200, height: 54 });
    expect(heading.x + heading.width / 2).toBe(140);
    expect(heading.y + heading.height).toBeLessThanOrEqual(200);
    expect(heading.y + heading.height).toBeGreaterThan(200 - heading.height);
  });

  it("aggregates sample edges by ordered class pair and relation type", () => {
    const sample = [
      { id: "A:1", class: "A", name: "A1" }, { id: "A:2", class: "A", name: "A2" }, { id: "B:1", class: "B", name: "B1" },
    ];
    const relations = [
      { source: "A:1", target: "B:1", type: "owns" },
      { source: "A:2", target: "B:1", type: "owns" },
      { source: "B:1", target: "A:1", type: "owns" },
      { source: "A:1", target: "B:1", type: "reviews" },
      { source: "A:1", target: "A:2", type: "parent" },
      { source: "missing", target: "B:1", type: "owns" },
    ];
    const positions = overviewPositions(sample);
    const result = overviewRelations(sample, relations, positions);
    expect(result.anchors).toHaveLength(2);
    expect(result.anchors.every((anchor) => anchor.anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y))).toBe(true);
    expect(result.edges).toHaveLength(4);
    expect(result.edges.map((edge) => ({ type: edge.type, count: edge.count, weight: edge.weight }))).toEqual(expect.arrayContaining([
      { type: "owns", count: 2, weight: 2 },
      { type: "owns", count: 1, weight: 1 },
      { type: "reviews", count: 1, weight: 1 },
      { type: "parent", count: 1, weight: 1 },
    ]));
    const edgeOf = (type: string, count: number) => result.edges.find((edge) => edge.type === type && edge.count === count)!;
    const ownsOut = edgeOf("owns", 2);
    const ownsBack = edgeOf("owns", 1);
    expect(ownsOut.source).toBe(ownsBack.target);
    expect(ownsOut.target).toBe(ownsBack.source);
    // A class's relation to itself ends at its own anchor, which reaches round its cluster.
    expect(edgeOf("parent", 1).source).toBe(edgeOf("parent", 1).target);
    expect(result.anchors.find((anchor) => anchor.id === edgeOf("parent", 1).source)!.anchor!.radius).toBeGreaterThan(0);
    expect(result.edges.every((edge) => edge.tone === "default")).toBe(true);
    const selected = overviewRelations(sample, relations, positions, "A:2");
    const direct = selected.edges.filter((edge) => edge.count === undefined);
    expect(selected.edges.filter((edge) => edge.count !== undefined).every((edge) => edge.tone === "muted")).toBe(true);
    expect(direct).toHaveLength(2);
    expect(direct.map((edge) => [edge.source, edge.target])).toEqual(expect.arrayContaining([
      ["A:2", "B:1"], ["A:1", "A:2"],
    ]));
    expect(overviewRelations(sample, [], positions).edges).toEqual([]);
  });
  it.each([[50, 50], [400, 100]])("keeps %i and %i sampled nodes in non-overlapping clusters", (aCount, bCount) => {
    const sample = Array.from({ length: aCount + bCount }, (_, index) => ({
      id: String(index), class: index < aCount ? "A" : "B", name: String(index),
    }));
    const positions = overviewPositions(sample);
    expect(Object.keys(positions)).toHaveLength(sample.length);
    const bounds = (name: string) => {
      const points = sample.filter(node => node.class === name).map(node => positions[node.id]);
      return {
        left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
        top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)),
      };
    };
    const a = bounds("A"), b = bounds("B");
    expect(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top).toBe(true);
  });
  it("places later neighborhood pages beyond earlier positions", () => {
    const center = { x: 15, y: 20 };
    const first = neighborNodePosition(0, center);
    const later = neighborNodePosition(100, center);
    expect(Math.hypot(later.x - center.x, later.y - center.y)).toBeGreaterThan(Math.hypot(first.x - center.x, first.y - center.y));
  });
  it("assigns distinct finite positions to every node", () => {
    expect(nodes.every((_, index) => Object.values(instanceNodePosition(index, nodes.length)).every(Number.isFinite))).toBe(true);
    expect(new Set(nodes.map((_, index) => JSON.stringify(instanceNodePosition(index, nodes.length)))).size).toBe(nodes.length);
  });
});
