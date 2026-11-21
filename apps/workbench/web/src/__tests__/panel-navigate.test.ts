import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, type Sent } from "./panel-frame";

/*
 * A panel's own code opening an address (big main's ruling, 2026-11-21): at the panel's own address the platform's
 * router opens a page it has; an address the platform has no page for moves nothing, and the reader is told which
 * address could not be opened and why — the panel's code gets the same reason.
 *
 * Real route, panel host, module loader and SDK; the network is a stand-in, the router is the platform's own kind with
 * its catch-all.
 *
 * What this rules out: a panel's navigation that does nothing at all, and one that lands the reader on the start page
 * for an address that does not exist, saying nothing.
 */

const application = "app-navigate";
const NAVIGATE = `import { h, ref } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { navigate } = usePanelContext();
    const refused = ref("");
    const go = (address) => navigate(address).catch((reason) => { refused.value = reason.message; });
    return () => h("div", [
      h("button", { class: "go-nowhere", onClick: () => go("/nowhere/at-all") }),
      h("button", { class: "go-home", onClick: () => go("/home") }),
      h("output", refused.value),
    ]);
  },
});
`;
const panel = panelRecord("panel-navigate", "Navigate", definePanel({ state: {}, members: {}, commands: {} }));
panel.content.module = NAVIGATE;
const use = panelUse("use-navigate", "navigate", panel.id, `/applications/${application}/navigate`);

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  return nothingAt(request);
}

afterEach(leaveFrame);

it("opens a page the platform has, and says which address it cannot open without moving", async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute, props: route => ({ applicationId: String(route.params.applicationId) }) },
    { path: "/home", component: { render: () => h("p", { class: "home" }, "Home") } },
    // The platform's catch-all: an unknown address lands where the root does.
    { ...platformRoutes.unknown, redirect: "/home" },
  ] });
  installPlatform(answer, router);
  await router.push(use.path);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    const nowhere = await vi.waitFor(() => {
      const found = element.querySelector<HTMLButtonElement>(".panel-host-coded .go-nowhere");
      if (!found) throw new Error("The panel is not drawn yet");
      return found;
    });
    nowhere.click();
    const said = await vi.waitFor(() => {
      const message = document.querySelector(".el-message")?.textContent ?? "";
      if (!message) throw new Error("Nothing is said yet");
      return message;
    });
    expect(said).toContain("/nowhere/at-all");
    // The panel's code is refused with the reason the reader was told, and the reader stays on the panel's page.
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded output")?.textContent).toBe(said));
    expect(router.currentRoute.value.path).toBe(use.path);

    element.querySelector<HTMLButtonElement>(".panel-host-coded .go-home")!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/home"));
  } finally {
    app.unmount();
  }
});
