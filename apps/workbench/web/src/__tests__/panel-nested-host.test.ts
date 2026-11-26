import { afterEach, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { PRODUCT_PANEL, TRIGGER } from "@ontomato/contracts/platform-object-types";
import type { ProductPanel } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  sentPanelReadItems,
  installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, PLACE_EVERY_MEMBER, projections, task,
  type Sent,
} from "./panel-frame";

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
}));
outer.content = {
  html: `
    <style>.overlay-sample { color: red; }</style>
    <div id="app" class="catalog">
      <sdk-drawer :model-value="true" append-to-body><span class="overlay-sample outer-drawer">Drawer</span></sdk-drawer>
      <sdk-dialog :model-value="true" append-to-body><span class="overlay-sample outer-dialog">Dialog</span></sdk-dialog>
      <sdk-popover :visible="true">
        <template #reference><button>Show popover</button></template>
        <span class="overlay-sample outer-popover">Popover</span>
      </sdk-popover>
      <projection slot="detail"></projection>
    </div>`,
  module: PLACE_DETAIL,
};
const use = panelUse("use-catalog", "catalog", outer.id, `/applications/${application}/panels`);
const secondUse = panelUse("use-catalog-second", "catalog-second", outer.id, `/applications/${application}/second`);

/** A panel the catalog may preview: its own words, and CSS that would paint anything it reached. */
function previewed(id: string, words: string): Pick<ProductPanel, "id" | "revision" | "content" | "manifest"> {
  return {
    id, revision: 1, manifest: definePanel({ state: {}, members: {} }),
    content: {
      html: `<style>p { outline: 3px solid red; }</style>
        <div id="app">
          <p class="previewed overlay-sample">${words}</p>
          <sdk-dialog :model-value="true" append-to-body>
            <p class="nested-overlay overlay-sample">${words}</p>
          </sdk-dialog>
        </div>`,
      module: PLACE_DETAIL,
    },
  };
}
const previews: Record<string, Pick<ProductPanel, "id" | "revision" | "content" | "manifest">> = {
  "panel-a": previewed("panel-a", "Panel A"), "panel-b": previewed("panel-b", "Panel B"),
};
const chosen = (primaryKey: string) => ({ detailPanel: { className: PRODUCT_PANEL, primaryKey } });

