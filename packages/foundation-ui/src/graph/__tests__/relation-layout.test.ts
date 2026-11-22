import { expect, it } from "vitest";
import { layoutByRelations, RELATION_COLUMN_GAP, RELATION_ROW_GAP } from "../relation-layout";
import { G6_LABEL_WIDTH } from "../g6-elements";
import type { GraphCanvasEdge, GraphCanvasNode } from "../types";

/*
 * Where the G6 canvas's callers put nodes nobody placed (G-01, 2026-11-21): by their relations, not in the order given.
 * The most connected node stands first, the nodes one relation away in the column after it, two away in the one after
 * that; a column too long for the room folds into several. The separate parts share the room the graph is shown in,
 * side by side or one below another as its shape takes them (panelisation lead, 2026-11-22), so a graph wider than tall
 * fills a wide canvas. No two names share a place, and the same graph in the same room is always laid out the same way,
 * so a reader finds a node where it was.
 */

/** The room of a 1440×900 screen's canvas (1072×556), its fit padding (36) taken off. */
const SCREEN = { width: 1000, height: 484 };

const node = (id: string): GraphCanvasNode => ({ id, label: id });
const edge = (source: string, target: string): GraphCanvasEdge => ({ id: `${source}-${target}`, source, target });

function apart(positions: ReadonlyMap<string, { x: number; y: number }>) {
  const points = [...positions.values()];
  for (let a = 0; a < points.length; a += 1)
    for (let b = a + 1; b < points.length; b += 1)
      expect(Math.abs(points[a]!.x - points[b]!.x) >= RELATION_COLUMN_GAP || Math.abs(points[a]!.y - points[b]!.y) >= RELATION_ROW_GAP).toBe(true);
}

it("puts the most connected node first and each node one relation further on in the next column", () => {
  // Given in an order that a grid would draw as rows: the hub third, its far end last.
  const nodes = ["a", "b", "hub", "c", "far"].map(node);
  const edges = [edge("a", "hub"), edge("hub", "b"), edge("c", "hub"), edge("far", "c")];
  const { positions, root } = layoutByRelations(nodes, edges, SCREEN);
  expect(root).toBe("hub");
  const column = (id: string) => Math.round((positions.get(id)!.x - positions.get("hub")!.x) / RELATION_COLUMN_GAP);
  expect(["hub", "a", "b", "c", "far"].map(column)).toEqual([0, 1, 1, 1, 2]);
  apart(positions);
  // The same graph, the same places.
  expect(layoutByRelations(nodes, edges, SCREEN).positions).toEqual(positions);
});

it("folds a long column, lays each separate part out on its own, and leaves no node out", () => {
  const leaves = Array.from({ length: 30 }, (_, index) => `leaf${index}`);
  const nodes = [...leaves, "hub", "x", "y", "alone"].map(node);
  const edges = [...leaves.map((leaf) => edge("hub", leaf)), edge("x", "y"), edge("hub", "missing")];
  const { positions, root } = layoutByRelations(nodes, edges, SCREEN);
  expect(root).toBe("hub");
  expect([...positions.keys()].sort()).toEqual(nodes.map(({ id }) => id).sort());
  apart(positions);
  // Thirty leaves are not one column taller than a screen.
  const rows = new Set(leaves.map((leaf) => positions.get(leaf)!.y));
  expect(rows.size).toBeLessThanOrEqual(10);
  // The second part and the lone node are outside the first, not mixed into it.
  const first = box(["hub", ...leaves].map((id) => positions.get(id)!));
  for (const id of ["x", "y", "alone"]) expect(inside(first, positions.get(id)!)).toBe(false);
});

