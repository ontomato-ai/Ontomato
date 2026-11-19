import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  draftScenario,
  hostMessageOf,
  inside,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  panelHostFrame,
  READER,
  task,
  writeFrameDocument,
} from "./panel-frame";

/*
 * A draft an agent wrote for a panel application's page, opened at that page's own address (design 10.3, the draft
 * check): the platform's page hands the draft's link to the panel, the panel reads it as the reader, and the form shows
 * it — its values, the field it changed marked, nothing saved. Everything is the real thing but the browser: the page and
 * the panel host are the platform's, the frame's document is the one the host wrote, and the frame's side is the SDK's.
 *
 * The mistakes this rules out: the page dropping the draft's link from the address it gives the panel, and the panel
 * reading the draft before the form that takes it exists.
 */

afterEach(leaveFrame);

describe("a draft at a panel application's own address", () => {
  it("opens a marked draft and saves it only through the form, using the opened revision", { timeout: 20000 }, async () => {
    const scenario = draftScenario();
    scenario.panel.content.html = '<div id="app" v-cloak><projection slot="form"></projection></div>';
    const taskPath = `/api/data-query/platform/scheduled-tasks/${task.id}`;
    let currentRevision = task.revision;
    const sent = installPlatform(request => {
      if (request.path === taskPath && request.method === "GET") return Response.json({ ...task, revision: currentRevision });
      if (request.path === taskPath && request.method === "PUT")
        return Response.json({ ...task, revision: task.revision + 1, content: (request.body as { content: object }).content });
      return scenario.answer(request);
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId), panelPath: String(route.params.panelPath ?? "") }),
        },
      ],
    });
    await router.push(scenario.address);
    await router.isReady();
    const { app: page, element: host } = mountPlatformPage(() => h(RouterView), router);

    // The platform's page draws the panel's frame, registered, with the document the panel host wrote for it.
    const element = await panelHostFrame();
    const message = hostMessageOf(element.getAttribute("srcdoc")!);
    expect(new URL(message.url, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");

    writeFrameDocument(message);
    inside(element.contentWindow!);
    const { context } = await mountPanel({ setup: () => ({}) });

    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain("caseSetId"), {
      timeout: 5000,
    });
    expect(document.querySelector('[data-field="/caseSetId"]')?.textContent).toContain("Smoke (8)");
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    expect(sent.filter((request) => request.method === "POST" && request.path === "/api/product-assets/subscriptions"))
      .toMatchObject([{ body: { kind: "product-definition", target: { kind: "panel", id: scenario.panel.id } } }]);
    const form = document.querySelector<HTMLFormElement>(".sdk-owner-form form")!;
    // The frame is sandboxed without allow-forms, so the save is the button's own click, not a form submission.
    const save = [...form.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!;
    expect(save.type).toBe("button");
    expect(save.disabled).toBe(false);
    currentRevision++;
    save.click();
    await vi.waitFor(() => {
      expect(sent.filter(request => request.method === "PUT")).toMatchObject([{
        path: taskPath, credential: READER,
        body: { revision: task.revision, content: { ...task.content, caseSetId: "set-smoke" } },
      }]);
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
    });
    page.unmount();
  });
});
