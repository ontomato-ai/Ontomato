import { afterEach, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { DirectProjection, ProductPanel } from "@ontomato/contracts/product-panels";
import type { PageCounter } from "../../../../../packages/agent-shell-ui/src/page-counter";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, mountPlatformPage, nothingAt, panelAnswer, panelSnapshot, panelUse, PLACE_EVERY_MEMBER, type Sent } from "./panel-frame";

/*
 * A conversation entry in a panel at its application's own address (big main's ruling, 2026-11-21): the page has the
 * platform's composer at its foot, and pressing the entry expands that composer with the agent and sentence the member's
 * projection declares — the agent chosen among the page's own, the sentence written in, nothing sent.
 *
 * Real route, panel host, SDK instance and component, and the platform's own composer and its registry; the network and
 * the counter's agents are stand-ins.
 *
 * What this rules out: a panel page with no composer for its entry ("This page has no composer"); an entry that opens
 * the composer without its agent or its sentence; an entry that sends.
 */

const application = "app-knowledge";
const use = panelUse("use-knowledge", "knowledge", "panel-knowledge", `/applications/${application}/knowledge`);
const regular: AgentHostAgent = { id: "agent-regular", name: "Regular assistant", description: "", icon: null, enabled: true };
const governor: AgentHostAgent = { id: "agent-knowledge-governance", name: "Knowledge governance", description: "", icon: null, enabled: true };
const governance: PanelConversationEntry = {
  target: { kind: "id", id: "agent-knowledge-governance" },
  prefill: "Check this knowledge item",
};
const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const panel: ProductPanel = {
  ...base, id: use.panelId, name: "Knowledge",
  content: { html: '<div id="app"></div>', module: PLACE_EVERY_MEMBER },
  manifest: { state: {}, members: { governance: { target: { projectionId: "knowledge-governance" } } } },
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

it("expands the page's own composer with the member's declared agent and sentence, sending nothing", async () => {
  const sent = installPlatform(answer);
  const ask = vi.fn();
  const counter: PageCounter = {
    agents: async () => [regular, governor],
    // The page's skill offers both, the regular assistant first as its default.
    pageAgents: async () => ({ agents: [regular, governor], defaultAgentId: regular.id }),
    preferredAgentId: ref(null),
    ask,
  };
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId }),
  }] });
  await router.push(use.path);
  const { app, element } = mountPlatformPage(() => h(RouterView), router, counter);
  try {
    const input = await vi.waitFor(() => {
      const found = element.querySelector<HTMLTextAreaElement>(".page-ask textarea");
      if (!found) throw new Error("The page's composer is not drawn yet");
      return found;
    });
    expect(element.querySelector(".page-ask")?.textContent).toContain(regular.name);
    const button = await vi.waitFor(() => {
      const found = element.querySelector<HTMLButtonElement>('[data-member="governance"] button');
      if (!found) throw new Error("The entry is not drawn yet");
      return found;
    });
    button.click();
    await vi.waitFor(() => expect(input.value).toBe(governance.prefill));
    expect(element.querySelector(".page-ask")?.textContent).toContain(governor.name);
    expect(element.querySelector('[data-member="governance"] [role=alert]')).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(sent.some(request => request.method !== "GET")).toBe(false);
  } finally {
    app.unmount();
  }
});