/** The application ontology on the development platform, 2026-11-22: 19 object types, 14 relations, three parts. */
const ontology = {
  nodes: [["org", "组织机构"], ["person", "教职工"], ["tech_duty", "职称变动记录"], ["tech_gwdj", "岗位等级变动记录"], ["szxxsb_xh", "学会任职变动记录"],
    ["mgn_duty", "当前行政职务"], ["szxxsb", "人才荣誉与成果"], ["student_master", "硕士研究生"], ["paper", "论文"], ["e2e-expense", "e2e-报销单"],
    ["e2e_expense", "e2e-报销单-v2"], ["workflow_run", "Praxis 运行"], ["step_run", "Praxis 步骤运行"], ["approval_decision", "Praxis 审批决定"],
    ["model_decision", "Praxis 模型决定"], ["context_assembly", "Praxis 上下文装配"], ["m4t_widget", "M4测试物件"], ["m4o4_part", "M4O4 零件"],
    ["e2e_m4vm_cls", "e2e 模型验收类"]].map(([id, label]) => ({ id: id!, label: label! })),
  edges: [["person", "szxxsb_xh"], ["person", "mgn_duty"], ["person", "tech_duty"], ["person", "tech_gwdj"], ["student_master", "paper"],
    ["person", "student_master"], ["person", "org"], ["org", "org"], ["person", "szxxsb"], ["workflow_run", "step_run"], ["step_run", "approval_decision"],
    ["step_run", "model_decision"], ["step_run", "context_assembly"], ["approval_decision", "workflow_run"]].map(([source, target]) => edge(source!, target!)),
};
const box = (points: readonly { x: number; y: number }[]) => ({
  left: Math.min(...points.map(({ x }) => x)), right: Math.max(...points.map(({ x }) => x)),
  top: Math.min(...points.map(({ y }) => y)), bottom: Math.max(...points.map(({ y }) => y)),
});
const inside = (area: ReturnType<typeof box>, { x, y }: { x: number; y: number }) => x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
/** The zoom at which a laid-out graph fits a room whole: from the first name's left to the last name's right, a row each. */
function fitZoom(positions: ReadonlyMap<string, { x: number; y: number }>, room: { width: number; height: number }) {
  const all = box([...positions.values()]);
  return Math.min(room.width / (all.right - all.left + G6_LABEL_WIDTH), room.height / (all.bottom - all.top + RELATION_ROW_GAP));
}

it("lays the parts out to the room's shape, so a wide room shows the ontology larger than parts stacked would", () => {
  const { positions, root } = layoutByRelations(ontology.nodes, ontology.edges, SCREEN);
  expect(root).toBe("person");
  apart(positions);
  // Stacked one below another, its three parts are shown whole at 0.45 in a 1440 screen's room (4 columns, 14 rows);
  // side by side as the room takes them, at 0.67 — not the 0.83 its names read at: the parts are 4×6 and 2×4, so any
  // arrangement is 7 columns wide or 11 rows tall, and the room holds 5½ columns or 7 rows at 0.83.
  expect(fitZoom(positions, SCREEN)).toBeGreaterThan(0.65);
  // Wide room, wide drawing; tall room, tall drawing.
  const span = (room: { width: number; height: number }) => {
    const all = box([...layoutByRelations(ontology.nodes, ontology.edges, room).positions.values()]);
    return (all.right - all.left + G6_LABEL_WIDTH) / (all.bottom - all.top + RELATION_ROW_GAP);
  };
  expect(span({ width: 1600, height: 400 })).toBeGreaterThan(span({ width: 400, height: 1600 }));
  expect(span({ width: 400, height: 1600 })).toBeLessThan(1);
});

it("keeps a part's columns as its relations order them, however the room folds them", () => {
  const neighbours = ["szxxsb_xh", "mgn_duty", "tech_duty", "tech_gwdj", "student_master", "org", "szxxsb"];
  const reading = (room: { width: number; height: number }) => {
    const { positions } = layoutByRelations(ontology.nodes, ontology.edges, room);
    const at = (id: string) => positions.get(id)!;
    // The centre first, the nodes one relation away after it, the one two away after them.
    for (const id of neighbours) {
      expect(at(id).x).toBeGreaterThan(at("person").x);
      expect(at("paper").x).toBeGreaterThan(at(id).x);
    }
    // A folded column is read down, then on to the next.
    return [...neighbours].sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y);
  };
  // A room tall enough to hold the column unfolded gives its order; every room keeps it.
  const order = reading({ width: 400, height: 1600 });
  for (const room of [SCREEN, { width: 840, height: 484 }, { width: 1600, height: 400 }]) expect(reading(room)).toEqual(order);
});

it("has no first node when there are no nodes", () => {
  expect(layoutByRelations([], [], SCREEN)).toEqual({ positions: new Map(), root: undefined });
});
