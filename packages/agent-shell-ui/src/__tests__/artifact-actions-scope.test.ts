import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import ShellSidePanel from "../components/ShellSidePanel.vue";
import { shellContextKey, type ShellContext } from "../context";

vi.mock("../components/ArtifactView.vue", () => ({ default: { template: "<div />" } }));

/** A host's artifact actions get the name the shell shows for the file, so they never fall back to its storage path. */
it("gives the artifact-actions slot the title the panel shows", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const scopes: Record<string, unknown>[] = [];
  const artifact = { id: "a1", runId: "r1", path: "outputs/retrievals/x/y.dataset.json" };
  const app = createApp({
    render: () => h(ShellSidePanel, { open: { key: "k", artifact: artifact as never, title: "Staff by unit type dataset" } }),
  });
  app.provide(shellContextKey, {
    labels: ref({ download: "Download", close: "Close" }),
    slots: { artifactActions: (scope: Record<string, unknown>) => (scopes.push(scope), []) },
  } as unknown as ShellContext);
  app.mount(root);
  try {
    await nextTick();
    expect(scopes.at(-1)).toMatchObject({ artifact, title: "Staff by unit type dataset" });
  } finally {
    app.unmount();
    root.remove();
  }
});
