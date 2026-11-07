import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import ShellMarkdown from "../components/ShellMarkdown.vue";
import { shellContextKey, type ShellContext } from "../context";

it("renders consecutive datasets alongside prose without losing their block boundaries", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ShellMarkdown, {
    content: "Intro paragraph.\n\n## Results\n\n![First](outputs/first.csv)\n\n![Second](outputs/second.csv)\n\n- First point\n- Second point\n\nConclusion.",
    final: true, runId: "run",
  }) });
  app.provide(shellContextKey, {
    labels: ref({ open: "Open", artifactMissing: "Missing" }),
    slots: {}, artifactRevision: ref(0), resolveArtifact: async () => null,
  } as unknown as ShellContext);
  app.mount(root);
  try {
    await nextTick();
    await nextTick();
    expect(root.querySelectorAll(".inline-artifact")).toHaveLength(2);
    const slots = root.querySelectorAll(".shell-markdown > .node-slot");
    expect(slots).toHaveLength(6);
    expect(slots[1]!.querySelector(":scope > .node-content > h2")?.textContent).toBe("Results");
    expect(slots[2]!.querySelector(":scope > .node-content > p > .inline-artifact")).not.toBeNull();
    expect(slots[3]!.querySelector(":scope > .node-content > p > .inline-artifact")).not.toBeNull();
    expect(root.textContent).toContain("Conclusion.");
  } finally { app.unmount(); root.remove(); }
});
