import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import {
  currentSdk, installPlatform, leaveFrame, manifestQ, mountPlatformPage, nothingAt, panelRecord, panelSnapshot, panelUse, type Sent,
} from "./panel-frame";

/*
 * Opening a panel application's page (first open, design 7.2): the host reads what does not depend on one another side
 * by side, through the platform's own route, catalog and panel host. The shell's catalog already lists the reader's use
 * relations, so the page's panel record and the SDK root are read while Java's answer for the application is; the frame
 * is drawn only once that answer names the page, and that one answer serves both the route and the page's check. The
 * record read is the current definition, so the opening reads no snapshot of it.
 *
 * What this rules out: the panel read waiting for the relations it does not depend on; a frame drawn before Java has
 * named its page; a second relations read for the same opening; and a page opened from a catalog that has gone stale.
 */

const app = "app-first-open";
const panel = panelRecord("panel-first-open", "Summary", manifestQ);
const use = panelUse("use-summary", "first-open-summary", panel.id, `/applications/${app}/summary`);
const usesPath = `/api/data-query/platform/applications/${app}/panel-uses`;

function catalogEntry(panelUses?: ApplicationPanelUse[]) {
  return {
    id: app, kind: "product", names: { en: app }, descriptions: {}, icon: "schedules", rail: "apps", category: "business", sort: 0,
    entry: { path: `/applications/${app}`, renderer: "panels" }, entryAccess: ["domain-member"], scheduleAdapter: null, releaseId: null,
    ...(panelUses ? { panelUses } : {}),
  };
}

async function openPage(options: { catalog: ApplicationPanelUse[] | undefined; answer: ApplicationPanelUse[]; held: Promise<void> }) {
  const sent = installPlatform((request: Sent) => {
    if (request.path === "/api/data-query/platform/applications")
      return Response.json({ success: true, data: [catalogEntry(options.catalog)] });
    if (request.path === usesPath)
      return options.held.then(() => Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: options.answer } }));
    if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel);
    if (request.path === "/api/apps-sdk/current") return currentSdk();
    return nothingAt(request);
  });
  await useApplicationCatalog().refresh();
  sent.length = 0;
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(use.path);
  const page = mountPlatformPage(() => h(RouterView), router);
  return { ...page, sent };
}

const drawn = (element: HTMLElement) => element.querySelector<HTMLIFrameElement>("iframe.panel-host-frame")?.getAttribute("srcdoc") ?? null;
const order = (sent: Sent[]) => sent.map(request => request.path);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("reads the page's panel and the SDK root beside Java's relations, and draws the frame once they name the page", async () => {
  let answer!: () => void;
  const held = new Promise<void>(resolve => (answer = resolve));
  const { app: page, element, sent } = await openPage({ catalog: [use], answer: [use], held });
  try {
    await vi.waitFor(() => expect(order(sent)).toEqual(expect.arrayContaining([usesPath, `/api/product-panels/${panel.id}`, "/api/apps-sdk/current"])));
    // Everything the frame needs is in hand but Java's answer: nothing is drawn yet.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(drawn(element)).toBeNull();
    answer();
    await vi.waitFor(() => expect(drawn(element)).not.toBeNull());
    // One relations read for the route and the page's check; no snapshot besides the record.
    expect(order(sent).filter(path => path === usesPath)).toHaveLength(1);
    expect(order(sent)).not.toContain(`/api/product-panels/${panel.id}/snapshot`);
  } finally {
    page.unmount();
  }
});

it("opens from Java's relations when the catalog does not list the page, with one relations read", async () => {
  const { app: page, element, sent } = await openPage({ catalog: undefined, answer: [use], held: Promise.resolve() });
  try {
    await vi.waitFor(() => expect(drawn(element)).not.toBeNull());
    expect(order(sent).indexOf(usesPath)).toBeLessThan(order(sent).indexOf(`/api/product-panels/${panel.id}`));
    expect(order(sent).filter(path => path === usesPath)).toHaveLength(1);
  } finally {
    page.unmount();
  }
});

it("draws nothing for a page the catalog lists but Java no longer names, and says so", async () => {
  const { app: page, element } = await openPage({ catalog: [use], answer: [], held: Promise.resolve() });
  try {
    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe(`${use.path} is not a panel of this application`));
    expect(drawn(element)).toBeNull();
  } finally {
    page.unmount();
  }
});
