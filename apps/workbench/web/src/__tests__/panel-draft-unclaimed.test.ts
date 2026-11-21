import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { servePageComposer } from "../../../../../packages/platform-web/src/app-host";
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
    expect(host.querySelector(".panel-host-draft")).toBeNull();

    // The slot registers, and it performs another operation: the reason is said above the panel, which stays.
    release();
    await vi.waitFor(
      () => expect(host.querySelector(".panel-host-draft .el-alert__title")?.textContent).toBe("This page has no form that takes this draft for platform:ScheduledTask (platform:Dashboard.save)"),
      { timeout: 5000 },
    );
    expect(host.querySelector(".panel-host-error")).toBeNull();
    expect(host.querySelector("[data-member]")).not.toBeNull();
    // Nothing was written.
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    page.unmount();
  });
});

describe("closing the notice of a draft the page cannot use", () => {
  async function opened() {
    const scenario = draftScenario("platform:Dashboard.save");
    const sent = installPlatform(scenario.answer);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/applications/:applicationId/:panelPath(.*)", component: PanelApplicationRoute, props: (route) => ({ applicationId: String(route.params.applicationId) }) }],
    });
    await router.push(scenario.address);
    await router.isReady();
    const mounted = mountPlatformPage(() => h(RouterView), router);
    await vi.waitFor(() => expect(mounted.element.querySelector(".panel-host-draft")).not.toBeNull(), { timeout: 10000 });
    return { router, sent, ...mounted };
  }
  const sentence = "This page has no form that takes this draft for platform:ScheduledTask (platform:Dashboard.save)";

  it("opens the page as it is without the draft: its entry's own address, no draft read again", { timeout: 20000 }, async () => {
    const { router, sent, app, element } = await opened();
    try {
      // A real button the keyboard reaches: named in the reader's words, in the tab order after the notice's other button,
      // and activated as a button is (Enter and Space are the browser's own for a <button>).
      const notice = element.querySelector<HTMLElement>(".panel-host-draft")!;
      const tabbable = [...notice.querySelectorAll<HTMLElement>("button, [href], [tabindex]")].filter((node) => node.tabIndex >= 0);
      const close = tabbable.at(-1) as HTMLButtonElement;
      expect(close.classList.contains("panel-host-draft-close")).toBe(true);
      expect(close.type).toBe("button");
      expect(close.getAttribute("aria-label")).toBe("Close this notice");
      close.focus();
      expect(document.activeElement).toBe(close);
      close.click();
      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/applications/app-panels-trial-a/form"));
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      expect(element.querySelector(".panel-host-error")).toBeNull();
      const reads = sent.filter((request) => request.path.endsWith("/page-draft")).length;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent.filter((request) => request.path.endsWith("/page-draft")).length).toBe(reads);
    } finally {
      app.unmount();
    }
  });

  it("hands the sentence back to the page's composer, unsent, and leaves the draft", { timeout: 20000 }, async () => {
    const expand = vi.fn();
    const withdraw = servePageComposer(expand);
    const { router, sent, app, element } = await opened();
    try {
      const button = [...element.querySelectorAll(".panel-host-draft button")].find((node) => node.textContent?.trim() === "Hand back to the agent") as HTMLElement;
      button.click();
      expect(expand).toHaveBeenCalledWith({ target: { kind: "page-default" }, prefill: `The draft couldn't be used: ${sentence}` });
      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/applications/app-panels-trial-a/form"));
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      // The composer only opens with the sentence: nothing goes to a conversation.
      expect(sent.filter((request) => request.path.startsWith("/api/assistant/sessions") && request.method === "POST")).toEqual([]);
    } finally {
      withdraw();
      app.unmount();
    }
  });
});
