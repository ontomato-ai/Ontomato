import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import TableRenderer from "../renderers/TableRenderer.vue";
import { shellContextKey, type ShellContext } from "../context";

vi.mock("../renderers/SubgraphView.vue", () => ({ default: { template: '<div class="test-graph">Lineage graph</div>' } }));

const labels = {
  datasetLineage: "Lineage", showLineage: "Show graph", hideLineage: "Hide graph",
  lineageSources: "Objects", lineageFields: "Fields", lineageOperations: "Calculations", lineageOutputs: "Result columns",
  truncatedRows: (limit: number) => `First ${limit} rows only`,
  filterColumn: (column: string) => `Filter ${column}`, filterSearch: "Search", filterAll: "All", filterEmpty: "(Empty)",
};

// Readers could not see how a dataset was obtained without switching its card to another tab: the queries and their
// conditions now stand under the table, and the graph opens in place. A partial result says so under the table.
it("states a dataset's queries and conditions under its table and opens the graph in place", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dataset = {
    columns: [{ key: "value", label: "Value" }],
    rows: [{ value: 1 }],
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
    expect(root.querySelector(".partial")?.textContent).toBe("First 500 rows only");
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
