import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import SubgraphView from "../renderers/SubgraphView.vue";
import { shellContextKey, type ShellContext } from "../context";

const sampleGraph: QuerySubgraph = {
  schema: "ontomato.query-subgraph.v1",
  queries: [{ id: "q1", label: "Active staff by college" }],
  nodes: [
    { id: "c_college", kind: "class", queryId: "q1", label: "College", className: "/College", variable: "c" },
    { id: "c_staff", kind: "class", queryId: "q1", label: "Staff", className: "/Staff", variable: "s" },
    { id: "f_name", kind: "field", label: "College Name", attrName: "name" },
    { id: "f_status", kind: "field", label: "Status", attrName: "status" },
    { id: "op_cnt", kind: "operation", queryId: "q1", operation: "aggregate", label: "Staff Count", expression: "COUNT(s.id)" },
    { id: "out_cnt", kind: "output", key: "cnt", label: "Staff Count" },
  ],
  edges: [
    { id: "r1", kind: "relation", source: "c_college", target: "c_staff", label: "has staff", name: "has_staff", relationType: "HAS_STAFF", direction: "forward", hops: { min: 1, max: 1 } },
    { id: "e1", kind: "contains", source: "c_college", target: "f_name" },
    { id: "e2", kind: "contains", source: "c_staff", target: "f_status" },
    { id: "d1", kind: "dependency", source: "f_status", target: "op_cnt", role: "value", label: "" },
    { id: "d2", kind: "dependency", source: "op_cnt", target: "out_cnt", role: "value", label: "" },
  ],
  filters: [
    { id: "flt1", queryId: "q1", targetIds: ["f_status"], label: "Status = Active", expression: "s.status = 'active'" },
  ],
};

it("renders ABC class path cards, relation pills, popover details on click, and operation/output summary", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(SubgraphView, { graph: sampleGraph }) });
  app.provide(shellContextKey, {
    labels: ref({
      lineageFilters: "Filters",
      lineageFields: "Fields",
      lineageOperations: "Calculations",
      lineageOutputs: "Result columns",
      lineageFilterCount: (n: number) => `${n} filters`,
      lineageFieldCount: (n: number) => `${n} fields`,
    }),
  } as unknown as ShellContext);
  app.mount(root);
  try {
    await nextTick();
    const cards = [...root.querySelectorAll<HTMLButtonElement>(".class-node")];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("College");
    expect(cards[1]!.textContent).toContain("Staff");
    expect(cards[1]!.classList.contains("filtered")).toBe(true);
    expect(cards[1]!.textContent).toContain("1 filters");
    expect(cards[1]!.textContent).toContain("1 fields");
    expect(root.querySelector(".relation-pill")?.textContent?.trim()).toBe("has staff");
    expect(root.querySelectorAll("svg path.relation-path")).toHaveLength(1);
    expect(root.querySelector(".subgraph-details")?.textContent).toContain("Staff Count");

    // Clicking the filtered class node opens its popover with filter and field details.
    cards[1]!.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain("Status = Active");
    expect(document.body.textContent).toContain("s.status = 'active'");
  } finally {
    app.unmount();
    root.remove();
  }
});

it("renders nothing for an empty graph and keeps unique SVG marker ids across multiple bands", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const graph = ref<QuerySubgraph>({ schema: "ontomato.query-subgraph.v1", queries: [], nodes: [], edges: [], filters: [] });
  const app = createApp({ render: () => h(SubgraphView, { graph: graph.value }) });
  app.mount(root);
  try {
    await nextTick();
    expect(root.querySelector(".subgraph")).toBeNull();

    graph.value = {
      schema: "ontomato.query-subgraph.v1",
      queries: [
        { id: "q1", label: "Q1" },
        { id: "q2", label: "Q2" },
      ],
      nodes: [
        { id: "c1", kind: "class", queryId: "q1", label: "A", className: "/A", variable: "a" },
        { id: "c2", kind: "class", queryId: "q2", label: "B", className: "/B", variable: "b" },
      ],
      edges: [],
      filters: [],
    };
    await nextTick();
    const markerIds = [...root.querySelectorAll("svg marker")].map((m) => m.id);
    expect(markerIds).toHaveLength(4);
    expect(new Set(markerIds).size).toBe(4);
  } finally {
    app.unmount();
    root.remove();
  }
});
