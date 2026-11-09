import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import TableRenderer from "../renderers/TableRenderer.vue";
import { shellContextKey, type ShellContext } from "../context";

it("passes original row indices across pages to host-owned dataset selection actions", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const artifact = { id: "dataset", path: "outputs/result.dataset.json" } as never;
  const app = createApp({ render: () => h(TableRenderer, {
    artifact, title: "Result", presentation: "inline",
    read: async () => new Blob([JSON.stringify({ columns: [{ key: "department", label: "Department" }], rows: Array.from({ length: 10 }, (_, index) => ({ department: index })) })]),
  }) });
  app.provide(shellContextKey, { labels: ref({ rows: (count: number) => `${count} rows`, nextPage: "Next" }),
    continueConversation: async () => {}, slots: { datasetSelectionActions: ({ artifact: source, selectedRowIndices }: { artifact: { id: string }; selectedRowIndices: number[] }) => h("span", { class: "host-selection" }, `${source.id}:${selectedRowIndices.join(",")}`) },
  } as unknown as ShellContext);
  app.mount(root);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await nextTick();
    expect(root.querySelector(".host-selection")?.textContent).toBe("dataset:0");
    root.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!.click(); await nextTick();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await nextTick();
    expect(root.querySelector(".host-selection")?.textContent).toBe("dataset:0,8");
  } finally { app.unmount(); root.remove(); }
});
