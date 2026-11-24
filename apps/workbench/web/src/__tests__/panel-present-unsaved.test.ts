import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createApp, defineComponent, h } from "vue";
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
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";

const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Assistant", description: "", icon: null, enabled: true };
const host = vi.hoisted(() => ({ stream: null as unknown as ReturnType<typeof noticeStreamDouble> }));
vi.mock("../../../../../packages/workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("@ontomato/foundation-ui/code", () => ({
  CodeEditor: defineComponent({
    props: { modelValue: String },
    emits: ["update:modelValue"],
    setup: (props, { emit }) => () => h("textarea", {
      value: props.modelValue,
      onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
    }),
  }),
}));
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
  window.dispatchEvent(new Event("pageshow"));
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

  const form = () => root.querySelector('[data-field="/caseSetId"]');
  const assertDirty = () => {
    expect(form()?.textContent).toContain("Smoke (8)");
    expect(root.querySelector(".sdk-owner-form-changed")).not.toBeNull();
    expect(onDisplayDirty).toHaveBeenLastCalledWith(true);
  };
  return { router, root, scenario, form, assertDirty };
}

async function present(target: Omit<Extract<PresentationFrame["target"], { kind: "page" }>, "kind">) {
  const toolCallId = `call-present-${host.stream.receipts.length}`;
  host.stream.current().view!.frame({
    type: "presentation", sessionId: SESSION, runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", toolCallId,
    target: { kind: "page", ...target },
  });
  return vi.waitFor(() => {
    const receipt = host.stream.receipts.find(({ receipt }) => receipt.toolCallId === toolCallId);
    expect(receipt).toBeDefined();
    return receipt!.receipt.result;
  }, { timeout: 5000 });
}

const blockedUnsaved = { status: "not_opened", reason: "blocked_unsaved", error: { code: "UNSAVED_CHANGES" } };

describe("an agent's presentation over a panel's unsaved form", () => {
  it("blocks address and state target changes before unmounting or reading the form", { timeout: 20000 }, async () => {
    const { router, scenario, form, assertDirty } = await openDirtyForm();
    const address = router.currentRoute.value.fullPath;
    const original = form();
    const reads = scenario.formReads();
    const { pathname, searchParams } = new URL(scenario.address, "https://page.invalid");
    const selectedTask = searchParams.get("selectedTask")!;
    const otherTask = "another-task";
    const cases = [
      { address: `${pathname}?selectedTask=${otherTask}`, status: "not_opened" },
      { address: pathname, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: otherTask } }, status: "not_opened" },
      { address: pathname, status: "not_opened" },
      { address: pathname, state: {}, status: "not_opened" },
      { address: scenario.address, status: "opened" },
      { address: scenario.address, state: { mode: "edit" }, status: "opened" },
      { address: pathname, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: selectedTask } }, status: "opened" },
      { address: `${pathname}?selectedTask=${otherTask}`, state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: selectedTask } }, status: "opened" },
      { address: "/dashboards", status: "not_opened" },
    ] as const;
    for (const { status, ...target } of cases) {
      expect(await present(target)).toMatchObject(status === "not_opened" ? blockedUnsaved : { status });
      expect(form()).toBe(original);
      assertDirty();
      expect(router.currentRoute.value.fullPath).toBe(address);
      expect(scenario.formReads()).toBe(reads);
    }
  });

  it("keeps edits when switching a v-show tab, filtering a list, and opening a sibling dialog", { timeout: 20000 }, async () => {
    const { root, scenario, form, assertDirty } = await openDirtyForm();
    const original = form();
    const address = new URL(scenario.address, "https://page.invalid").pathname;
    expect(await present({ address, state: { tab: "effects" } })).toMatchObject({ status: "opened" });
    expect(root.querySelector('[data-tab="effects"]')).not.toBeNull();
    expect(form()).toBe(original);
    assertDirty();

    const list = {
      search: "smoke",
      status: "pending",
      checked: [{ className: SCHEDULED_TASK, primaryKey: "another-task" }],
    };
    expect(await present({ address, state: list })).toMatchObject({ status: "opened" });
    expect(JSON.parse(root.querySelector("[data-list]")!.textContent!)).toEqual(list);
    expect(form()).toBe(original);
    assertDirty();

    expect(await present({ address, state: { grantDialog: true } })).toMatchObject({ status: "opened" });
    expect(root.querySelector("[data-grant]")).not.toBeNull();
    expect(form()).toBe(original);
    assertDirty();
  });

  it("rolls back a v-if unmount with the draft and invalid JSON text intact before reporting the refusal", { timeout: 20000 }, async () => {
    const { router, root, scenario, form, assertDirty } = await openDirtyForm();
    const original = form();
    const jsonInput = () => root.querySelector<HTMLTextAreaElement>('[data-field="/settings"] textarea');
    await vi.waitFor(() => expect(jsonInput()).not.toBeNull());
    const invalid = '{ "still typing": ';
    jsonInput()!.value = invalid;
    jsonInput()!.dispatchEvent(new Event("input", { bubbles: true }));
    const reads = scenario.formReads();
    const address = router.currentRoute.value.fullPath;
    const addresses: string[] = [];
    router.afterEach((to) => addresses.push(to.fullPath));

    expect(await present({ address: `${scenario.address}&tab=effects`, state: { mode: "view" } })).toMatchObject({
      ...blockedUnsaved,
      current: { target: { url: scenario.address } },
    });
    expect(form()).not.toBeNull();
    expect(form()).not.toBe(original);
    assertDirty();
    await vi.waitFor(() => {
      expect(jsonInput()?.value).toBe(invalid);
      expect(root.querySelector('[data-field="/settings"] .el-form-item__error')).not.toBeNull();
    });
    expect(root.querySelector("[data-tab]")).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe(address);
    expect(addresses).toEqual([]);
    expect(scenario.formReads()).toBe(reads);
    expect(document.querySelector(".el-message-box")).toBeNull();
  });
});
