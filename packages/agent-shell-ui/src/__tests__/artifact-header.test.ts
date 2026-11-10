import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import TableRenderer from "../renderers/TableRenderer.vue";
import { artifactHeaderKey, shellContextKey, type ShellContext } from "../context";

vi.mock("../renderers/SubgraphView.vue", () => ({ default: { template: '<div class="test-lineage">Lineage graph</div>' } }));

it("puts dataset switches in their artifact header and removes them when the renderer unmounts", async () => {
  const root = document.createElement("div");
  const header = document.createElement("div");
  document.body.append(header, root);
  const app = createApp({ render: () => h(TableRenderer, {
    artifact: { id: "dataset", path: "outputs/example.dataset.json" } as never,
    title: "Example", presentation: "inline",
    read: async () => new Blob([JSON.stringify({ columns: [{ key: "value", label: "Value" }], rows: [{ value: 1 }], sourceAnalysis: { schema: "ontomato.query-subgraph.v1" } })]),
  }) });
  app.provide(artifactHeaderKey, ref(header));
  app.provide(shellContextKey, { labels: ref({ datasetData: "Data", datasetLineage: "Lineage" }) } as unknown as ShellContext);
  app.mount(root);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(header.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector("table")).not.toBeNull();
    header.querySelectorAll<HTMLButtonElement>("button")[1]!.click();
    await nextTick();
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelector(".test-lineage")).not.toBeNull();
  } finally {
    app.unmount();
    expect(header.querySelector('[role="tablist"]')).toBeNull();
    root.remove(); header.remove();
  }
});
