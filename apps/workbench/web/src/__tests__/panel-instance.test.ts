import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelDefinitionContent, ProductProjection } from "@ontomato/contracts/product-panels";
import { createPanelInstance, applyPanelRequest } from "../../../../../packages/apps-sdk/src/panel/instance";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { registeredHandlers } from "../../../../../packages/apps-sdk/src/panel/handlers";
import { componentFor } from "../../../../../packages/apps-sdk/src/catalogue-components";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";

import { noOperations, projections, SCHEDULED_TASK } from "./panel-frame";
/*
 * A panel declares its state and places its projections, and the SDK does the rest: it reads each projection by ID,
 * draws the component the catalogue names, derives the projection's ports from the record and the catalogue, and runs an
 * operation through the handler reference the catalogue registered. These are the mistakes that would send the work back
 * to hand-written wiring: a panel that has to pass a projection's ports itself, a projection whose record is never read
 * (so changing it changes nothing), and an operation whose button reaches a handler of the panel's own.
 */

/** The panel of the trial scenario: a task summary, the task's form, and a button that runs the selected task now. */
const panel = definePanel({
  state: {
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
    application: { type: { kind: "object", objectType: "platform:Application" } },
    search: { type: { kind: "scalar", type: "string" } },
  },
  members: {
    tasks: { target: { projectionId: "projection-x" }, inputs: { task: { state: "selectedTask" } } },
    taskForm: { target: { projectionId: "projection-task-form" }, inputs: { task: { state: "selectedTask" } } },
    runTask: { target: { projectionId: "projection-run-task" }, inputs: { task: { state: "selectedTask" } } },
  },
  events: {
    "task.clear": { labelKey: "tasks.clear", do: { set: { fields: { selectedTask: { literal: null } } } } },
  },
});

/** What the host handed the frame: the panel's content and declaration, without the record's identity. */
const registered: PanelDefinitionContent = {
  content: { html: '<div id="app"></div>', module: 'import {mountPanel} from "@ontomato/sdk/panel";' },
  manifest: panel,
};

/** The records the platform holds, as the frame reads them by ID. */
const records: Record<string, ProductProjection> = {
  "projection-x": { ...projections["projection-schedules-summary"]!, id: "projection-x" },
  "projection-task-form": { ...projections["projection-schedules-form"]!, id: "projection-task-form" },
  "projection-run-task": { ...projections["projection-schedules-run"]!, id: "projection-run-task" },
};

/** The panel's own words, in the language the platform hands the frame. */
const locale = ref("en");
const text = createPanelText({ en: { "tasks.clear": "Clear" }, "zh-CN": { "tasks.clear": "清除" } }, locale, "en");

function instance(initial?: Record<string, unknown>, coordinator: Pick<typeof noOperations, "operations" | "confirmOperation"> = noOperations) {
  return createPanelInstance(panel, {
    ...coordinator,
    text,
    pageKey: "schedules",
    url: () => "/a/schedules",
    label: () => "Scheduled tasks",
    initial: initial as never,
    recordDraftCreated: async () => {},
    readProjection: async (id) => records[id]!,
  });
}

