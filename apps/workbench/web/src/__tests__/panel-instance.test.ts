import { describe, expect, it, vi } from "vitest";
import { definePanel, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import { createPanelInstance, applyPanelRequest } from "../../../../../packages/apps-sdk/src/panel/instance";
import { PanelFormAdapters, receivePanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { panelContains } from "../../../../../packages/apps-sdk/src/panel/projection";

/*
 * A panel declares its state and what it composes, and nothing else: the SDK reports what the reader looks at, derives
 * the operations its projections publish, takes the drafts that name its form and keeps every instance's state apart.
 * These are the mistakes that would send the work back to hand-written wiring: a panel that has to report its own
 * context, a panel that has to list its projections' operations again, and a selection that reaches another instance.
 */

/** The panel of the trial scenario: a task list, the task's form, and a button that runs the selected task now. */
const panel = definePanel({
  state: {
    selectedTask: { kind: "object", objectType: "platform:ScheduledTask", deepLink: true },
    application: { kind: "object", objectType: "platform:Application" },
    search: { kind: "scalar", type: "string" },
  },
  slots: {
    tasks: { projectionId: "projection-task-list" },
    taskForm: { projectionId: "projection-task-form", inputs: { task: { state: "selectedTask" } } },
    runTask: { projectionId: "projection-run-task", inputs: { task: { state: "selectedTask" } } },
  },
  operations: [{ id: "task.clear", label: "Clear", kind: "state", sets: { selectedTask: null } }],
}) satisfies PanelManifest;

const task = (primaryKey: string) => ({ className: "platform:ScheduledTask", primaryKey });

function instance(primaryKey?: string) {
  const panelInstance = createPanelInstance(panel, {
    pageKey: "schedules",
    url: () => "/schedules?task=" + (primaryKey ?? ""),
    label: () => "Scheduled tasks",
    initial: primaryKey ? { selectedTask: task(primaryKey) } : {},
  });
  return panelInstance;
}

/** The ports the trial's projections publish: a list to pick from, a form that saves the task, a button that runs it. */
function register(panelInstance: ReturnType<typeof instance>) {
  const run = vi.fn(async () => ({ id: "run-1" }));
  const save = vi.fn(async () => ({ id: "task-1" }));
  const unregisterForm = panelInstance.register({
    slot: "taskForm",
    projectionId: "projection-task-form",
    ports: {
      binding: "PlatformOperation:schedules.update",
      inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" } },
      operations: [
        { name: "update", label: "Save", kind: "form.save", inputSchema: {}, handlerRef: "schedules.update" },
      ],
    },
    invoke: () => save(),
  });
  const unregisterRun = panelInstance.register({
    slot: "runTask",
    projectionId: "projection-run-task",
    ports: {
      binding: "PlatformOperation:schedules.runNow",
      inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" } },
      operations: [
        { name: "runNow", label: "Run now", kind: "action", inputSchema: {}, handlerRef: "schedules.runNow" },
      ],
    },
    invoke: () => run(),
  });
  const unregisterList = panelInstance.register({
    slot: "tasks",
    projectionId: "projection-task-list",
    ports: {
      binding: "PlatformObjectType:platform:ScheduledTask",
      inputs: {},
      operations: [],
    },
    invoke: async () => null,
  });
  return { run, save, unregister: () => { unregisterForm(); unregisterRun(); unregisterList(); } };
}

describe("a panel's instance", () => {
  it("reports what the reader looks at, from its own state alone", () => {
    const panelInstance = instance("task-1");
    // No setPageContext anywhere: the object the instance holds is what a message names.
    expect(panelInstance.pageContext.value).toEqual({
      pageKey: "schedules",
      url: "/schedules?task=task-1",
      label: "Scheduled tasks",
      selection: [{ kind: "platform:ScheduledTask", id: "task-1", label: "platform:ScheduledTask task-1" }],
    });
  });

  it("keeps three instances' selections apart", () => {
    const first = instance("task-1");
    const second = instance("task-2");
    const third = instance();

    // The third is the same instance opened from the panel's entry with nothing selected: it stays empty.
    expect(third.pageContext.value.selection).toEqual([]);
    expect(first.pageContext.value.selection[0]?.id).toBe("task-1");
    expect(second.pageContext.value.selection[0]?.id).toBe("task-2");

    first.state.set("selectedTask", task("task-9"));
    expect(second.pageContext.value.selection[0]?.id).toBe("task-2");
    expect(third.pageContext.value.selection).toEqual([]);
  });

  it("refuses a value of another ontology type, so a state is never a different object", () => {
    const panelInstance = instance();
    expect(() => panelInstance.state.set("selectedTask", { className: "platform:Application", primaryKey: "a" }))
      .toThrow(/platform:ScheduledTask/);
    expect(() => panelInstance.state.set("search", 1)).toThrow(/string/);
  });

  it("derives the operations of its projections, and runs them here", async () => {
    const panelInstance = instance("task-1");
    const { run, save } = register(panelInstance);

    expect(panelInstance.operations.value.map((operation) => [operation.id, operation.kind, operation.target])).toEqual([
      ["taskForm.update", "form.save", { source: "state", state: "selectedTask" }],
      ["runTask.runNow", "action", { source: "state", state: "selectedTask" }],
      ["task.clear", "state", undefined],
    ]);

    await panelInstance.invoke("runTask.runNow");
    expect(run).toHaveBeenCalledTimes(1);
    await panelInstance.invoke("taskForm.update");
    expect(save).toHaveBeenCalledTimes(1);
    await panelInstance.invoke("task.clear");
    expect(panelInstance.pageContext.value.selection).toEqual([]);
  });

  it("describes everything it contains, drawn or not", () => {
    expect(panelContains(panel)).toEqual([
      { slot: "tasks", projectionId: "projection-task-list", inputs: {} },
      { slot: "taskForm", projectionId: "projection-task-form", inputs: { task: "selectedTask" } },
      { slot: "runTask", projectionId: "projection-run-task", inputs: { task: "selectedTask" } },
    ]);
  });

  it("takes a draft of its own form, comparing it with the owner's reading", async () => {
    const panelInstance = instance("task-1");
    register(panelInstance);
    const adapters = new PanelFormAdapters();
    const read = vi.fn(async () => ({ title: "Nightly", application: "reports" }));
    adapters.register("taskForm", {
      operation: "schedules.update",
      read,
      save: async () => ({ id: "task-1" }),
    });

    const received = await receivePanelDraft(
      "schedules",
      adapters,
      {
        readPageDraft: async () => ({
          pageKey: "schedules",
          operation: "schedules.update",
          target: { id: "task-1" },
          form: { title: "Nightly report", application: "reports" },
        }),
      },
      { sessionId: "s", runId: "r", path: "outputs/drafts/a.page-draft.json" },
      async () => true,
    );

    expect(received?.slot).toBe("taskForm");
    // The field the draft changed, found from the owner's own read.
    expect([...(received?.changed ?? [])]).toEqual(["title"]);
  });

  it("keeps a value the panel does not offer in an address out of one", () => {
    const panelInstance = instance();
    // `search` and `application` are not deep-linkable, so a link naming them restores nothing.
    applyPanelRequest(panel, panelInstance.state, {
      useId: "use-1",
      state: { selectedTask: task("task-4"), search: "overdue", application: { className: "platform:Application", primaryKey: "a" } },
    });
    expect(panelInstance.state.values.value.selectedTask).toEqual(task("task-4"));
    expect(panelInstance.state.values.value.search).toBeNull();
    expect(panelInstance.state.values.value.application).toBeNull();
    expect(panelInstance.deepLink()).toEqual({ selectedTask: task("task-4") });
  });
});
