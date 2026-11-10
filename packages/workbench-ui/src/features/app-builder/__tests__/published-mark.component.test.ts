import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { HostedRelease } from "@ontomato/contracts/workspaces";
import { workbenchI18n } from "../../../i18n";
import PanelHeader from "../components/PanelHeader.vue";
import { usePublication } from "../publication";

/*
 * The page's header says the workspace's application is published only while it is: while the catalog, the one the rail
 * draws, lists the application the workspace's exports belong to. Exports alone (a publication Java refused) are not a
 * publication, and neither is a catalog that could not be read. While the catalog is read again, what it last listed
 * stands, so the mark does not blink. The mark opens the publication drawer, and its tooltip goes with the click instead
 * of floating over the drawer.
 */

const APP_ID = "app-0f8e2b1c";
const RELEASE: HostedRelease = { appId: APP_ID, releaseId: "release-2", commit: "2".repeat(40), createdAt: "2026-11-10T08:05:00.000Z" };
const APPLICATION: CatalogApplication = {
  id: APP_ID, kind: "hosted", names: { en: "Overdue board" }, descriptions: {}, icon: "pages", rail: "apps", sort: 100,
  entry: { path: `/apps/${APP_ID}/` }, entryAccess: [`app:${APP_ID}:entry`], scheduleAdapter: null, releaseId: "release-2",
};

let releases: HostedRelease[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ items: releases }), { status: 200, headers: { "Content-Type": "application/json" } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The builder's publication of workspace w1, with the catalog as given, once its exports are read. */
async function publicationOf(exports: HostedRelease[], catalog: { applications: CatalogApplication[]; error?: string; loading?: boolean }) {
  releases = exports;
  const scope = effectScope();
  const publication = scope.run(() => usePublication(() => "w1", {
    applications: shallowRef(catalog.applications),
    error: shallowRef(catalog.error ?? null),
    loading: shallowRef(catalog.loading ?? false),
    refresh: async () => {},
  }))!;
  await flushPromises();
  return publication;
}

describe("the published mark", () => {
  it("counts the application as published only while the catalog lists it", async () => {
    expect((await publicationOf([RELEASE], { applications: [APPLICATION] })).application?.id).toBe(APP_ID);
    expect((await publicationOf([RELEASE], { applications: [APPLICATION], loading: true })).application?.id).toBe(APP_ID);

    expect((await publicationOf([], { applications: [APPLICATION] })).application).toBeNull();
    expect((await publicationOf([RELEASE], { applications: [] })).application).toBeNull();
    expect((await publicationOf([RELEASE], { applications: [APPLICATION], error: "Catalog unavailable" })).application).toBeNull();
  });

  it("shows in the header only for a published application, and opens the publication drawer", async () => {
    const header = mount(PanelHeader, {
      props: { tab: "preview", headCommit: null, published: null },
      global: { plugins: [ElementPlus, workbenchI18n()] },
    });
    expect(header.find(".published").exists()).toBe(false);

    await header.setProps({ published: "Overdue board" });
    const mark = header.find(".published");
    expect(mark.attributes("aria-label")).toBe('Published as "Overdue board"');
    await mark.trigger("click");
    expect(header.emitted("publish")).toHaveLength(1);
    header.unmount();
  });

  it("closes its tooltip when it opens the publication drawer", async () => {
    vi.useFakeTimers();
    const header = mount(PanelHeader, {
      props: { tab: "preview", headCommit: null, published: "Overdue board" },
      global: { plugins: [ElementPlus, workbenchI18n()] },
      attachTo: document.body,
    });
    const tooltip = () => [...document.body.querySelectorAll<HTMLElement>(".el-popper")]
      .find((popper) => popper.textContent!.includes('Published as "Overdue board"'));
    try {
      await header.find(".published").trigger("mouseenter");
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(tooltip()!.style.display).not.toBe("none");

      await header.find(".published").trigger("click");
      vi.advanceTimersByTime(0);
      await nextTick();
      expect(tooltip()!.style.display).toBe("none");

      // A click quicker than the tooltip's delay keeps it from showing over the drawer at all.
      await header.find(".published").trigger("mouseenter");
      await header.find(".published").trigger("click");
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(tooltip()!.style.display).toBe("none");
    } finally {
      header.unmount();
      vi.useRealTimers();
    }
  });
});
