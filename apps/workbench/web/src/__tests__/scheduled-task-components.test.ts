import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref, shallowRef, type Component, type Slots } from "vue";
import { createI18n } from "vue-i18n";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import publicEn from "@ontomato/workbench-ui/locales/en";
import SegmentedControl from "../../../../../packages/apps-sdk/src/base/SegmentedControl.vue";
import ScheduledTaskSummaryList from "../../../../../packages/apps-sdk/src/base/ScheduledTaskSummaryList.vue";
import type { MemberDataState } from "../../../../../packages/apps-sdk/src/panel/direct";
import type { MemberOperationsState } from "../../../../../packages/apps-sdk/src/panel/member-operations";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import { createPanelInstance, type PanelInstanceOptions } from "../../../../../packages/apps-sdk/src/panel/instance";
import { noOperations } from "./panel-frame";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function draw(
  component: Component,
  props: () => Record<string, unknown> = () => ({}),
  provide = {},
  slots?: Slots,
) {
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp(() => h(component, props(), slots));
  for (const key of Object.getOwnPropertySymbols(provide)) app.provide(key, Reflect.get(provide, key));
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }));
  app.mount(element);
  disposers.push(() => {
    app.unmount();
    element.remove();
  });
  return element;
}

function child<T extends HTMLElement = HTMLElement>(element: HTMLElement, selector: string): T {
  const found = element.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

async function click(element: HTMLElement) {
  element.click();
  await nextTick();
}

const setEnabled = "platform:ScheduledTask.setEnabled";
const runNow = "schedules.runNow";
const rowOperation = (id: string): PanelOwnerOperationDescriptor => ({
  handlerRef: id,
  kind: "action",
  effect: "write",
  batch: false,
  label: id,
  target: { source: "row" },
  inputSchema: {},
  resultSchema: {},
});

function panelFixture(options: {
  filter?: boolean;
  config?: DirectProjection["config"];
  data?: MemberDataState;
  writes?: Pick<PanelInstanceOptions, "operations" | "confirmOperation">;
} = {}) {
  const stateType = options.filter
    ? { kind: "scalar", type: "string" } as const
    : { kind: "object", objectType: SCHEDULED_TASK } as const;
  const memberKey = options.filter ? "appFilter" : "tasks";
  const manifest = definePanel({
    state: { selected: { type: stateType }, resolved: { type: { kind: "object", objectType: SCHEDULED_TASK } } },
    members: {
      [memberKey]: {
        target: { projectionId: memberKey },
        inputs: options.filter ? { value: { state: "selected" } } : { selected: { state: "selected" } },
        outputs: options.filter ? { value: { state: "selected" } } : {
          selected: { state: "selected" }, resolveTarget: { state: "resolved" },
        },
      },
    },
  });
  const projection: DirectProjection = {
    domainId: "domain",
    ownerId: "owner",
    id: memberKey,
    name: memberKey,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    editable: false,
    visibility: "domain",
    description: "",
    componentId: options.filter ? "@ontomato/sdk:SegmentedControl" : "@ontomato/sdk:ScheduledTaskSummaryList",
    inputs: options.filter ? { value: stateType } : { selected: stateType },
    outputs: options.filter ? { value: stateType } : { selected: stateType },
    data: {
      [options.filter ? "counts" : "rows"]: {
        source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
        read: options.filter ? "counts" : "list",
        params: {},
      },
    },
    config: options.config ?? {},
    operations: {
      setEnabled: { operation: { kind: "PlatformOperation", id: setEnabled }, target: { row: true } },
      runNow: { operation: { kind: "PlatformOperation", id: runNow }, target: { row: true }, params: { title: { row: "label" } } },
    },
  };
  const instance = createPanelInstance(manifest, {
    pageKey: "schedules",
    url: () => "/schedules",
    label: () => "Scheduled tasks",
    text: key => key,
    readProjection: async () => projection,
    ...noOperations,
    ...options.writes,
  });
  const data = shallowRef<MemberDataState>(options.data ?? { status: "empty" });
  const ops = shallowRef<MemberOperationsState>({
    status: "ready", value: { setEnabled: rowOperation(setEnabled), runNow: rowOperation(runNow) },
  });
  const member: PanelMemberContext = {
    key: memberKey,
    projection,
    data: { use: () => computed(() => data.value), read: async () => data.value },
    inputs: computed(() => ({})),
    operations: computed(() => ops.value),
  };
  const provide = {
    [panelContextKey as symbol]: { instance, manifest, t: (key: string) => key, notify: vi.fn() },
    [panelMemberKey as symbol]: () => member,
  };
  return { instance, data, provide };
}

const counts = Array.from({ length: 7 }, (_, index) => ({
  key: `app-${index + 1}`, label: `Application ${index + 1}`, count: index + 2,
}));

it("collapses options beyond maxVisible into a More menu and shows the selected overflow item on the trigger", async () => {
  const { instance, provide } = panelFixture({
    filter: true,
    data: { status: "ready", value: [{ key: "", label: "Owner total", count: 60 }, ...counts] },
  });
  instance.state.set("selected", "app-7");
  const change = vi.fn();
  const update = vi.fn();
  const view = draw(SegmentedControl, () => ({
    maxVisible: 6,
    defaultValue: "",
    onChange: change,
    "onUpdate:modelValue": update,
  }), provide);
  const inlineOptions = view.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
  expect(inlineOptions).toHaveLength(6);
  expect(inlineOptions[0]!.textContent).toContain("60");
  expect(inlineOptions[5]!.textContent).toContain("Application 5");
  const trigger = child<HTMLButtonElement>(view, '[data-overflow-trigger="true"]');
  expect(trigger.classList.contains("active")).toBe(true);
  expect(trigger.textContent).toMatch(/Application 7\s*8/);
  await click(trigger);
  const option = await vi.waitFor(() => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(element => element.textContent?.includes("Application 6"));
    expect(item?.textContent).toMatch(/Application 6\s*7/);
    return item!;
  });
  await click(option);
  expect(instance.state.values.value.selected).toBe("app-6");
  expect(trigger.textContent).toMatch(/Application 6\s*7/);
  await click(inlineOptions[0]!);
  expect(instance.state.values.value.selected).toBe("");
  expect(inlineOptions[0]!.getAttribute("aria-checked")).toBe("true");
  expect(trigger.classList.contains("active")).toBe(false);
  expect(trigger.textContent).toContain("More");
  expect(change.mock.calls).toEqual([["app-6"], [""]]);
  expect(update.mock.calls).toEqual([["app-6"], [""]]);
});

