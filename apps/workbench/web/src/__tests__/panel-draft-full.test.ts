import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import { draftScenario, hostMessageOf, inside, installPlatform, leaveFrame, panelOf, writeFrameDocument } from "./panel-frame";

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
  it("opens in the panel's form: its values, the field it changed, and nothing saved", { timeout: 20000 }, async () => {
    const scenario = draftScenario();
    const sent = installPlatform(scenario.answer);
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
    const page = createApp({ render: () => h(RouterView) }).use(router).use(ElementPlus);
    const host = document.createElement("div");
    document.body.append(host);
    page.mount(host);

    // The platform's page draws the panel's frame, registered, with the document the panel host wrote for it.
    const element = await vi.waitFor(
      () => {
        const found = document.querySelector<HTMLIFrameElement>("iframe.panel-host-frame");
        expect(found?.getAttribute("srcdoc")).toBeTruthy();
        return found!;
      },
      { timeout: 5000 },
    );
    const message = hostMessageOf(element.getAttribute("srcdoc")!);
    expect(new URL(message.url, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");

    writeFrameDocument(message);
    inside(element.contentWindow!);
    await mountPanel(panelOf("form"));

    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent).toContain("caseSetId"), {
      timeout: 5000,
    });
    expect(document.querySelector('[data-field="caseSetId"]')?.textContent).toContain("Smoke (8)");
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    page.unmount();
  });
});
