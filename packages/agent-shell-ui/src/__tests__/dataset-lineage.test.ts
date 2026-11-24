import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import TableRenderer from "../renderers/TableRenderer.vue";
import { shellContextKey, type ShellContext } from "../context";

vi.mock("../renderers/SubgraphView.vue", () => ({ default: { template: '<div class="test-graph">Lineage graph</div>' } }));

const labels = {
  datasetLineage: "Lineage", showLineage: "Show graph", hideLineage: "Hide graph",
  lineageFields: "Fields", lineageOperations: "Calculations", lineageOutputs: "Result columns",
  truncatedRows: (limit: number) => `First ${limit} rows only`,
  datasetUncheckedConditions: (conditions: string[]) => `Unverified: ${conditions.join(", ")}`,
  filterColumn: (column: string) => `Filter ${column}`, filterSearch: "Search", filterAll: "All", filterEmpty: "(Empty)",
};

// Readers could not see how a dataset was obtained without switching its card to another tab: the queries and their
// Conditions and truncation that affect interpretation appear before the rows.
it("states a dataset's queries and conditions under its table and opens the graph in place", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dataset = {
    schema: "workbench.dataset.v2",
    columns: [{ key: "value", label: "Value" }, { key: "recorded", label: "Recorded" }],
    rows: [
      { value: 1, recorded: "2024-12-30T00:00:00+08:00" },
      { value: 2, recorded: "2024-12-30T14:35:12+08:00" },
    ],
    queryIntent: { schema: "ontomato.query-intent.v1", outputs: ["Staff count"], conditions: [
      { id: "date", quote: "hired this year", mapping: null },
      { id: "status", quote: "active staff", mapping: null },
    ] },
    queryCoverage: { status: "partial", checks: [], conditions: [
      { id: "date", status: "unmapped" }, { id: "status", status: "present" },
    ] },
    truncation: { truncated: true, rowLimit: 500, truncationHint: "for the model" },
    sourceAnalysis: {
      schema: "ontomato.query-subgraph.v1",
      queries: [{ id: "q", label: "Staff by college" }],
      nodes: [],
      edges: [],
      filters: [{ id: "f", queryId: "q", targetIds: ["x"], label: "Status = active", expression: "status = 'active'" }],
    },
  };
  const app = createApp({ render: () => h(TableRenderer, {
    artifact: { id: "dataset", path: "outputs/example.dataset.json" } as never,
    title: "Example", presentation: "inline",
    read: async () => new Blob([JSON.stringify(dataset)]),
  }) });
  app.provide(shellContextKey, { labels: ref(labels) } as unknown as ShellContext);
  app.mount(root);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(root.querySelector("table")).not.toBeNull();
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    expect(root.querySelector(".table-preview-pager")).toBeNull();
    expect(root.querySelector('[title="2024-12-30T00:00:00+08:00"]')?.textContent).toBe("2024-12-30");
    expect(root.querySelector('[title="2024-12-30T14:35:12+08:00"]')?.textContent).toBe("2024-12-30 14:35:12");
    const notes = [...root.querySelectorAll(".partial")];
    expect(notes.map(note => note.textContent?.trim())).toEqual(["Unverified: hired this year", "First 500 rows only"]);
    expect(notes[1].compareDocumentPosition(root.querySelector("table")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(root.querySelector(".lineage-queries")?.textContent).toContain("Staff by college");
    expect(root.querySelector(".lineage-filter")?.textContent).toBe("Status = active");
    expect(root.querySelector(".test-graph")).toBeNull();
    root.querySelector<HTMLButtonElement>(".lineage-toggle")!.click();
    await nextTick();
    expect(root.querySelector(".test-graph")).not.toBeNull();
    expect(root.querySelector("table")).not.toBeNull();
  } finally {
    app.unmount();
    root.remove();
  }
});
