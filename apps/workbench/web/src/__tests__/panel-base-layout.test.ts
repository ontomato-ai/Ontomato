import { afterEach, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  hostMessageOf, idlePanelSubscription, inside, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelHostFrame,
  panelRecord, panelUse, writeFrameDocument, type Sent,
} from "./panel-frame";

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
    <template #aside><p class="aside-text">Agents</p></template>
    <section-group title="Data scope" description="What the agent may read">
      <graph-canvas label="Data scope" selection="multiple" :nodes="nodes" :edges="edges" v-model:selected="chosen"></graph-canvas>
      <output>{{ chosen.join(",") }}</output>
    </section-group>
    <section-group title="Model"><p>Default</p></section-group>
  </two-pane-layout>
</div>`;
const use = panelUse("use-layout", "panels-layout", panel.id, "/layout");

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
  if (request.path === "/api/apps-sdk/current") return Response.json({
    version: "1.1.1", publicBasePath: "/apps-sdk", sdkBasePath: "/apps-sdk/1.1.1",
    manifestPath: "/apps-sdk/1.1.1/sdk.json", docsPath: "/apps-sdk/1.1.1/docs", referencePath: "/apps-sdk/1.1.1/reference",
  });
  if (request.path === "/api/product-assets/subscriptions") return idlePanelSubscription();
  if (request.path === "/api/product-assets/subscriptions/subscription-1") return new Response(null, { status: 204 });
  return nothingAt(request);
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("lays out the panel's HTML and draws its graph from the panel's own values, ready when the panel first draws", async () => {
  installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath", component: PanelApplicationRoute, props: true,
  }] });
  await router.push(`/applications/${application}/layout`);
  const { app } = mountPlatformPage(() => h(RouterView), router);
  try {
    const frame = await panelHostFrame();
    const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
    writeFrameDocument(hostMessageOf(frame.srcdoc));
    inside(frame.contentWindow!);
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
    expect(document.querySelector("#app .sdk-two-pane-aside .aside-text")?.textContent).toBe("Agents");
    expect([...document.querySelectorAll("#app .sdk-section-group-title")].map((title) => title.textContent)).toEqual(["Data scope", "Model"]);
    expect(document.querySelector('#app [data-node-id="Order"]')?.classList.contains("selected")).toBe(true);

    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector("#app output")?.textContent).toBe("Order,Customer"));
    expect(chosen.value).toEqual(["Order", "Customer"]);
    expect(document.querySelector('#app [data-node-id="Customer"]')?.classList.contains("selected")).toBe(true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  } finally {
    app.unmount();
  }
});