it("omits the More menu when options do not exceed maxVisible and supports controlled selection", async () => {
  const selected = ref<string>("a");
  const view = draw(SegmentedControl, () => ({
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    maxVisible: 2,
    modelValue: selected.value,
    "onUpdate:modelValue": (value: string) => { selected.value = value; },
  }));
  const buttons = view.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
  expect(buttons).toHaveLength(2);
  expect(view.querySelector('[data-overflow-trigger="true"]')).toBeNull();
  expect(buttons[0]!.getAttribute("aria-checked")).toBe("true");
  await click(buttons[1]!);
  expect(selected.value).toBe("b");
  expect(buttons[1]!.getAttribute("aria-checked")).toBe("true");
});

const task = {
  primaryKey: "task-1",
  label: "Morning inspection",
  fields: {
    applicationName: "Service checks",
    applicationIcon: "database",
    settings: "Check the last overnight import",
    stateLabel: "Paused by the owner",
    enabled: true,
    revision: 42,
    frequency: "0 8 * * *",
    nextRunAt: "2026-11-26T00:00:00Z",
    pauseReason: "The import definition changed",
    lastRunStatus: "failed",
    lastRunError: "Import was removed",
    lastRunSummary: "Import was removed",
  },
};
const otherTask = {
  primaryKey: "task-2",
  label: "Evening inspection",
  fields: { applicationName: "Service checks", enabled: false, revision: 5, lastRunStatus: "completed", lastRunSummary: "24 sources checked" },
};
const runningTask = { primaryKey: "task-3", label: "Hourly inspection", fields: { activeRunId: "run-1" } };

