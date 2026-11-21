import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { createRouter, createWebHashHistory, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import { providePageHeading, type PlatformPageHeading } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, type Sent } from "./panel-frame";

/*
 * A panel application's page at its own address is titled and, when its menu does not reach it, given its way back by the
 * platform (big main's ruling, 2026-11-21): the panel draws neither. The title is what a message names the page by — the
 * entry's menu name, else its panel's own name in the reader's language; the way back returns to the page the reader came from, or to the
 * application's root when the page was opened directly.
 *
 * Real route, panel host and SDK, under a frame that reads the heading the way the platform's layout does; the network is
 * a stand-in.
 *
 * What this rules out: a panel page with no title or way back unless the panel draws its own, a menu entry given a way
 * back it does not need, and a way back that leaves an opened-directly page with nowhere to go.
 */

const application = "app-heading";
const panel = panelRecord("panel-report", "governance-report", definePanel({ state: {}, members: {}, events: {} }));
// The panel's own name in the reader's language, which stands where its registered name would.
panel.content.messages = { en: { "panel.name": "Governance report" }, "zh-CN": { "panel.name": "治理报告" } };
const listed = { ...panelUse("use-knowledge", "knowledge", panel.id, `/applications/${application}/knowledge`), names: { en: "Business knowledge" } };
const unlisted = panelUse("use-report", "report", panel.id, `/applications/${application}/report`);

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: applicationRootPath(application), renderer: "panels" }, panelUses: [listed, unlisted] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  return nothingAt(request);
}

/** The platform's frame, as far as the heading goes: it provides where the shown page writes it. */
let heading: Readonly<Ref<PlatformPageHeading | null>>;
const Frame = defineComponent(() => {
  heading = providePageHeading();
  return () => h(RouterView);
});

async function open(...addresses: string[]) {
  installPlatform(answer);
  // The platform's own history: it records the page the reader came from, which a way back returns to.
  window.history.replaceState(null, "", "/");
  const router = createRouter({ history: createWebHashHistory(), routes: [
    { path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute, props: route => ({ applicationId: String(route.params.applicationId) }) },
    { path: "/elsewhere", component: { render: () => h("p", "Elsewhere") } },
  ] });
  for (const address of addresses) await router.push(address);
  const { app } = mountPlatformPage(() => h(Frame), router);
  return { app, router };
}

/** The heading once the shown page has named itself. */
const named = () => vi.waitFor(() => {
  if (!heading.value) throw new Error("The page has not named itself yet");
  return heading.value;
});

afterEach(leaveFrame);

it("titles a menu entry by its menu name, with no way back", async () => {
  const { app } = await open(listed.path);
  try {
    expect(await named()).toEqual({ title: "Business knowledge" });
  } finally {
    app.unmount();
  }
});

it("titles an entry its menu does not reach by its panel's name, and leads back where the reader came from", async () => {
  const { app, router } = await open("/elsewhere", unlisted.path);
  try {
    const shown = await vi.waitFor(async () => {
      const current = await named();
      if (current.title !== "Governance report") throw new Error("The panel has not reported its name yet: " + current.title);
      return current;
    });
    expect(shown.back).toBeTypeOf("function");
    shown.back!();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/elsewhere"));
  } finally {
    app.unmount();
  }
});

it("leads an entry opened directly back to its application's first entry", async () => {
  const { app, router } = await open(unlisted.path);
  try {
    const shown = await vi.waitFor(async () => {
      const current = await named();
      if (!current.back) throw new Error("No way back yet");
      return current;
    });
    shown.back!();
    // The application's root opens its first entry the reader may see.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(listed.path));
  } finally {
    app.unmount();
  }
});
