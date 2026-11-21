import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { draftScenario, installPlatform, leaveFrame, mountPlatformPage } from "./panel-frame";

/*
 * A draft the platform cannot read (an old shape, 128 on 2026-11-22) at a panel application's address (panelisation
 * lead): the panel opens as it is with one dismissible line above it in the reader's words, naming the file and the
 * field; dismissed, the page is as it is without a draft; and moving away and back — with or without dismissing — finds
 * the panel as it is, never a failure left over from the draft.
 */

afterEach(leaveFrame);

const draftPath = "outputs/drafts/task.page-draft.json";

function unreadableDraftPage() {
  const scenario = draftScenario();
  installPlatform((request) => {
    if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") {
      // Let the scenario's form through, as it does once its draft is read; the draft itself is refused.
      void scenario.answer(request);
      return Response.json({
        success: false, error: `Page draft '${draftPath}' in run 'run-1': target.objectType: Required`, code: "INVALID_REQUEST",
        details: { runId: "run-1", path: draftPath, issues: [{ path: ["target", "objectType"], message: "Required" }] },
      }, { status: 400 });
    }
    return scenario.answer(request);
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/applications/:applicationId/:panelPath(.*)", component: PanelApplicationRoute, props: (route) => ({ applicationId: String(route.params.applicationId) }) },
      { path: "/elsewhere", component: { render: () => h("p", { class: "elsewhere" }, "Elsewhere") } },
    ],
  });
  return { scenario, router };
}

const sentence = `The draft ${draftPath} cannot be used: it lacks or gets wrong the type of the object it is for (target.objectType). The page opens without it.`;

describe("a draft the platform cannot read", () => {
  it("leaves the panel as it is, says why above it, and once dismissed the page is as it is without a draft", { timeout: 20000 }, async () => {
    const { scenario, router } = unreadableDraftPage();
    await router.push(scenario.address);
    await router.isReady();
    const { app: page, element: host } = mountPlatformPage(() => h(RouterView), router);

    await vi.waitFor(() => expect(host.querySelector(".panel-host-draft .el-alert__title")?.textContent).toBe(sentence), { timeout: 8000 });
    expect(host.querySelector(".panel-host-error")).toBeNull();
    await vi.waitFor(() => expect(host.querySelector('[data-member="form"]')).not.toBeNull(), { timeout: 8000 });

    host.querySelector<HTMLElement>(".panel-host-draft .el-alert__close-btn")!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.query).not.toHaveProperty("draftPath"));
    await vi.waitFor(() => expect(host.querySelector(".panel-host-draft")).toBeNull());
    expect(host.querySelector(".panel-host-error")).toBeNull();
    expect(host.querySelector('[data-member="form"]')).not.toBeNull();

    // Away and back: the panel as it is.
    await router.push("/elsewhere");
    await router.push(scenario.address.split("?")[0]!);
    await vi.waitFor(() => expect(host.querySelector('[data-member="form"]')).not.toBeNull(), { timeout: 8000 });
    expect(host.querySelector(".panel-host-draft")).toBeNull();
    expect(host.querySelector(".panel-host-error")).toBeNull();
    page.unmount();
  });

  it("finds the panel as it is when the reader moves on to the page's own address without dismissing", { timeout: 20000 }, async () => {
    const { scenario, router } = unreadableDraftPage();
    await router.push(scenario.address);
    await router.isReady();
    const { app: page, element: host } = mountPlatformPage(() => h(RouterView), router);
    await vi.waitFor(() => expect(host.querySelector(".panel-host-draft")).not.toBeNull(), { timeout: 8000 });

    await router.push(scenario.address.split("?")[0]!);
    await vi.waitFor(() => expect(host.querySelector(".panel-host-draft")).toBeNull(), { timeout: 8000 });
    expect(host.querySelector(".panel-host-error")).toBeNull();
    expect(host.querySelector('[data-member="form"]')).not.toBeNull();
    page.unmount();
  });
});