it("preserves the default summary groups, counts, and resolve binding", async () => {
  const { instance, provide } = panelFixture({ data: { status: "ready", value: [task, otherTask, runningTask] } });
  const resolve = vi.fn();
  const view = draw(ScheduledTaskSummaryList, () => ({ onResolve: resolve }), provide);
  for (const group of ["issues", "running", "results"]) {
    expect(child(view, `[data-task-group="${group}"]`).querySelectorAll("article")).toHaveLength(1);
  }
  expect(view.querySelectorAll(".sdk-sts-counter")).toHaveLength(3);
  expect(instance.outputs.tasks).toMatchObject({ issueCount: 1, resultCount: 1, runningCount: 1 });
  expect(view.querySelector('[role="switch"]')).toBeNull();
  await click(child(view, '[data-testid="scheduled-task-resolve"]'));
  expect(instance.state.values.value.resolved).toEqual({ className: SCHEDULED_TASK, primaryKey: task.primaryKey });
  expect(resolve.mock.calls[0]?.[0]?.id).toBe(task.primaryKey);
});

it("shows application identity, schedule, revision and recent run, and separates selection from expanding details", async () => {
  const { instance, provide } = panelFixture({
    data: { status: "ready", value: { rows: [task, otherTask], total: 2 } },
    config: { presentation: "cards" },
  });
  const select = vi.fn();
  const view = draw(ScheduledTaskSummaryList, () => ({ onSelect: select }), provide);
  const card = child(view, "article");
  expect(card.querySelector("header svg")).not.toBeNull();
  expect(child(card, "header").textContent).toContain(task.fields.applicationName);
  expect(card.textContent).toContain(task.label);
  expect(card.textContent).toContain(task.fields.settings);
  expect(card.textContent).toContain(task.fields.frequency);
  expect(card.textContent).toContain(String(task.fields.revision));
  expect(view.textContent).toContain(otherTask.fields.lastRunSummary);
  const details = child(card, "button[aria-expanded]");
  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(card.textContent).not.toContain(task.fields.pauseReason);
  expect(card.textContent).not.toContain(task.fields.lastRunError);
  await click(details);
  expect(details.getAttribute("aria-expanded")).toBe("true");
  expect(card.textContent).toContain(task.fields.pauseReason);
  expect(card.textContent).toContain(task.fields.lastRunError);
  expect(select).not.toHaveBeenCalled();
  await click(details);
  expect(details.getAttribute("aria-expanded")).toBe("false");
  await click(card);
  expect(select.mock.calls[0]?.[0]?.id).toBe(task.primaryKey);
  expect(instance.state.values.value.selected).toEqual({ className: SCHEDULED_TASK, primaryKey: task.primaryKey });
});

it("sends an enable change through platform preparation and confirmation with row concurrency and permissions", async () => {
  const prepare = vi.fn(async (operationId: string) => ({
    intentId: "enable-change", operationId, label: "Switch task", confirmation: { kind: "none" as const },
  }));
  let allowConfirmation!: () => void;
  const waiting = new Promise<void>(resolve => { allowConfirmation = resolve; });
  const confirmOperation = vi.fn<Parameters<PanelInstanceOptions["confirmOperation"]>, ReturnType<PanelInstanceOptions["confirmOperation"]>>(
    async ({ intentId }) => {
      await waiting;
      return { decision: "confirm", response: { kind: "dispatched", intentId, outcome: { kind: "success", data: {} } } };
    },
  );
  const { instance, provide } = panelFixture({
    data: {
      status: "ready",
      value: [task, otherTask],
      rowOperations: { [`${SCHEDULED_TASK}:${otherTask.primaryKey}`]: {
        setEnabled: { available: false, unavailable: { reason: "Owner denied edits to this task" } },
      } },
    },
    writes: { operations: { ...noOperations.operations, prepare }, confirmOperation },
  });
  const select = vi.fn();
  const done = vi.fn();
  const toggle = vi.fn();
  const view = draw(ScheduledTaskSummaryList, () => ({
    presentation: "cards", onSelect: select, onOperationDone: done, onToggleEnabled: toggle,
  }), provide);
  const [first, second] = view.querySelectorAll<HTMLInputElement>('[role="switch"]');
  expect(first!.disabled).toBe(false);
  expect(second!.disabled).toBe(true);
  expect(view.textContent).toContain("Owner denied edits to this task");
  await click(second!.closest<HTMLElement>(".el-switch")!);
  expect(prepare).not.toHaveBeenCalled();
  await click(first!.closest<HTMLElement>(".el-switch")!);
  await vi.waitFor(() => expect(confirmOperation).toHaveBeenCalled());
  expect(prepare.mock.calls[0]?.slice(0, 2)).toEqual([
    instance.operationIdOf("tasks", "setEnabled"),
    { call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.primaryKey }, input: { enabled: false, revision: 42 } } },
  ]);
  expect(first!.disabled).toBe(true);
  await click(first!.closest<HTMLElement>(".el-switch")!);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(toggle.mock.calls[0]?.[1]).toBe(false);
  allowConfirmation();
  await vi.waitFor(() => expect(done.mock.calls[0]?.[0]).toBe("setEnabled"));
  expect(first!.disabled).toBe(false);
});

