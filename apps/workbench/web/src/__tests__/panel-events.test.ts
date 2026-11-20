import { describe, expect, it, vi } from "vitest";
import { watch } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { APPLICATION_PANEL_USE } from "@ontomato/contracts/platform-object-types";
import { createPanelState, type PanelInitialState } from "../../../../../packages/apps-sdk/src/panel/state";
import { createPanelEvents, type PanelEventOpen } from "../../../../../packages/apps-sdk/src/panel/events";

/*
 * A panel's events (overall design 3.4, 5.1): the header's operations are the declaration's labeled events, a state change
 * is written once however many fields it names, an output trigger sees the value the member handed over, and an
 * operation or an open receives the values the declaration resolved rather than the references it was written with.
 *
 * The state is the SDK's own, built from the manifest as a running panel builds it; only the member operations, the
 * host's open and the panel's words are stand-ins, because those belong to the platform.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";
const task = { className: SCHEDULED_TASK, primaryKey: "0f8a2c1e-0000-4000-8000-000000000001" };
const otherTask = { className: SCHEDULED_TASK, primaryKey: "0f8a2c1e-0000-4000-8000-000000000002" };

const panel = definePanel({
  state: {
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
    search: { type: { kind: "scalar", type: "string" } },
    savedTask: { type: { kind: "object", objectType: SCHEDULED_TASK } },
  },
  members: {
    tasks: { target: { projectionId: "projection-tasks" } },
    taskForm: { target: { projectionId: "projection-task-form" }, inputs: { task: { state: "selectedTask" } }, outputs: { saved: { state: "savedTask" } } },
    runTask: { target: { projectionId: "projection-run-task" } },
  },
  events: {
    clear: {
      labelKey: "tasks.clear",
      do: { set: { fields: { selectedTask: { literal: null }, search: { literal: "" } } } },
    },
    runNow: {
      labelKey: "tasks.run",
      do: { invoke: { member: "runTask", operation: "run", inputs: { task: { state: "selectedTask" }, note: { literal: "now" } } } },
    },
    openForm: {
      labelKey: "tasks.form",
      do: { open: { mode: "drawer", member: "taskForm", inputs: { task: { state: "selectedTask" }, keep: { literal: true } } } },
    },
    openApplication: {
      labelKey: "tasks.application",
      do: { open: { mode: "entry", entry: { literal: { className: APPLICATION_PANEL_USE, primaryKey: "use-1" } }, inputs: {} } },
    },
    // Both triggered by one output, written apart to show they run in declaration order.
    pick: {
      on: { member: "tasks", output: "selected" },
      do: { set: { fields: { selectedTask: { event: true }, search: { literal: "picked" } } } },
    },
    notePicked: {
      on: { member: "tasks", output: "selected" },
      do: { invoke: { member: "runTask", operation: "note", inputs: { task: { state: "selectedTask" } } } },
    },
    saveRow: {
      on: { member: "taskForm", output: "saved" },
      do: { set: { fields: { savedTask: { item: true }, search: { literal: "saved" } } } },
    },
    // A field that cannot be resolved after one that can: the state must keep both as they were.
    halfPicked: {
      on: { member: "taskForm", output: "half" },
      do: { set: { fields: { search: { literal: "half" }, selectedTask: { item: true } } } },
    },
  },
});

const words: Record<string, string> = { "tasks.clear": "Clear", "tasks.run": "Run now", "tasks.form": "Details", "tasks.application": "Open" };

/** One panel's events over its own state, with the calls the platform would receive recorded. */
function panelEvents(initial: PanelInitialState = {}) {
  const state = createPanelState(panel, initial);
  const invokeMember = vi.fn(async () => undefined);
  const open = vi.fn(async (_request: PanelEventOpen) => undefined);
  const events = createPanelEvents(panel, { state, invokeMember, open, text: (key) => words[key] ?? key });
  return { state, events, invokeMember, open };
}

describe("a panel's events", () => {
  it("offers the header its labeled events, in declaration order", () => {
    const { events } = panelEvents();
    expect(events.operations()).toEqual([
      { id: "clear", label: "Clear", kind: "state", inputSchema: {}, handlerRef: "panel.state.clear" },
      { id: "runNow", label: "Run now", kind: "state", inputSchema: {}, handlerRef: "panel.state.runNow" },
      { id: "openForm", label: "Details", kind: "state", inputSchema: {}, handlerRef: "panel.state.openForm" },
      { id: "openApplication", label: "Open", kind: "state", inputSchema: {}, handlerRef: "panel.state.openApplication" },
    ]);
  });

  it("writes every field of a state change in one assignment", async () => {
    const { state, events } = panelEvents({ selectedTask: task, search: "draft" });
    const seen: string[] = [];
    watch(state.values, (values) => seen.push(JSON.stringify(values)), { flush: "sync", deep: true });
    await events.invoke("clear");
    expect(seen).toEqual([JSON.stringify({ selectedTask: null, search: "", savedTask: null })]);
    expect(state.values.value).toEqual({ selectedTask: null, search: "", savedTask: null });
  });

  it("gives an output trigger the value the member handed over", async () => {
    const { state, events, invokeMember } = panelEvents();
    await events.emitted("tasks", "selected", otherTask);
    expect(state.values.value).toMatchObject({ selectedTask: otherTask, search: "picked" });
    // The trigger after it reads the state this one just wrote, in declaration order.
    expect(invokeMember.mock.calls).toEqual([["runTask", "note", { task: otherTask }]]);
  });

  it("gives a triggered state change the item the member named", async () => {
    const { state, events } = panelEvents();
    await events.emitted("taskForm", "saved", { saved: "ok" }, otherTask);
    expect(state.values.value).toMatchObject({ savedTask: otherTask, search: "saved" });
  });

  it("hands a member's operation the values it resolved, not the references", async () => {
    const { events, invokeMember } = panelEvents({ selectedTask: task });
    await events.invoke("runNow");
    expect(invokeMember.mock.calls).toEqual([["runTask", "run", { task, note: "now" }]]);
  });

  it("hands the host an open with its mode, member and resolved inputs", async () => {
    const { events, open } = panelEvents({ selectedTask: task });
    await events.invoke("openForm");
    expect(open.mock.calls).toEqual([[{ mode: "drawer", member: "taskForm", inputs: { task, keep: true } }]]);
  });

  it("hands the host an entry open as the object it names", async () => {
    const { events, open } = panelEvents();
    await events.invoke("openApplication");
    expect(open.mock.calls).toEqual([[{ mode: "entry", entry: { className: APPLICATION_PANEL_USE, primaryKey: "use-1" }, inputs: {} }]]);
  });

  it("refuses an unknown event and an event that runs on an output", async () => {
    const { events } = panelEvents();
    await expect(events.invoke("nothing")).rejects.toThrow("This panel declares no event 'nothing'");
    await expect(events.invoke("pick")).rejects.toThrow("Event 'pick' runs on 'tasks.selected', not on invocation");
  });

  it("refuses an item it was not handed, leaving the whole state change unwritten", async () => {
    const { state, events } = panelEvents({ selectedTask: task, search: "draft" });
    await expect(events.emitted("taskForm", "half", { saved: "ok" })).rejects.toThrow("names the member's item, and no item was handed over");
    expect(state.values.value).toEqual({ selectedTask: task, search: "draft", savedTask: null });
  });
});
