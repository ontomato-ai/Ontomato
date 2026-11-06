import { describe, expect, it, vi } from "vitest";
import type { GraphData } from "@antv/g6";
import {
  drawInstanceGraphBatches,
  GRAPH_BATCH_SIZE,
  instanceNodePosition,
  instanceEdgeGeometry,
  neighborNodePosition,
  overviewPositions,
  overviewRelations,
  overviewClassHeadings,
} from "../data-browser/instance-graph-rendering";

const nodes = Array.from({ length: 451 }, (_, index) => ({
  id: `node:${index}`, name: `Node ${index}`, class: "Item",
}));
const edges = nodes.slice(1).map((node) => ({ source: nodes[0].id, target: node.id }));

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
    expect(headings[0].y).toBe(274);
  });

  it("does not push headings across neighboring rows when both sides are crowded", () => {
    const bounds = { x: 100, y: 200, width: 80, height: 58 };
    const [heading] = overviewClassHeadings([
      { name: "A", bounds, width: 200, height: 54 },
    ], [
      { x: 20, y: 70, width: 240, height: 114 },
      { x: 20, y: 274, width: 240, height: 114 },
    ]);
    expect(heading.x + heading.width / 2).toBe(140);
    expect(heading.y + heading.height).toBe(bounds.y - 16);
  });

  it("keeps an unobstructed class heading close to its instances", () => {
    expect(overviewClassHeadings([
      { name: "A", bounds: { x: 100, y: 200, width: 80, height: 50 }, width: 200, height: 54 },
    ], [])[0]).toEqual({ name: "A", x: 40, y: 130, width: 200, height: 54 });
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
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(4);
    expect(result.edges.map((edge) => edge.data)).toEqual([
      { type: "owns", count: 2, aggregated: true },
      { type: "owns", count: 1, aggregated: true },
      { type: "reviews", count: 1, aggregated: true },
      { type: "parent", count: 1, aggregated: true },
    ]);
    expect(result.edges[0].source).toBe(result.edges[1].target);
    expect(result.edges[0].target).toBe(result.edges[1].source);
    expect(result.edges[3].style.loop).toBe(true);
    expect(result.edges[0].style.curveOffset).not.toBe(result.edges[2].style.curveOffset);
    const selected = overviewRelations(sample, relations, positions, "A:2");
    expect(selected.edges.slice(4).map((edge) => [edge.source, edge.target])).toEqual([
      ["A:2", "B:1"], ["A:1", "A:2"],
    ]);
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
  it("separates parallel relationships and draws self relationships as loops", () => {
    const geometry = instanceEdgeGeometry([
      { source: "A", target: "B", type: "owns" },
      { source: "A", target: "B", type: "reviews" },
      { source: "A", target: "A", type: "parent" },
    ]);
    expect(geometry[0].type).toBe("quadratic");
    expect(geometry[0].style.curveOffset).not.toBe(geometry[1].style.curveOffset);
    expect(geometry[2].style.loop).toBe(true);
  });

  it("places later neighborhood pages beyond earlier positions", () => {
    const center = { x: 15, y: 20 };
    const first = neighborNodePosition(0, center);
    const later = neighborNodePosition(100, center);
    expect(Math.hypot(later.x - center.x, later.y - center.y)).toBeGreaterThan(Math.hypot(first.x - center.x, first.y - center.y));
  });
  it("draws bounded batches, yields between draws and adds edges only after their endpoints", async () => {
    const batches: GraphData[] = [];
    const knownIds = new Set<string>();
    let yielded = false;
    const target = {
      addData(data: GraphData) {
        expect(yielded).toBe(true);
        expect((data.nodes?.length || 0) + (data.edges?.length || 0)).toBeLessThanOrEqual(GRAPH_BATCH_SIZE);
        data.nodes?.forEach((node) => knownIds.add(node.id));
        data.edges?.forEach((edge) => {
          expect(knownIds.has(edge.source)).toBe(true);
          expect(knownIds.has(edge.target)).toBe(true);
        });
        batches.push(data);
        yielded = false;
      },
      draw: vi.fn(async () => {}),
    };
    const progress: number[] = [];
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => true,
      yieldControl: async () => { yielded = true; },
      onProgress: (completed) => progress.push(completed),
    })).toBe(true);
    expect(batches.flatMap((batch) => batch.nodes || []).map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(batches.flatMap((batch) => batch.edges || [])).toHaveLength(edges.length);
    expect(progress.at(-1)).toBe(nodes.length + edges.length);
    expect(progress.every((value, index) => index === 0 || value > progress[index - 1])).toBe(true);
  });

  it("does not touch a replaced or unmounted graph after yielding", async () => {
    const target = { addData: vi.fn(), draw: vi.fn(async () => {}) };
    let current = true;
    const progress = vi.fn();
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => current,
      yieldControl: async () => { current = false; },
      onProgress: progress,
    })).toBe(false);
    expect(target.addData).not.toHaveBeenCalled();
    expect(target.draw).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("stops after an in-flight draw without publishing stale progress or starting another batch", async () => {
    let current = true;
    const target = {
      addData: vi.fn(),
      draw: vi.fn(async () => { current = false; }),
    };
    const progress = vi.fn();
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => current,
      yieldControl: async () => {},
      onProgress: progress,
    })).toBe(false);
    expect(target.addData).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });

  it("assigns distinct finite positions to every node", () => {
    expect(nodes.every((_, index) => Object.values(instanceNodePosition(index, nodes.length)).every(Number.isFinite))).toBe(true);
    expect(new Set(nodes.map((_, index) => JSON.stringify(instanceNodePosition(index, nodes.length)))).size).toBe(nodes.length);
  });
});