it("fires footer actions from declared bindings and allows card and row slot overrides", async () => {
  const prepare = vi.fn(async (operationId: string) => ({
    intentId: "run-now", operationId, label: "Run task", confirmation: { kind: "none" as const },
  }));
  const { instance, provide } = panelFixture({
    config: { presentation: "cards", rowActions: { items: [
      { kind: "local", id: "review", when: { field: "enabled", equals: true } },
      { kind: "operation", operation: "runNow" },
    ] } },
    data: { status: "ready", value: [task, otherTask] },
    writes: { operations: { ...noOperations.operations, prepare }, confirmOperation: async () => ({ decision: "cancel" }) },
  });
  const action = vi.fn();
  const select = vi.fn();
  const done = vi.fn();
  const view = draw(ScheduledTaskSummaryList, () => ({ onRowAction: action, onSelect: select, onOperationDone: done }), provide);
  expect(view.querySelectorAll('[data-local-action="review"]')).toHaveLength(1);
  await click(child(view, '[data-local-action="review"]'));
  expect(action.mock.calls[0]?.[0]).toBe("review");
  await click(child(view, '[data-operation="runNow"]'));
  expect(prepare.mock.calls[0]?.slice(0, 2)).toEqual([
    instance.operationIdOf("tasks", "runNow"),
    { call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.primaryKey }, input: { title: task.label } } },
  ]);
  expect(select).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();

  for (const slot of ["card-actions", "row-actions"]) {
    const override = draw(ScheduledTaskSummaryList, () => ({
      presentation: "cards", tasks: [{ id: "a", title: "Direct task", enabled: true }],
    }), {}, { [slot]: ({ task }) => [h("span", String(task.id))] });
    expect(child(override, ".sdk-sts-card-actions").textContent).toBe("a");
  }
});

it("keeps previous cards during a retry, shows the new answer, and clears cards on permission loss or empty data", async () => {
  const previous = { status: "ready" as const, value: [task] };
  const { data, provide } = panelFixture({ data: { status: "loading" } });
  const view = draw(ScheduledTaskSummaryList, () => ({ presentation: "cards" }), provide);
  expect(view.querySelector("article")).toBeNull();
  expect(view.querySelector('[aria-busy="true"]')).not.toBeNull();
  data.value = previous;
  await nextTick();
  const originalCard = child(view, "article");
  const retry = () => { data.value = { status: "loading", previous }; };
  data.value = { status: "error", message: "Owner reread failed", previous, retry };
  await nextTick();
  expect(child(view, "article")).toBe(originalCard);
  expect(child(view, '[role="alert"]').textContent).toBe("Owner reread failed");
  await click(child(view, ".fui-data-state-error button"));
  expect(child(view, "article")).toBe(originalCard);
  expect(view.querySelector('[role="alert"]')).toBeNull();
  expect(view.querySelector('[aria-busy="true"]')).not.toBeNull();
  data.value = { status: "ready", value: [otherTask] };
  await nextTick();
  expect(child(view, "article").textContent).toContain(otherTask.label);
  data.value = { status: "forbidden" };
  await nextTick();
  expect(view.querySelector("article")).toBeNull();
  expect(view.querySelector('[data-state="forbidden"]')).not.toBeNull();
  data.value = { status: "ready", value: [] };
  await nextTick();
  expect(view.querySelector('[data-state="empty"]')).not.toBeNull();
});
