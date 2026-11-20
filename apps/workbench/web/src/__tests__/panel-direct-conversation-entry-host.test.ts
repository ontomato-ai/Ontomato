import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { DirectProjection, ProductPanel } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { servePageComposer } from "../../../../../packages/platform-web/src/app-host";
import { installPlatform, mountPlatformPage, nothingAt, panelAnswer, panelSnapshot, panelUse, PLACE_EVERY_MEMBER, type Sent } from "./panel-frame";

/*
 * A conversation entry in a panel run in the platform's document, at its application's address (big main's ruling, 2026-11-20):
 * pressed, it expands the page's composer — the one shown last — with the agent and sentence its projection declares,
 * through the same function a frame's entry reaches once checked. Nothing is sent.
 *
 * Real route, panel host, SDK instance and component; the network and the composer are stand-ins.
 *
 * What this rules out: a panel's entry the host never hands a composer to (it threw before the host passed one).
 */

const application = "app-knowledge";
const use = panelUse("use-knowledge", "knowledge", "panel-knowledge", `/applications/${application}/knowledge`);
const governance: PanelConversationEntry = {
  target: { kind: "id", id: "agent-knowledge-governance" },
  prefill: "Check this knowledge item",
};
const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const panel: ProductPanel = {
  ...base, id: use.panelId, name: "Knowledge",
  content: { html: '<div id="app"></div>', module: PLACE_EVERY_MEMBER },
  manifest: { state: {}, members: { governance: { target: { projectionId: "knowledge-governance" } } }, events: {} },
};
const projections: Record<string, DirectProjection> = {
  "knowledge-governance": {
    ...base, id: "knowledge-governance", name: "Knowledge governance", componentId: "@ontomato/sdk:ConversationEntry",
    inputs: {}, outputs: {}, config: {}, data: {}, conversationEntry: governance,
  },
};

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection) return Response.json({ projection: projections[decodeURIComponent(projection[1]!)] });
  return nothingAt(request);
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("expands the page's composer with the member's declared agent and sentence, sending nothing", async () => {
  const expanded: PanelConversationEntry[] = [];
  const stopServing = servePageComposer(entry => expanded.push(entry));
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId }),
  }] });
  await router.push(use.path);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    const button = await vi.waitFor(() => {
      const found = element.querySelector<HTMLButtonElement>('[data-member="governance"] button');
      if (!found) throw new Error("The entry is not drawn yet");
      return found;
    });
    button.click();
    await vi.waitFor(() => expect(expanded).toEqual([governance]));
    expect(element.querySelector('[data-member="governance"] [role=alert]')).toBeNull();
    expect(sent.some(request => request.method !== "GET")).toBe(false);
  } finally {
    app.unmount();
    stopServing();
  }
});
