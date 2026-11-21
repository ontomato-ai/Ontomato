import { describe, expect, it, vi } from "vitest";
import { watch } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { APPLICATION_PANEL_USE } from "@ontomato/contracts/platform-object-types";
import { createPanelState, type PanelInitialState } from "../../../../../packages/apps-sdk/src/panel/state";
import { createPanelCommands, type PanelCommandOpen } from "../../../../../packages/apps-sdk/src/panel/commands";

/*
 * A panel's header commands (overall design 3.4, 5.1): the header's operations are the declaration's commands, a state
 * change is written once however many fields it names, and an operation or an open receives the values the declaration
 * resolved rather than the references it was written with.
 *
 * The state is the SDK's own, built from the manifest as a running panel builds it; only the member operations, the
 * host's open and the panel's words are stand-ins, because those belong to the platform.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";
const task = { className: SCHEDULED_TASK, primaryKey: "0f8a2c1e-0000-4000-8000-000000000001" };

const panel = definePanel({
  state: {
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
    search: { type: { kind: "scalar", type: "string" }, deepLink: true },
    savedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
  },
  members: {
    tasks: { target: { projectionId: "projection-tasks" } },
    taskForm: { target: { projectionId: "projection-task-form" }, inputs: { task: { state: "selectedTask" } } },
    runTask: { target: { projectionId: "projection-run-task" } },
  },
  commands: {
    clear: {
      labelKey: "tasks.clear",
      primary: true,
      do: { set: { fields: { selectedTask: { literal: null }, search: { literal: "" } } } },
    },
    runNow: {
      labelKey: "tasks.run",
      do: { invoke: { member: "runTask", operation: "run", inputs: { task: { state: "selectedTask" }, note: { literal: "now" } } } },
    },
    askAgent: {
      labelKey: "tasks.form",
      do: { open: { mode: "conversationEntry", member: "taskForm" } },
    },
    openApplication: {
      labelKey: "tasks.application",
      do: { open: { mode: "entry", entry: { literal: { className: APPLICATION_PANEL_USE, primaryKey: "use-1" } }, inputs: {} } },
    },
    // A field that cannot be resolved after one that can: the state must keep both as they were.
    halfSet: {
      labelKey: "tasks.half",
      do: { set: { fields: { search: { literal: "half" }, savedTask: { item: true } } } },
    },
  },
});

const words: Record<string, string> = { "tasks.clear": "Clear", "tasks.run": "Run now", "tasks.form": "Details", "tasks.application": "Open", "tasks.half": "Half" };

/** One panel's commands over its own state, with the calls the platform would receive recorded. */
function panelCommands(initial: PanelInitialState = {}) {
  const state = createPanelState(panel, initial);
  const invokeMember = vi.fn(async () => undefined);
  const open = vi.fn(async (_request: PanelCommandOpen) => undefined);
  const commands = createPanelCommands(panel, { state, invokeMember, open, text: (key) => words[key] ?? key });
  return { state, commands, invokeMember, open };
}

describe("a panel's commands", () => {
  it("offers the header its commands, in declaration order", () => {
    const { commands } = panelCommands();
    expect(commands.operations().map(({ id, label }) => [id, label])).toEqual([
      ["clear", "Clear"], ["runNow", "Run now"], ["askAgent", "Details"], ["openApplication", "Open"], ["halfSet", "Half"],
    ]);
    expect(commands.operations()[0]).toEqual({ id: "clear", label: "Clear", kind: "state", inputSchema: {}, handlerRef: "panel.state.clear" });
  });

  it("writes every field of a state change in one assignment", async () => {
    const { state, commands } = panelCommands({ selectedTask: task, search: "draft" });
    const seen: string[] = [];
    watch(state.values, (values) => seen.push(JSON.stringify(values)), { flush: "sync", deep: true });
    await commands.invoke("clear");
    expect(seen).toEqual([JSON.stringify({ selectedTask: null, search: "", savedTask: null })]);
    expect(state.values.value).toEqual({ selectedTask: null, search: "", savedTask: null });
  });

  it("hands a member's operation the values it resolved, not the references", async () => {
    const { commands, invokeMember } = panelCommands({ selectedTask: task });
    await commands.invoke("runNow");
    expect(invokeMember.mock.calls).toEqual([["runTask", "run", { task, note: "now" }]]);
  });

  it("hands the host a conversation entry's open naming the member whose projection declares it", async () => {
    const { commands, open } = panelCommands({ selectedTask: task });
    await commands.invoke("askAgent");
    expect(open.mock.calls).toEqual([[{ mode: "conversationEntry", member: "taskForm" }]]);
  });

  it("hands the host an entry open as the object it names", async () => {
    const { commands, open } = panelCommands();
    await commands.invoke("openApplication");
    expect(open.mock.calls).toEqual([[{ mode: "entry", entry: { className: APPLICATION_PANEL_USE, primaryKey: "use-1" }, inputs: {} }]]);
  });

  it("refuses an unknown command", async () => {
    const { commands } = panelCommands();
    await expect(commands.invoke("nothing")).rejects.toThrow("This panel declares no command 'nothing'");
  });

  it("refuses a member's item no command is handed, leaving the whole state change unwritten", async () => {
    const { state, commands } = panelCommands({ selectedTask: task, search: "draft" });
    await expect(commands.invoke("halfSet")).rejects.toThrow("names a member's item, which no command is handed");
    expect(state.values.value).toEqual({ selectedTask: task, search: "draft", savedTask: null });
  });
});
