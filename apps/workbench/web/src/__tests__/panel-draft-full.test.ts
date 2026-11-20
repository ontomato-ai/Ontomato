import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  draftScenario, formSaveCalls, humanIntents, installPlatform, leaveFrame, mountPlatformPage, READER, SCHEDULED_TASK, task,
  caseSetLabel,
} from "./panel-frame";

/*
 * A draft an agent wrote for a panel application's page, opened at that page's own address (design 10.3, the draft
 * check): the platform's page hands the draft's link to the panel, the panel reads it as the reader, and the form shows
 * it — its values, the field it changed marked, nothing saved. Everything is the real thing but the network: the page,
 * the panel host and the panel's module running in the platform's document on its SDK.
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
    const intents = humanIntents(() => ({
      kind: "success", data: {},
      affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: task.id }], objectTypes: [SCHEDULED_TASK] },
    }));
    const sent = installPlatform(request => {
      if (request.path === taskPath && request.method === "GET") return Response.json({ ...task, revision: currentRevision });
      return intents(request) ?? scenario.answer(request);
    });
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
    const { app: page } = mountPlatformPage(() => h(RouterView), router);

    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain(caseSetLabel), {
      timeout: 5000,
    });
    expect(document.querySelector('[data-field="/caseSetId"]')?.textContent).toContain("Smoke (8)");
    expect(formSaveCalls(sent)).toEqual([]);
    expect(sent.filter(request => request.path.startsWith("/api/product-assets/"))).toEqual([]);
    const form = document.querySelector<HTMLFormElement>(".sdk-owner-form form")!;
    // The save is the button's own click, not a form submission.
    const save = [...form.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!;
    expect(save.type).toBe("button");
    expect(save.disabled).toBe(false);
    currentRevision++;
    save.click();
    await vi.waitFor(() => {
      expect(formSaveCalls(sent)).toEqual([{
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.id },
        input: {
          revision: task.revision,
          values: { ...task.content, caseSetId: "set-smoke" },
          // The field the draft changed among the fields the owner's form describes.
          submittedFields: ["/caseSetId"],
        },
      }]);
      expect(sent.find(request => request.path === "/api/panel-operations/intents")?.credential).toBe(READER);
      // Saved: the draft is settled and the form holds nothing unsaved.
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
    });
    // The panel read the draft its address links, as the reader.
    expect(sent.find(request => request.path.endsWith("/page-draft"))?.credential).toBe(READER);
    page.unmount();
  });
});
