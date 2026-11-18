import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import ArtifactImageNode from "../components/ArtifactImageNode.vue";
import ShellSidePanel from "../components/ShellSidePanel.vue";
import { messageContextKey, shellContextKey, type ShellContext } from "../context";
import type { OpenArtifact } from "../types";

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

it.each([
  ["Staff by department", "Staff by department", "Staff by department"],
  ["", "staff.chart.json", undefined],
])("passes the image caption to inline and expanded actions (alt %j)", async (alt, title, caption) => {
  const root = document.createElement("div");
  const open = ref<OpenArtifact | null>(null);
  const scopes: Record<string, unknown>[] = [];
  const artifact = { id: "a1", runId: "r1", path: "outputs/staff.chart.json" };
  const app = createApp(() => h("div", [
    h(MarkdownView, {
      content: `![${alt}](${artifact.path})`,
      final: true,
      nodes: { image: ArtifactImageNode },
    }),
    open.value ? h(ShellSidePanel, { open: open.value }) : null,
  ]));
  app.provide(shellContextKey, {
    labels: ref({ download: "Download", close: "Close", open: "Open" }),
    resolveArtifact: async () => artifact,
    artifactRevision: ref(0),
    openArtifact: (artifact: OpenArtifact) => { open.value = artifact; },
    slots: { artifactActions: (scope: Record<string, unknown>) => (scopes.push(scope), []) },
  } as unknown as ShellContext);
  app.provide(messageContextKey, ref({ runId: "r1" }));
  document.body.append(root);
  app.mount(root);
  try {
    await vi.waitFor(() => expect(scopes.at(-1)).toMatchObject({ artifact, title }));
    expect(scopes.at(-1)?.caption).toBe(caption);
    root.querySelector<HTMLButtonElement>(".inline-expand")!.click();
    await nextTick();
    expect(root.querySelector(".side-panel")).not.toBeNull();
    expect(scopes.at(-1)).toMatchObject({ artifact, title });
    expect(scopes.at(-1)?.caption).toBe(caption);
  } finally {
    app.unmount();
    root.remove();
  }
});
