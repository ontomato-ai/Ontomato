import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import type { ProductPanel } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, type Sent } from "./panel-frame";

/*
 * A panel placed inside another where the outer one's state puts it (standard: a panel in a panel is its own instance;
 * big main's rulings, 2026-11-21), as the platform's host mounts it: its definition read from Node along the outer
 * panel's member path, its module run in an element of its own, its CSS reaching only it; another choice lets it go,
 * CSS and all; a placement the reader may not use says so in that place alone.
 *
 * Real route, panel host, module loader, SDK instance and components; the network is a stand-in.
 *
 * What this rules out: a placed panel read without the selection that placed it, which Node cannot admit; one whose CSS
 * leaks into the panel around it or stays after it is let go; a refusal that takes the whole page down.
 */

const application = "app-catalog";
const PLACE_DETAIL = `import { mountPanel } from "@ontomato/sdk/panel";
await mountPanel({});
`;
const outer = panelRecord("panel-catalog", "Panel catalog", definePanel({
  state: { detailPanel: { type: { kind: "object", objectType: PRODUCT_PANEL }, personal: false, deepLink: true, external: false } },
  members: { detail: { target: { fromState: "detailPanel", candidates: { rule: "usable" } } } },
  events: {},
}));
outer.content = { html: '<div id="app" class="catalog"><projection slot="detail"></projection></div>', module: PLACE_DETAIL };
const use = panelUse("use-catalog", "catalog", outer.id, `/applications/${application}/panels`);

/** A panel the catalog may preview: its own words, and CSS that would paint anything it reached. */
function previewed(id: string, words: string): Pick<ProductPanel, "id" | "revision" | "content" | "manifest"> {
  return {
    id, revision: 1, manifest: definePanel({ state: {}, members: {}, events: {} }),
    content: { html: `<style>p { outline: 3px solid red; }</style><div id="app"><p class="previewed">${words}</p></div>`, module: PLACE_DETAIL },
  };
}
const previews: Record<string, Pick<ProductPanel, "id" | "revision" | "content" | "manifest">> = {
  "panel-a": previewed("panel-a", "Panel A"), "panel-b": previewed("panel-b", "Panel B"),
};
const chosen = (primaryKey: string) => ({ detailPanel: { className: PRODUCT_PANEL, primaryKey } });

type NestedRead = { source: unknown; memberPath: { member: string; selection?: { target: { panelId: string } } }[] };
function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [use] } });
  if (request.path === `/api/product-panels/${outer.id}`) return panelAnswer(outer, request);
  if (request.path === `/api/product-panels/${outer.id}/snapshot`) return panelSnapshot(outer, {}, request);
  if (request.path === "/api/product-panels/nested") {
    const { memberPath } = request.body as NestedRead;
    const panelId = memberPath.at(-1)!.selection!.target.panelId;
    const panel = previews[panelId];
    return panel ? Response.json({ panel }) : Response.json({ error: { message: "You may not use this panel" } }, { status: 403 });
  }
  return nothingAt(request);
}

const nestedReads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/nested").map(request => request.body as NestedRead);
const placedSheets = () => document.adoptedStyleSheets.map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join("\n"));

afterEach(leaveFrame);

it("mounts the panel the outer panel's state chooses, in its place, and lets it go for another choice", async () => {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute, props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(panelAddress(use.path, chosen("panel-a")));
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    const placed = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[data-member="detail"] [data-panel-instance]');
      if (!found?.querySelector(".previewed")) throw new Error("The chosen panel is not placed yet");
      return found;
    });
    expect(placed.querySelector(".previewed")!.textContent).toBe("Panel A");
    // Its own instance, inside the outer one's: its CSS is scoped to it alone.
    const outerInstance = element.querySelector<HTMLElement>(".panel-host-direct")!.dataset.panelInstance;
    const innerInstance = placed.dataset.panelInstance!;
    expect(innerInstance).not.toBe(outerInstance);
    expect(placedSheets().some(css => css.includes(`[data-panel-instance="${innerInstance}"]`) && css.includes("outline"))).toBe(true);
    // Node was asked along the outer panel's source and the member path, the selection that placed it included.
    expect(nestedReads(sent)).toEqual([{
      source: { kind: "registered", applicationId: application, useId: use.id },
      memberPath: [{ member: "detail", selection: { stateValue: chosen("panel-a").detailPanel, target: { panelId: "panel-a" } } }],
    }]);

    // Another choice: the first panel goes, its CSS with it, and the new one takes its place.
    await router.push(panelAddress(use.path, chosen("panel-b")));
    await vi.waitFor(() => expect(element.querySelector('[data-member="detail"] .previewed')?.textContent).toBe("Panel B"));
    expect(element.querySelectorAll('[data-member="detail"] .previewed')).toHaveLength(1);
    expect(placedSheets().some(css => css.includes(`[data-panel-instance="${innerInstance}"]`))).toBe(false);

    // A panel the reader may not use: that place says so, and the page around it stays.
    await router.push(panelAddress(use.path, chosen("panel-secret")));
    await vi.waitFor(() => expect(element.querySelector('[data-member="detail"]')?.textContent).toContain("You do not have access to this"));
    expect(element.querySelector(".panel-host-error")).toBeNull();
    expect(element.querySelector('[data-member="detail"] .previewed')).toBeNull();
  } finally {
    app.unmount();
  }
});
