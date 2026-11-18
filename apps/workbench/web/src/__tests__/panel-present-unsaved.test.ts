import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import { SESSION, noticeStreamDouble } from "../../../../../packages/workbench-ui/src/features/workbench/__tests__/host-double";
import { draftScenario, hostMessageOf, inside, installPlatform, leaveFrame, panelHostFrame, panelOf, writeFrameDocument } from "./panel-frame";

/*
 * An agent asks to show another page while the panel beside the conversation holds the reader's unsaved form. The real
 * panel, its frame and the agent platform's display: the request is answered at once that it was not opened because of
 * the unsaved changes, and the panel, its form and the address stay as they are. Nobody is asked.
 */
const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Assistant", description: "", icon: null, enabled: true };
const host = vi.hoisted(() => ({ stream: null as unknown as ReturnType<typeof noticeStreamDouble> }));
vi.mock("../../../../../packages/workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../../../../../packages/workbench-ui/src/features/workbench/assistant-host", async (importOriginal) => {
  const { assistantHostDouble } = await import("../../../../../packages/workbench-ui/src/features/workbench/__tests__/host-double");
  return {
    ...(await importOriginal<object>()),
    createAssistantClient: () => assistantHostDouble({ agents: [agent], sessionRuns: host.stream.port }),
    createAssistantFeedback: () => undefined,
    createPanelOperationSettings: () => undefined,
  };
});

afterEach(leaveFrame);

describe("an agent's presentation over a panel's unsaved form", () => {
  it("is refused at once, and the panel and its address stay", { timeout: 20000 }, async () => {
    host.stream = noticeStreamDouble();
    const scenario = draftScenario();
    installPlatform(scenario.answer);
    // The conversation the reader is in, by its address, with the panel beside it.
    const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
    await router.push({ path: platformRoutes.chat.path, query: { sessionId: SESSION, page: scenario.address } });
    await router.isReady();
    const app = createApp({ render: () => h(BusinessWorkbench, { defaultLogo: "", defaultBrandName: "Ontomato" }) })
      .use(router).use(workbenchI18n()).use(ElementPlus).use(createPinia())
      .provide(pilotPageKey, pilotPageResolver)
      .provide(platformPageAccessKey, () => true);
    const root = document.createElement("div");
    document.body.append(root);
    app.mount(root);

    // The panel's frame runs and takes the draft: its form is unsaved, which the frame reports to the platform.
    const element = await panelHostFrame();
    writeFrameDocument(hostMessageOf(element.getAttribute("srcdoc")!));
    inside(element.contentWindow!);
    const { context } = await mountPanel(panelOf("form"));
    await vi.waitFor(() => expect(context.instance.dirty()).toBe(true), { timeout: 5000 });

    // The page's notice stream is ready with its display binding, and a run of this conversation asks.
    await host.stream.current().frame({ type: "ready", presentationBinding: { connectionId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1" } });
    const address = router.currentRoute.value.fullPath;
    const asked = Date.now();
    host.stream.current().presentation!({
      type: "presentation", sessionId: SESSION, runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", toolCallId: "call-1",
      target: { kind: "page", address: "/dashboards" },
    });
    await vi.waitFor(() => expect(host.stream.receipts).toHaveLength(1), { timeout: 1000 });

    expect(Date.now() - asked).toBeLessThan(1000);
    expect(host.stream.receipts[0]!.receipt.result).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      current: { known: true, target: { kind: "page" } },
    });
    // The panel is the one still drawn, its form still unsaved, and the address still carries it.
    expect(document.querySelector("iframe.panel-host-frame")).toBe(element);
    expect(context.instance.dirty()).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe(address);
    app.unmount();
  });
});
