import { createApp, h, nextTick } from "vue";
import { expect, it } from "vitest";
import HtmlRenderer from "../renderers/HtmlRenderer.vue";

// An agent's HTML file runs with scripts only, in an opaque origin that cannot reach the workbench session, and sends no
// referrer: the frame the shared HTML preview draws keeps exactly these rules.
it("runs an agent's HTML file in an opaque-origin sandbox, scripts only and without a referrer", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(HtmlRenderer, {
    artifact: { id: "page", runId: "run", path: "outputs/report.html" } as never,
    title: "Report", presentation: "inline",
    read: async () => new Blob(["<html><body>Quarterly report</body></html>"]),
  }) });
  app.mount(root);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick();
    const frame = root.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toContain("Quarterly report");
  } finally { app.unmount(); root.remove(); }
});
