import { describe, expect, it } from "vitest";
import { querySubgraphSchema, type QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { buildSubgraphModel } from "../renderers/subgraph-layout";

function valid(graph: QuerySubgraph): QuerySubgraph {
  return querySubgraphSchema.parse(graph);
}

describe("buildSubgraphModel", () => {
  it("lays out an ABC ontology path with class-scoped fields, filters, and multi-target HAVING filters", () => {
    const graph = valid({
      schema: "ontomato.query-subgraph.v1",
      queries: [{ id: "q1", label: "Active staff count by college" }],
      nodes: [
        { id: "c_college", kind: "class", queryId: "q1", label: "College", className: "/College", variable: "c" },
        { id: "c_dept", kind: "class", queryId: "q1", label: "Department", className: "/Department", variable: "d" },
        { id: "c_staff", kind: "class", queryId: "q1", label: "Staff", className: "/Staff", variable: "s" },
        { id: "f_college_name", kind: "field", label: "College Name", attrName: "name" },
        { id: "f_staff_status", kind: "field", label: "Status", attrName: "status" },
        { id: "f_staff_id", kind: "field", label: "Staff ID", attrName: "id" },
        { id: "op_count", kind: "operation", queryId: "q1", operation: "aggregate", label: "Staff Count", expression: "COUNT(s.id)" },
        { id: "out_college", kind: "output", key: "college", label: "College" },
        { id: "out_count", kind: "output", key: "staff_count", label: "Staff Count" },
      ],
      edges: [
        { id: "r1", kind: "relation", source: "c_college", target: "c_dept", label: "has department", name: "has_dept", relationType: "HAS_DEPT", direction: "forward", hops: { min: 1, max: 1 } },
        { id: "r2", kind: "relation", source: "c_dept", target: "c_staff", label: "employs", name: "employs", relationType: "EMPLOYS", direction: "forward", hops: { min: 1, max: 2 } },
        { id: "e_c1", kind: "contains", source: "c_college", target: "f_college_name" },
        { id: "e_c2", kind: "contains", source: "c_staff", target: "f_staff_status" },
        { id: "e_c3", kind: "contains", source: "c_staff", target: "f_staff_id" },
        { id: "d1", kind: "dependency", source: "f_staff_id", target: "op_count", role: "value", label: "" },
        { id: "d2", kind: "dependency", source: "f_college_name", target: "op_count", role: "group", label: "" },
        { id: "d3", kind: "dependency", source: "f_college_name", target: "out_college", role: "value", label: "" },
        { id: "d4", kind: "dependency", source: "op_count", target: "out_count", role: "value", label: "" },
      ],
      filters: [
        { id: "flt_status", queryId: "q1", targetIds: ["f_staff_status"], label: "Status = Active", expression: "s.status = 'active'" },
        // Multi-target HAVING filter targeting both the underlying field and the aggregate operation.
        { id: "flt_having", queryId: "q1", targetIds: ["f_staff_id", "op_count"], label: "Staff Count > 10", expression: "COUNT(s.id) > 10" },
      ],
    });

    const model = buildSubgraphModel(graph);
    expect(model.hasClasses).toBe(true);
    expect(model.hasDetails).toBe(true);
    expect(model.bands).toHaveLength(1);

    const band = model.bands[0]!;
    expect(band.classes.map((c) => [c.id, c.col])).toEqual([
      ["c_college", 0],
      ["c_dept", 1],
      ["c_staff", 2],
    ]);
    // Department is a pure traversal node with no fields or filters.
    const dept = band.classes.find((c) => c.id === "c_dept")!;
    expect(dept.fields).toEqual([]);
    expect(dept.filters).toEqual([]);

    // Staff receives both filters with their targeted field labels recorded.
    const staff = band.classes.find((c) => c.id === "c_staff")!;
    expect(staff.fields.map((f) => [f.label, f.filtered])).toEqual([
      ["Status", true],
      ["Staff ID", true],
    ]);
    expect(staff.filters.map((f) => [f.id, f.targetFieldLabels])).toEqual([
      ["flt_status", ["Status"]],
      ["flt_having", ["Staff ID"]],
    ]);

    // The multi-target HAVING filter also stays attached to the aggregate operation node.
    expect(model.operations).toHaveLength(1);
    expect(model.operations[0]!.filters.map((f) => f.id)).toEqual(["flt_having"]);
    expect(model.operations[0]!.inputs).toEqual([
      { id: "f_staff_id", label: "Staff ID", role: "value" },
      { id: "f_college_name", label: "College Name", role: "group" },
    ]);

    // Relation edge includes hop range suffix when max !== 1.
    expect(band.edges.find((e) => e.id === "r1")?.displayLabel).toBe("has department");
    expect(band.edges.find((e) => e.id === "r2")?.displayLabel).toBe("employs [1–2]");
    expect(model.outputs.map((o) => [o.key, o.sourceLabel])).toEqual([
      ["college", "College Name"],
      ["staff_count", "Staff Count"],
    ]);
  });

  it("keeps duplicate class occurrences in self-joins distinct and disambiguates their fields", () => {
    const graph = valid({
      schema: "ontomato.query-subgraph.v1",
      queries: [{ id: "q1", label: "Employees and managers" }],
      nodes: [
        { id: "c_emp", kind: "class", queryId: "q1", label: "Staff", className: "/Staff", variable: "emp" },
        { id: "c_mgr", kind: "class", queryId: "q1", label: "Staff", className: "/Staff", variable: "mgr" },
        { id: "f_emp_name", kind: "field", label: "Name", attrName: "name" },
        { id: "f_mgr_name", kind: "field", label: "Name", attrName: "name" },
        { id: "out_emp", kind: "output", key: "emp_name", label: "Employee" },
        { id: "out_mgr", kind: "output", key: "mgr_name", label: "Manager" },
      ],
      edges: [
        { id: "r1", kind: "relation", source: "c_emp", target: "c_mgr", label: "reports to", name: "reports_to", relationType: "REPORTS_TO", direction: "forward", hops: { min: 1, max: 1 } },
        { id: "c1", kind: "contains", source: "c_emp", target: "f_emp_name" },
        { id: "c2", kind: "contains", source: "c_mgr", target: "f_mgr_name" },
        { id: "d1", kind: "dependency", source: "f_emp_name", target: "out_emp", role: "value", label: "" },
        { id: "d2", kind: "dependency", source: "f_mgr_name", target: "out_mgr", role: "value", label: "" },
      ],
      filters: [],
    });

    const model = buildSubgraphModel(graph);
    expect(model.bands[0]!.classes).toHaveLength(2);
    expect(model.bands[0]!.classes.every((c) => c.showVariable)).toBe(true);
    expect(model.outputs.map((o) => o.sourceLabel)).toEqual([
      "Staff (emp) · Name",
      "Staff (mgr) · Name",
    ]);
  });

  it("handles multi-query cross-query merges, degenerate no-class graphs, and cyclic/self-loop relations safely", () => {
    const mergeGraph = valid({
      schema: "ontomato.query-subgraph.v1",
      queries: [
        { id: "q1", label: "Budget" },
        { id: "q2", label: "Spend" },
      ],
      nodes: [
        { id: "c1", kind: "class", queryId: "q1", label: "Project", className: "/Project", variable: "p1" },
        { id: "c2", kind: "class", queryId: "q2", label: "Expense", className: "/Expense", variable: "e1" },
        { id: "f1", kind: "field", label: "Budget", attrName: "budget" },
        { id: "f2", kind: "field", label: "Amount", attrName: "amount" },
        { id: "op_join", kind: "operation", queryId: null, operation: "join", label: "Merge budget & spend", expression: "df1.merge(df2)" },
        { id: "op_rate", kind: "operation", queryId: null, operation: "calculate", label: "Utilization", expression: "amount / budget" },
        { id: "out_rate", kind: "output", key: "rate", label: "Utilization" },
      ],
      edges: [
        { id: "e1", kind: "contains", source: "c1", target: "f1" },
        { id: "e2", kind: "contains", source: "c2", target: "f2" },
        { id: "d1", kind: "dependency", source: "f1", target: "op_join", role: "join", label: "" },
        { id: "d2", kind: "dependency", source: "f2", target: "op_join", role: "join", label: "" },
        { id: "d3", kind: "dependency", source: "op_join", target: "op_rate", role: "value", label: "" },
        { id: "d4", kind: "dependency", source: "op_rate", target: "out_rate", role: "value", label: "" },
      ],
      filters: [],
    });

    const mergeModel = buildSubgraphModel(mergeGraph);
    expect(mergeModel.bands).toHaveLength(2);
    // Cross-query operations appear once in dependency order.
    expect(mergeModel.operations.map((op) => op.id)).toEqual(["op_join", "op_rate"]);

    const constantGraph = valid({
      schema: "ontomato.query-subgraph.v1",
      queries: [],
      nodes: [
        { id: "op_const", kind: "operation", queryId: null, operation: "constant", label: "Target", expression: "100" },
        { id: "out_target", kind: "output", key: "target", label: "Target" },
      ],
      edges: [{ id: "d1", kind: "dependency", source: "op_const", target: "out_target", role: "value", label: "" }],
      filters: [],
    });
    const constModel = buildSubgraphModel(constantGraph);
    expect(constModel.hasClasses).toBe(false);
    expect(constModel.hasDetails).toBe(true);
    expect(constModel.operations).toHaveLength(1);
    expect(constModel.outputs).toHaveLength(1);

    const cyclicGraph = valid({
      schema: "ontomato.query-subgraph.v1",
      queries: [{ id: "q1", label: "Cyclic" }],
      nodes: [
        { id: "a", kind: "class", queryId: "q1", label: "A", className: "/A", variable: "a" },
        { id: "b", kind: "class", queryId: "q1", label: "B", className: "/B", variable: "b" },
      ],
      edges: [
        { id: "r_ab", kind: "relation", source: "a", target: "b", label: "to b", name: "ab", relationType: "AB", direction: "forward", hops: { min: 1, max: 1 } },
        { id: "r_ba", kind: "relation", source: "b", target: "a", label: "to a", name: "ba", relationType: "BA", direction: "forward", hops: { min: 1, max: 1 } },
        { id: "r_self", kind: "relation", source: "a", target: "a", label: "parent", name: "parent", relationType: "PARENT", direction: "both", hops: { min: 1, max: null } },
      ],
      filters: [],
    });
    const cyclicModel = buildSubgraphModel(cyclicGraph);
    expect(cyclicModel.bands[0]!.width).toBeGreaterThan(0);
    expect(cyclicModel.bands[0]!.height).toBeGreaterThan(0);
    expect(cyclicModel.bands[0]!.edges).toHaveLength(3);
    expect(cyclicModel.bands[0]!.edges.every((edge) => !edge.path.includes("NaN"))).toBe(true);

    const emptyModel = buildSubgraphModel(valid({ schema: "ontomato.query-subgraph.v1", queries: [], nodes: [], edges: [], filters: [] }));
    expect(emptyModel.hasClasses).toBe(false);
    expect(emptyModel.hasDetails).toBe(false);
  });
});