describe("a panel's instance", () => {
  it("reports what the reader looks at, from its own state alone", () => {
    const panelInstance = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } });
    expect(panelInstance.pageContext.value).toEqual({
      pageKey: "schedules",
      url: "/a/schedules",
      label: "Scheduled tasks",
      selection: [{ kind: SCHEDULED_TASK, id: "task-1", label: `${SCHEDULED_TASK} task-1` }],
    });
  });

  it("keeps three instances' selections apart", () => {
    const first = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } });
    const second = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-2" } });
    const third = instance();
    expect(third.pageContext.value.selection).toEqual([]);
    first.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "task-9" });
    expect(second.pageContext.value.selection[0]?.id).toBe("task-2");
    expect(third.pageContext.value.selection).toEqual([]);
  });

  it("takes a projection's ports and operations from its record alone, with no panel-written port", async () => {
    const panelInstance = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } });
    const summary = await panelInstance.projection("projection-x");
    expect(portsOf(summary).inputs).toEqual({ task: { kind: "object", objectType: SCHEDULED_TASK } });
    expect(summary.operations).toBeUndefined();

    // What the form can do is the owner's operation its record names, whatever component draws it.
    const form = await panelInstance.projection("projection-task-form");
    expect(Object.values(form.operations ?? {}).map(({ operation }) => operation.id)).toEqual([`${SCHEDULED_TASK}.save`]);
  });

  it("draws the component the catalogue names, and refuses one this version has not got", async () => {
    // A component is fetched the first time a projection names it, and the same one twice is one fetch.
    expect(await componentFor("ObjectSummary")).not.toBe(await componentFor("ObjectForm"));
    expect(await componentFor("ObjectSummary")).toBe(await componentFor("ObjectSummary"));
    await expect(componentFor("NoSuchComponent")).rejects.toThrow(/no component 'NoSuchComponent'/);
  });

  it("runs a person's action through the platform's coordinator, as an agent's runs, leaving what it changed to the host", async () => {
    const task = { kind: "object" as const, objectType: SCHEDULED_TASK, primaryKey: "task-1" };
    const prepare = vi.fn(async (operationId: string) => ({
      intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d03", operationId, label: "Run now", confirmation: { kind: "none" as const },
    }));
    const confirmOperation = vi.fn(async ({ intentId }: { intentId: string }) => ({
      decision: "confirm" as const,
      response: { kind: "dispatched" as const, intentId, outcome: {
        kind: "success" as const, data: {}, affected: { objects: [task], objectTypes: [SCHEDULED_TASK] },
      } },
    }));
    const panelInstance = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } }, {
      operations: { ...noOperations.operations, prepare }, confirmOperation,
    });
    const changed: unknown[] = [];
    panelInstance.onObjectChanged((object) => changed.push(object));
    panelInstance.register({
      slot: "runTask", projectionId: "projection-run-task",
      ports: { binding: "PlatformOperation:schedules.runNow", inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } } },
      // Run-now as its owner admits it for the chosen task.
      operations: { runNow: {
        kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" },
        inputSchema: {}, resultSchema: {}, batch: false,
      } },
      takesDrafts: false,
    });
    const [operation] = panelInstance.operations.value.filter((candidate) => candidate.slot === "runTask");
    await panelInstance.invoke(operation!.id);
    // One intent for the selected task, which the host dispatches; nothing runs in the frame.
    expect(prepare).toHaveBeenCalledWith("runTask.runNow", { call: { target: task, input: {} } });
    expect(confirmOperation).toHaveBeenCalledWith(await prepare.mock.results[0]!.value);
    expect(registeredHandlers()).not.toContain("schedules.runNow");
    // What the owner reported changed comes back through the host's refresh port; the receipt rereads nothing itself.
    expect(changed).toEqual([]);
  });

  it("calls a draft unclaimed only once every form slot has registered and declined it", async () => {
    const panelInstance = instance();
    const declining = {
      handle: { fields: shallowRef([]), values: shallowRef({}), errors: shallowRef({}), changed: shallowRef(new Set<string>()), busy: ref(false), set: () => {} },
      // The owner's form for the draft's target performs another operation.
      receive: async () => null,
      submit: async () => ({}),
      dirty: () => false,
      discard: () => {},
    };
    const ports = { binding: `PlatformObjectType:${SCHEDULED_TASK}`, inputs: {} };
    panelInstance.forms.hold({ pageKey: "schedules", operation: "agent.update", target: { id: "a-1" }, form: {} }, { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/a.page-draft.json" }, () => {});
    panelInstance.forms.register("taskForm", declining);
    await vi.waitFor(() => expect(panelInstance.forms.unclaimed(["taskForm"])).toBe(true));
    // A declared slot still to register may be the form that takes it.
    // The form's member reads the owner's form, so a draft is offered to it; the others read none.
    panelInstance.register({ slot: "taskForm", projectionId: "projection-task-form", ports, operations: {}, takesDrafts: true });
    panelInstance.register({ slot: "tasks", projectionId: "projection-x", ports, operations: {}, takesDrafts: false });
    expect(panelInstance.unclaimedDraft.value).toBe(false);
    panelInstance.register({ slot: "runTask", projectionId: "projection-run-task", ports, operations: {}, takesDrafts: false });
    expect(panelInstance.unclaimedDraft.value).toBe(true);
  });

  it("names a state operation by the panel's own word for it, in the current language", () => {
    const panelInstance = instance();
    const named = () => panelInstance.operations.value.find((operation) => operation.id === "task.clear")!.label;
    expect(named()).toBe("Clear");
    locale.value = "zh-CN";
    expect(named()).toBe("清除");
    locale.value = "en";
  });

  it("keeps a value the panel does not offer in an address out of one", () => {
    const panelInstance = instance();
    applyPanelRequest(panel, panelInstance.state, {
      useId: "use-1",
      state: {
        selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-4" },
        search: "overdue",
        application: { className: "platform:Application", primaryKey: "a" },
      },
    });
    expect(panelInstance.deepLink()).toEqual({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-4" } });
  });
});

describe("a panel's module", () => {
  it("mounts a component that only places <Projection>, with no ports of its own", async () => {
    const panelInstance = instance();
    // The author's whole module: a declaration above, and this component. It names slots; it never names a component, a
    // binding, an input or a handler.
    const Panel = defineComponent({
      components: { Projection },
      setup: () => () =>
        h("div", [
          h(Projection, { slot: "tasks" }),
          h(Projection, { slot: "taskForm" }),
          h(Projection, { slot: "runTask" }),
        ]),
    });
    const reads: string[] = [];
    panelInstance.projection = async (id) => {
      reads.push(id);
      return records[id]!;
    };
    const element = document.createElement("div");
    const app = createApp({ setup: () => () => h(Panel) });
    // The panel's context is what a real mount provides; the instance is handed to each projection through it.
    app.provide(panelContextKey, {
      panel: registered,
      manifest: panel,
      instance: panelInstance,
      projection: (id: string) => panelInstance.projection(id),
      invoke: (handlerRef: string, call: PanelOperationCall) => panelInstance.runHandler(handlerRef, call),
      projectionsChanged: () => () => {},
      draft: ref(null),
      holdUnsaved: () => () => {},
      t: (key: string) => key,
      resources: async () => {},
      expandPageComposer: async () => {},
      readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
    });
    app.mount(element);
    await nextTick();
    await vi.waitFor(() => expect(reads).toHaveLength(3));
    // Every slot's projection was read by its own ID: the panel named them, and the SDK is what read them.
    expect(reads).toEqual(["projection-x", "projection-task-form", "projection-run-task"]);
    app.unmount();
  });
});
