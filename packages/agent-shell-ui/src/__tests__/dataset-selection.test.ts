import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import TableRenderer from "../renderers/TableRenderer.vue";
import { shellContextKey, type ShellContext } from "../context";

it("preserves raw selected rows and dataset scope across pagination when continuing analysis", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const proceed = vi.fn().mockResolvedValue(undefined);
  const rows = Array.from({ length: 10 }, (_, n) => ({ id: `000${n}`, value: n === 0 ? false : n, note: n === 0 ? null : "text" }));
  const app = createApp({ render: () => h(TableRenderer, {
    artifact: { id: "artifact", runId: "run", path: "outputs/data.dataset.json" } as never,
    title: "Staff", presentation: "inline", continueConversation: proceed,
    read: async () => new Blob([JSON.stringify({ question: "Active staff in 2025", assumptions: ["Active only"], truncation: null,
      columns: [{ key: "id", label: "ID" }, { key: "value", label: "Value" }, { key: "note", label: "Note" }], rows })]),
  }) });
  app.provide(shellContextKey, { labels: ref({ rows: (n: number) => `${n} rows`, nextPage: "Next", previousPage: "Previous", compareSelection: "Compare selection" }) } as unknown as ShellContext);
  app.mount(root);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await nextTick();
    root.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.click(); await nextTick();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Compare selection")!.click();
    await nextTick();
    expect(proceed).toHaveBeenCalledTimes(1);
    const context = JSON.parse(proceed.mock.calls[0]![0].split("\n").at(-1));
    expect(context.rows).toEqual([rows[0], rows[8]]);
    expect(context.artifactId).toBe("artifact");
    expect(context.question).toBe("Active staff in 2025");
    expect(context.assumptions).toEqual(["Active only"]);
  } finally { app.unmount(); root.remove(); }
});
