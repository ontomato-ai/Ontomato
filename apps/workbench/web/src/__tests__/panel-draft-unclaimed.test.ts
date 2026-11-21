import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { draftScenario, installPlatform, leaveFrame, mountPlatformPage } from "./panel-frame";

/*
 * A draft no form of the panel performs (the address of one panel, the draft written for another form): once every slot
 * the panel declares has registered, none will take it, and the reader is told so above the panel, in their language — at
 * once, not after a wait — while the panel goes on as it is (panelisation lead, 2026-11-22: a draft the page cannot use is
 * the draft's problem, never the panel's). The form's projection is held back until the test lets it through, so the draft
 * is held first: it is not refused while a slot that might take it is still to register. The panel runs in the
 * platform's document.
 */

afterEach(leaveFrame);

describe("a draft no form of the panel performs", () => {
  it("is reported above the panel, which goes on, once every slot has registered", { timeout: 20000 }, async () => {
    const scenario = draftScenario("platform:Dashboard.save");
    let release!: () => void;
    const projectionHeld = new Promise<void>((resolve) => (release = resolve));
    const sent = installPlatform((request) =>
      request.path === "/api/product-projections/projection-schedules-form"
        ? projectionHeld.then(() => scenario.answer(request))
        : scenario.answer(request),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId) }),
        },
      ],
    });
    await router.push(scenario.address);
    await router.isReady();
    const { app: page, element: host } = mountPlatformPage(() => h(RouterView), router);

    // The draft is held, and the form's slot has not registered: nothing is refused yet.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.querySelector(".panel-host-notice")).toBeNull();

    // The slot registers, and it performs another operation: the reason is said above the panel, which stays.
    release();
    await vi.waitFor(
      () => expect(host.querySelector(".panel-host-notice")?.textContent).toBe("This page has no form that takes this draft for platform:ScheduledTask (platform:Dashboard.save)"),
      { timeout: 5000 },
    );
    expect(host.querySelector(".panel-host-error")).toBeNull();
    expect(host.querySelector("[data-member]")).not.toBeNull();
    // Nothing was written.
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    page.unmount();
  });
});
