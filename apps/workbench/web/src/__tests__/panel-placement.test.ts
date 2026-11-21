import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, type Sent } from "./panel-frame";

/*
 * Where the platform shows a panel (big main's ruling, 2026-11-21): the same panel at its application's own address is
 * told it is at a page of its own, and beside a conversation it is told so — the conversation draws the page's title and
 * its way back, so the panel leaves its own out. The platform says it; the panel's address does not.
 *
 * Real route, beside-the-conversation resolver, panel host, module loader and SDK; the network is a stand-in.
 *
 * What this rules out: a panel that cannot tell the two apart and draws its own title and back beside a conversation, or
 * has to make up an address parameter to know.
 */

const application = "app-placement";
const TITLED = `import { h } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { placement } = usePanelContext();
    return () => h("div", [
      placement.value === "page" ? h("h2", { class: "own-title" }, "Governance report") : null,
      h("output", placement.value),
    ]);
  },
});
`;
const panel = panelRecord("panel-placement", "Placement", definePanel({ state: {}, members: {}, events: {} }));
panel.content.module = TITLED;
const use = panelUse("use-placement", "placement", panel.id, `/applications/${application}/report`);

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  return nothingAt(request);
}

/** What the panel was told and whether it drew its own title, once it has run. */
async function shown(element: HTMLElement) {
  const output = await vi.waitFor(() => {
    const found = element.querySelector(".panel-host-coded output");
    if (!found) throw new Error("The panel is not drawn yet");
    return found;
  });
  return { placement: output.textContent, ownTitle: element.querySelector(".panel-host-coded .own-title") !== null };
}

afterEach(leaveFrame);

it("tells the same panel it is at its own page, or beside a conversation", async () => {
  installPlatform(answer);
  const own = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute, props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await own.push(use.path);
  const full = mountPlatformPage(() => h(RouterView), own);

  const chat = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
  await chat.push({ path: platformRoutes.chat.path, query: { page: use.path } });
  const resolved = pilotPageResolver(vi.fn())(use.path)!;
  const beside = mountPlatformPage(() => h(resolved.component, resolved.props), chat);
  try {
    expect(await shown(full.element)).toEqual({ placement: "page", ownTitle: true });
    expect(await shown(beside.element)).toEqual({ placement: "conversation", ownTitle: false });
  } finally {
    beside.app.unmount();
    full.app.unmount();
  }
});
