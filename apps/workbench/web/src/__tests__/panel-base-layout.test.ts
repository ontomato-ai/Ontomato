import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument } from "./panel-frame";

/*
 * A panel's own HTML lays out its page with the SDK's layouts and draws a graph with its canvas, through the platform's
 * real host and bridge. The canvas keeps no selection of its own — the panel's value is what it draws — and the
 * components the HTML names are ready when the panel first draws, so a layout around every projection never holds the
 * page back for one more fetch.
 */

const application = "app-panels-layout";
const panel = panelRecord("panel-layout", "Layout panel", definePanel({ state: {}, slots: {}, operations: [] }));
panel.content.html = `
<div id="app">
  <two-pane-layout>
    <template #aside><p class="aside-text">{{ t("layout.agents", { count: 2 }) }}</p><p class="aside-missing">{{ t("layout.missing") }}</p></template>
    <section-group title="Data scope" description="What the agent may read">
      <graph-canvas label="Data scope" selection="multiple" :nodes="nodes" :edges="edges" v-model:selected="chosen"></graph-canvas>
      <output>{{ chosen.join(",") }}</output>
    </section-group>
    <section-group title="Model"><p>Default</p></section-group>
  </two-pane-layout>
</div>`;
// The panel's own words, by locale: the frame's language is English here.
panel.content.messages = { en: { "layout.agents": "Agents ({count})" }, "zh-CN": { "layout.agents": "智能体（{count}）" } };
const use = panelUse("use-layout", "panels-layout", panel.id, `/applications/${application}/layout`);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("lays out the panel's HTML and draws its graph from the panel's own values, ready when the panel first draws", async () => {
  installPlatform(nothingAt);
  const frame = panelFrame();
  platformPanelHost(application, use).frame(frame, registered(application, use, panel), true);
  writePanelDocument(registered(application, use, panel), `/applications/${application}/layout`, {});
  inside(frame);
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const chosen = ref(["Order"]);
  await mountPanel({
    setup: () => ({
      nodes: [{ id: "Order", label: "Order" }, { id: "Customer", label: "Customer", tone: "accent" }],
      edges: [{ id: "order-customer", source: "Order", target: "Customer", tone: "accent" }],
      chosen,
    }),
  });
  // Drawn at once: the layouts and the canvas the HTML names were fetched before the panel mounted.
  const node = document.querySelector<SVGGElement>('#app [data-node-id="Customer"]');
  expect(node).not.toBeNull();
  // The panel's words from its content, in the platform's language; a word it lacks shows its key.
  expect(document.querySelector("#app .sdk-two-pane-aside .aside-text")?.textContent).toBe("Agents (2)");
  expect(document.querySelector("#app .sdk-two-pane-aside .aside-missing")?.textContent).toBe("layout.missing");
  expect([...document.querySelectorAll("#app .sdk-section-group-title")].map((title) => title.textContent)).toEqual(["Data scope", "Model"]);
  expect(document.querySelector('#app [data-node-id="Order"]')?.classList.contains("selected")).toBe(true);

  node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector("#app output")?.textContent).toBe("Order,Customer"));
  expect(chosen.value).toEqual(["Order", "Customer"]);
  expect(document.querySelector('#app [data-node-id="Customer"]')?.classList.contains("selected")).toBe(true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
