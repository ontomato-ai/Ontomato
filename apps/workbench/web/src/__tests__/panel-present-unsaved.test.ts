import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { SESSION, noticeStreamDouble } from "../../../../../packages/workbench-ui/src/features/workbench/__tests__/host-double";
import { liveFormScenario, installPlatform, leaveFrame } from "./panel-frame";

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

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  leaveFrame();
});

async function openDirtyForm() {
  host.stream = noticeStreamDouble();
  const scenario = liveFormScenario();
  installPlatform(scenario.answer);
  // The conversation the reader is in, by its address, with the panel beside it.
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
  await router.push({ path: platformRoutes.chat.path, query: { sessionId: SESSION, page: scenario.address } });
  await router.isReady();
  const onDisplayDirty = vi.fn();
  const app = createApp({ render: () => h(BusinessWorkbench, { defaultLogo: "", defaultBrandName: "Ontomato" }) })
    .use(router).use(workbenchI18n()).use(ElementPlus).use(createPinia())
    .provide(pilotPageKey, (navigate) => {
      const resolve = pilotPageResolver(navigate);
      return (address) => {
        const page = resolve(address);
        return page && { ...page, props: { ...page.props, onDisplayDirty } };
      };
    })
    .provide(platformPageAccessKey, () => true);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  unmount = () => app.unmount();

  const edit = await vi.waitFor(() => {
    const button = root.querySelector<HTMLButtonElement>("[data-edit]");
    expect(button).not.toBeNull();
    return button!;
  });
  edit.click();

  // Wait for the panel's form to mount and register its live controller.
  await vi.waitFor(() => expect(root.querySelector('[data-field="/caseSetId"]')).not.toBeNull(), { timeout: 5000 });

  // The page view's stream is ready; the agent fills the form live, leaving it unsaved and marked changed.
  await vi.waitFor(() => expect(host.stream.opened.length).toBeGreaterThan(0), { timeout: 5000 });
  await host.stream.current().frame({ type: "ready", connectionId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1" });
  host.stream.current().view!.frame({
    type: "presentation", sessionId: SESSION, runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", toolCallId: "call-fill",
    target: { kind: "fill_form", member: "form", values: { "/caseSetId": "set-smoke" } },
  });
  await vi.waitFor(() => expect(host.stream.receipts).toHaveLength(1), { timeout: 5000 });
  expect(host.stream.receipts[0]!.receipt.result).toMatchObject({
    status: "filled",
    member: "form",
    filledFields: ["/caseSetId"],
  });
  await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(true), { timeout: 5000 });

  return { router, root, onDisplayDirty, scenario };
}

describe("an agent's presentation over a panel's unsaved form", () => {
  it("blocks navigation and state changes that would discard edits while allowing no-op presentations", { timeout: 20000 }, async () => {
    const { router, root, onDisplayDirty, scenario } = await openDirtyForm();
    const address = router.currentRoute.value.fullPath;
    const form = root.querySelector('[data-field="/caseSetId"]');
    const { pathname, searchParams } = new URL(scenario.address, "https://page.invalid");
    const selectedTask = searchParams.get("selectedTask")!;
    const otherTask = "another-task";
    const cases = [
      { address: `${pathname}?selectedTask=${otherTask}`, status: "not_opened" },
      { address: pathname, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: otherTask } }, status: "not_opened" },
      { address: pathname, state: { mode: "view" }, status: "not_opened" },
      { address: pathname, status: "not_opened" },
      { address: pathname, state: {}, status: "not_opened" },
      { address: scenario.address, status: "opened" },
      { address: scenario.address, state: { mode: "edit" }, status: "opened" },
      { address: pathname, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: selectedTask } }, status: "opened" },
      { address: `${pathname}?selectedTask=${otherTask}`, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: selectedTask } }, status: "opened" },
      { address: "/dashboards", status: "not_opened" },
    ] as const;
    for (const [index, { status, ...target }] of cases.entries()) {
      const toolCallId = `call-present-${index}`;
      host.stream.current().view!.frame({
        type: "presentation", sessionId: SESSION, runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", toolCallId,
        target: { kind: "page", ...target },
      });
      await vi.waitFor(() => expect(host.stream.receipts).toHaveLength(index + 2), { timeout: 5000 });
      expect(host.stream.receipts[index + 1]!.receipt.result).toMatchObject(status === "not_opened"
        ? { status, reason: "blocked_unsaved", error: { code: "UNSAVED_CHANGES" } }
        : { status });
      expect(root.querySelector('[data-field="/caseSetId"]')).toBe(form);
      expect(root.querySelector(".sdk-owner-form-changed")).not.toBeNull();
      expect(onDisplayDirty).toHaveBeenLastCalledWith(true);
      expect(router.currentRoute.value.fullPath).toBe(address);
    }
  });
});
