import { expect, it } from "vitest";
import { layoutByForce } from "../force-layout";
import type { GraphCanvasEdge, GraphCanvasNode } from "../types";

const SCREEN = { width: 1000, height: 600 };
const node = (id: string, label = id): GraphCanvasNode => ({ id, label });
const edge = (source: string, target: string): GraphCanvasEdge => ({ id: `${source}-${target}`, source, target });

const ontology = {
  nodes: [
    ["org", "组织机构"], ["person", "教职工"], ["tech_duty", "职称变动记录"], ["tech_gwdj", "岗位等级变动记录"],
    ["szxxsb_xh", "学会任职变动记录"], ["mgn_duty", "当前行政职务"], ["szxxsb", "人才荣誉与成果"],
    ["student_master", "硕士研究生"], ["paper", "论文"], ["e2e-expense", "e2e-报销单"], ["e2e_expense", "e2e-报销单-v2"],
    ["workflow_run", "Praxis 运行"], ["step_run", "Praxis 步骤运行"], ["approval_decision", "Praxis 审批决定"],
    ["model_decision", "Praxis 模型决定"], ["context_assembly", "Praxis 上下文装配"],
    ["m4t_widget", "M4测试物件"], ["m4o4_part", "M4O4 零件"],
  ].map(([id, label]) => node(id!, label!)),
  edges: [
    ["person", "szxxsb_xh"], ["person", "mgn_duty"], ["person", "tech_duty"], ["person", "tech_gwdj"],
    ["student_master", "paper"], ["person", "student_master"], ["person", "org"], ["org", "org"],
    ["person", "szxxsb"], ["workflow_run", "step_run"], ["step_run", "approval_decision"],
    ["step_run", "model_decision"], ["step_run", "context_assembly"], ["approval_decision", "workflow_run"],
  ].map(([source, target]) => edge(source!, target!)),
};

it("places all nodes deterministically with generous separation and identifies the main hub", () => {
  const first = layoutByForce(ontology.nodes, ontology.edges, SCREEN, { nodeSize: 62, labelSize: 13 });
  const second = layoutByForce(ontology.nodes, ontology.edges, SCREEN, { nodeSize: 62, labelSize: 13 });

  expect(first.root).toBe("person");
  expect([...first.positions.keys()].sort()).toEqual(ontology.nodes.map((n) => n.id).sort());
  expect(first.positions).toEqual(second.positions);

  // Every pair of nodes maintains at least the minimum collision clearance so circles and labels never collide.
  const pts = [...first.positions.values()];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dist = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
      expect(dist).toBeGreaterThanOrEqual(110);
    }
  }
});

it("radiates hub neighbours in multiple directions rather than collapsing them into one line", () => {
  const { positions } = layoutByForce(ontology.nodes, ontology.edges, SCREEN, { nodeSize: 62, labelSize: 13 });
  const center = positions.get("person")!;
  const neighbours = ["szxxsb_xh", "mgn_duty", "tech_duty", "tech_gwdj", "student_master", "org", "szxxsb"];
  const left = neighbours.filter((id) => positions.get(id)!.x < center.x);
  const right = neighbours.filter((id) => positions.get(id)!.x > center.x);
  const above = neighbours.filter((id) => positions.get(id)!.y < center.y);
  const below = neighbours.filter((id) => positions.get(id)!.y > center.y);
  expect(left.length).toBeGreaterThanOrEqual(2);
  expect(right.length).toBeGreaterThanOrEqual(2);
  expect(above.length).toBeGreaterThanOrEqual(2);
  expect(below.length).toBeGreaterThanOrEqual(2);
});

it("returns empty layout when given no nodes", () => {
  expect(layoutByForce([], [], SCREEN)).toEqual({ positions: new Map(), root: undefined });
});