type NestedRead = { source: unknown; memberPath: { member: string; selection?: { target: { panelId: string } } }[] };
function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
    return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [use, secondUse] } });
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
const overlayRootsFor = (instance: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-panel-overlay-root][data-panel-instance="${instance}"]`)];
const overlayRootFor = (instance: string) => {
  const roots = overlayRootsFor(instance);
  return roots.find((root) => root.parentElement !== document.body) ?? roots[0]!;
};
const windowOverlayRootFor = (instance: string) =>
  overlayRootsFor(instance).find((root) => root.parentElement === document.body) ?? overlayRootFor(instance);

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

it("styles each instance's overlays and hides both page and nested overlays when another entry is shown", async () => {
  installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  const firstAddress = panelAddress(use.path, chosen("panel-a"));
  await router.push(firstAddress);
  const overlayContainer = ref<HTMLElement | null>(null);
  const { app, element } = mountPlatformPage(() => h(RouterView), router, undefined, overlayContainer);
  try {
    const nested = await vi.waitFor(() => {
      const panel = element.querySelector<HTMLElement>('[data-member="detail"] [data-panel-instance]')!;
      expect(overlayRootFor(panel.dataset.panelInstance!).querySelector(".nested-overlay")).not.toBeNull();
      return panel;
    });
    const inline = element.querySelector<HTMLElement>(".panel-host-direct")!;
    const first = overlayRootFor(inline.dataset.panelInstance!);
    const firstWindow = windowOverlayRootFor(inline.dataset.panelInstance!);
    const nestedRoot = overlayRootFor(nested.dataset.panelInstance!);
    const nestedWindow = windowOverlayRootFor(nested.dataset.panelInstance!);
    expect(first.parentElement).not.toBe(document.body);
    expect(nestedRoot.parentElement).toBe(first.parentElement);
    expect(nested.contains(nestedRoot)).toBe(false);
    for (const selector of [".outer-drawer", ".outer-dialog"]) {
      expect(getComputedStyle(first.querySelector(selector)!).color).toBe("red");
    }
    expect(getComputedStyle(firstWindow.querySelector(".outer-popover")!).color).toBe("red");
    expect(getComputedStyle(nested.querySelector(".previewed")!).color).not.toBe("red");
    expect(getComputedStyle(nestedRoot.querySelector(".nested-overlay")!).color).not.toBe("red");

    // Identical content at a second entry uses a separate mount and scopes its own overlays there.
    await router.push(secondUse.path);
    const second = await vi.waitFor(() => {
      const host = [...element.querySelectorAll<HTMLElement>(".panel-host-direct")].find(candidate => candidate !== inline)!;
      const root = overlayRootFor(host.dataset.panelInstance!);
      expect(windowOverlayRootFor(host.dataset.panelInstance!).querySelector(".outer-popover")).not.toBeNull();
      return root;
    });
    expect(second.dataset.panelInstance).not.toBe(first.dataset.panelInstance);
    expect(getComputedStyle(windowOverlayRootFor(second.dataset.panelInstance!).querySelector(".outer-popover")!).color).toBe("red");
    for (const root of [first, firstWindow, nestedRoot, nestedWindow]) {
      expect(root.hidden).toBe(true);
      expect(root.inert).toBe(true);
      expect(root.style.display).toBe("none");
    }
    expect(second.hidden).toBe(false);

    await router.push(firstAddress);
    await vi.waitFor(() => {
      expect(first.hidden).toBe(false);
      expect(nestedRoot.hidden).toBe(false);
      expect(second.hidden).toBe(true);
    });
    expect(nestedRoot.querySelector(".nested-overlay")).not.toBeNull();
  } finally {
    app.unmount();
  }
  expect(document.body.querySelector("[data-panel-overlay-root]")).toBeNull();
});

it("asks Node for an object's detail panel by the object alone, and reads inside it along the panel Node named", async () => {
  const taskRef = { className: TRIGGER, primaryKey: task.id };
  const objectOuter = panelRecord("panel-tasks-detail", "Tasks", definePanel({
    state: { picked: { type: { kind: "object", objectType: TRIGGER }, personal: false, deepLink: true, external: false } },
    members: { detail: { target: { fromState: "picked", candidates: { rule: "objectDetail" } } } },
  }));
  objectOuter.content = { html: '<div id="app"><projection slot="detail"></projection></div>', module: PLACE_DETAIL };
  const detail = {
    id: "panel-task-detail", revision: 1, content: { html: '<div id="app"></div>', module: PLACE_EVERY_MEMBER },
    manifest: definePanel({ state: {}, members: { tasks: { target: { projectionId: "projection-schedules-tasks" } } } }),
  };
  const objectUse = panelUse("use-tasks-detail", "tasks-detail", objectOuter.id, `/applications/${application}/tasks`);
  const sent = installPlatform((request) => {
    if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
      return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [objectUse] } });
    if (request.path === `/api/product-panels/${objectOuter.id}`) return panelAnswer(objectOuter, request);
    if (request.path === `/api/product-panels/${objectOuter.id}/snapshot`) return panelSnapshot(objectOuter, {}, request);
    if (request.path === "/api/product-panels/nested") return Response.json({ panel: detail });
    if (request.path === "/api/product-projections/projection-schedules-tasks") return Response.json({ projection: projections["projection-schedules-tasks"] });
    if (request.path === "/api/product-panels/read")
      return Response.json({ status: "ready", value: [{ primaryKey: task.id, label: task.title, fields: {} }] });
    return nothingAt(request);
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute, props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(panelAddress(objectUse.path, { picked: taskRef }));
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    await vi.waitFor(() => expect(element.querySelector('[data-member="detail"] [data-member="tasks"] .sdk-object-list-row')).not.toBeNull());
    // Node was asked by the object alone: which panel shows its detail is Node's to say.
    expect(nestedReads(sent)).toEqual([{
      source: { kind: "registered", applicationId: application, useId: objectUse.id },
      memberPath: [{ member: "detail", selection: { stateValue: taskRef } }],
    }]);
    // Inside it, every read names the panel Node answered with, as the admission of a placed panel requires.
    const inner = sentPanelReadItems(sent).map(request => (request.body as { memberPath: unknown }).memberPath);
    expect(inner).toContainEqual([
      { member: "detail", selection: { stateValue: taskRef, target: { panelId: "panel-task-detail" } } },
      { member: "tasks" },
    ]);
  } finally {
    app.unmount();
  }
});
