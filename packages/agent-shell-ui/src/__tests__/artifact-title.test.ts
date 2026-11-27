import { expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { Table2 } from "lucide-vue-next";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { fileKind } from "../artifacts";
import { artifactIcon } from "../icons";
import ArtifactLinkNode from "../components/ArtifactLinkNode.vue";
import { messageContextKey, shellContextKey, type ShellContext } from "../context";
import type { OpenArtifact } from "../types";

// A report's file card and the panel it opens name the file with the title's words, not its Markdown marks: the card
// showed "…the *Last Questio…" while the report headed the same file in italics.
it("shows a Markdown title as plain text in the file card and the panel it opens", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const opened: OpenArtifact[] = [];
  const artifact = { id: "report", runId: "r1", path: "outputs/report.md", size: 4096 };
  const app = createApp(() =>
    h(MarkdownView, {
      content: "See [Celestial bodies in the *Last Question* ontology — `stored` **types**](outputs/report.md)",
      final: true,
      nodes: { link: ArtifactLinkNode },
    }),
  );
  app.provide(shellContextKey, {
    labels: ref({}),
    resolveArtifact: async () => artifact,
    artifactRevision: ref(0),
    openArtifact: (open: OpenArtifact) => opened.push(open),
    openArtifactKey: ref(null),
    pageLink: () => null,
  } as unknown as ShellContext);
  app.provide(messageContextKey, ref({ runId: "r1" }));
  app.mount(root);
  try {
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".artifact-card")!.disabled).toBe(false));
    const title = "Celestial bodies in the Last Question ontology — stored types";
    expect(root.querySelector(".artifact-card__title")!.textContent).toBe(title);
    root.querySelector<HTMLButtonElement>(".artifact-card")!.click();
    expect(opened.at(-1)!.title).toBe(title);
  } finally {
    app.unmount();
    root.remove();
  }
});

it("labels .dataset.json files as DATASET with a table icon instead of JSON", async () => {
  expect(fileKind("outputs/sales.dataset.json")).toBe("dataset");
  expect(artifactIcon("outputs/sales.dataset.json")).toBe(Table2);

  const root = document.createElement("div");
  document.body.append(root);
  const artifact = { id: "ds", runId: "r1", path: "outputs/sales.dataset.json", size: 2048 };
  const app = createApp(() =>
    h(MarkdownView, {
      content: "See [Sales dataset](outputs/sales.dataset.json)",
      final: true,
      nodes: { link: ArtifactLinkNode },
    }),
  );
  app.provide(shellContextKey, {
    labels: ref({}),
    resolveArtifact: async () => artifact,
    artifactRevision: ref(0),
    openArtifact: vi.fn(),
    openArtifactKey: ref(null),
    pageLink: () => null,
  } as unknown as ShellContext);
  app.provide(messageContextKey, ref({ runId: "r1" }));
  app.mount(root);
  try {
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".artifact-card")!.disabled).toBe(false));
    expect(root.querySelector(".artifact-card__icon")?.getAttribute("data-kind")).toBe("dataset");
    expect(root.querySelector(".artifact-card__meta")?.textContent).toContain("DATASET");
  } finally {
    app.unmount();
    root.remove();
  }
});
