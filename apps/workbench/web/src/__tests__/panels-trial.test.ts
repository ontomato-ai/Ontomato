import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { PanelFormAdapters, receivePanelDraft, type ReceivedPanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import { operationCall } from "../../../../../packages/apps-sdk/src/panel/ports";
import { registerHandler, registeredHandlers } from "../../../../../packages/apps-sdk/src/panel/handlers";
import {
  registerPlatformObject,
  platformObjectAdapter,
  registeredPlatformObjects,
} from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";

/*
 * The trial's panel, as the SDK sees it: a declaration and projections, and nothing written per panel. These are the
 * mistakes the trial exists to rule out — a panel that has to wire its own reads, drafts or buttons; one instance's
 * choice reaching another's; a base component that carries a business field; and an operation that runs without the
 * object it was described to act on.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";
const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

/** Panel P, as its declaration file has it. */
const panel = definePanel({
  state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
  slots: {
    tasks: { projectionId: "projection-schedules-tasks", inputs: { value: { state: "selectedTask" } } },
    summary: { projectionId: "projection-schedules-summary", inputs: { task: { state: "selectedTask" } } },
    form: { projectionId: "projection-schedules-form", inputs: { task: { state: "selectedTask" } } },
    run: { projectionId: "projection-schedules-run", inputs: { task: { state: "selectedTask" } } },
  },
  operations: [],
});

/** Panel Q, as its declaration file has it: the same summary projection and nothing of P. */
const summaryPanel = definePanel({
  state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
  slots: { summary: { projectionId: "projection-schedules-summary", inputs: { task: { state: "selectedTask" } } } },
  operations: [],
});

function projection(id: string, componentId: string, binding: ProductProjection["binding"], display: Record<string, unknown> = {}): ProductProjection {
  return {
    id,
    domainId: "domain-1",
    ownerId: "owner-1",
    revision: 1,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    editable: false,
    name: id === "projection-schedules-run" ? "Run now" : id,
    description: "",
    visibility: "domain",
    componentId,
    binding,
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    display,
  };
}

const records = new Map<string, ProductProjection>([
  ["projection-schedules-tasks", projection("projection-schedules-tasks", "ObjectList", { kind: "PlatformObjectType", id: SCHEDULED_TASK })],
  ["projection-schedules-summary", projection("projection-schedules-summary", "ObjectSummary", { kind: "PlatformObjectType", id: SCHEDULED_TASK }, { fields: ["application", "state"] })],
  ["projection-schedules-form", projection("projection-schedules-form", "ObjectForm", { kind: "PlatformObjectType", id: SCHEDULED_TASK })],
  ["projection-schedules-run", projection("projection-schedules-run", "OperationButton", { kind: "PlatformOperation", id: "schedules.runNow" })],
]);

function instance(initial?: Record<string, unknown>) {
  return createPanelInstance(panel, {
    pageKey: "panels-trial-a-tasks",
    url: () => "/applications/app-panels-trial-a/tasks",
    label: () => "panels-trial-a-tasks",
    initial: initial as never,
    readProjection: async (id) => records.get(id)!,
  });
}

describe("a panel's projection", () => {
  it("publishes the operation its record binds, with the handler the catalogue names", async () => {
    // The record binds the operation, so the projection publishes that one — its label from the catalogue, its handler
    // the reference the record names. The panel wrote neither.
    expect(portsOf(records.get("projection-schedules-run")!)).toEqual({
      binding: "PlatformOperation:schedules.runNow",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      operations: [{ name: "runNow", label: "Run now", kind: "action", inputSchema: {}, handlerRef: "schedules.runNow" }],
    });
  });

  it("runs the selected task, not some other one, and says which object it acted on", async () => {
    const run = vi.fn(async (call: { target: { primaryKey: string } | { id?: string } | null }) =>
      call.target && "primaryKey" in call.target ? call.target.primaryKey : undefined,
    );
    registerHandler({ handlerRef: "schedules.runNow", invoke: run });
    const first = instance({ selectedTask: task("task-1") });
    expect(operationCall({ id: "run.runNow", label: "Run now", kind: "action", inputSchema: {}, target: { source: "state", state: "selectedTask" }, slot: "run", handlerRef: "schedules.runNow" }, first.state.values.value))
      .toEqual({ target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" }, input: {} });
    await first.runHandler("schedules.runNow", operationCall({ id: "run.runNow", label: "Run now", kind: "action", inputSchema: {}, target: { source: "state", state: "selectedTask" }, slot: "run", handlerRef: "schedules.runNow" }, first.state.values.value));
    expect(run).toHaveBeenCalledWith({ target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" }, input: {} });
  });

  it("has no target at all when nothing is selected, so a handler cannot act on the wrong object", () => {
    expect(operationCall({ id: "run.runNow", label: "Run now", kind: "action", inputSchema: {}, target: { source: "state", state: "selectedTask" }, slot: "run", handlerRef: "schedules.runNow" }, {}))
      .toEqual({ target: null, input: {} });
  });
});

describe("the platform objects this version reads", () => {
  it("registers a type's client and its own save, once", async () => {
    const save = vi.fn(async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} }));
    registerPlatformObject({
      objectType: "test:OnlyOnce",
      list: async () => [],
      read: async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} }),
      form: async () => ({ fields: [], values: {}, revision: 0 }),
      changed: async () => ({ fields: [], values: {}, revision: 0 }),
      save,
    });
    expect(registeredPlatformObjects()).toContain("test:OnlyOnce");
    // The type's save is a handler like any other, so a header button and an agent's call reach the same code.
    expect(registeredHandlers()).toContain("test:OnlyOnce.save");
    expect(() => registerPlatformObject({
      objectType: "test:OnlyOnce",
      list: async () => [],
      read: async () => ({ primaryKey: "", label: "", fields: {} }),
      form: async () => ({ fields: [], values: {}, revision: 0 }),
      changed: async () => ({ fields: [], values: {}, revision: 0 }),
      save: async () => ({ primaryKey: "", label: "", fields: {} }),
    })).toThrow(/already registered/);
    expect(() => platformObjectAdapter("test:NotRegistered")).toThrow(/reads no platform object/);
  });

  it("saves an object through the type's own client, with the values the form holds", async () => {
    const save = vi.fn(async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} }));
    registerPlatformObject({
      objectType: "test:Saved",
      list: async () => [],
      read: async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} }),
      form: async () => ({ fields: [], values: {}, revision: 3 }),
      changed: async () => ({ fields: [], values: {}, revision: 3 }),
      save,
    });
    const instanceUnderTest = instance({ selectedTask: task("task-1") });
    const registration = instanceUnderTest.register({
      slot: "form",
      projectionId: "projection-schedules-form",
      ports: { binding: "PlatformObjectType:test:Saved", inputs: {}, operations: [
        { name: "save", label: "Save", kind: "form.save", inputSchema: {}, handlerRef: "test:Saved.save" },
      ] },
      invoke: (handlerRef, call) => instanceUnderTest.runHandler(handlerRef, call),
    });
    await instanceUnderTest.runHandler("test:Saved.save", {
      target: { kind: "object", objectType: "test:Saved", primaryKey: "task-1" },
      input: { values: { operation: "inspection", instruction: "look" }, revision: 3 },
    });
    // The revision the caller read the object at travels with the write, so the owner can refuse one over a newer change.
    expect(save).toHaveBeenCalledWith("task-1", { operation: "inspection", instruction: "look" }, 3);
    registration();
  });
});

describe("a panel instance", () => {
  it("keeps one selection, and gives it to every projection of that instance", async () => {
    const panelInstance = instance({ selectedTask: task("task-1") });
    expect(panelInstance.pageContext.value.selection).toEqual([
      { kind: SCHEDULED_TASK, id: "task-1", label: `${SCHEDULED_TASK} task-1` },
    ]);
    expect(panelInstance.pageContext.value.pageKey).toBe("panels-trial-a-tasks");
  });

  it("keeps two instances' selections apart, and one opened at a link shows the task it names", () => {
    const p = instance({ selectedTask: task("task-1") });
    const q = createPanelInstance(summaryPanel, {
      pageKey: "panels-trial-b-summary",
      url: () => "/applications/app-panels-trial-b/summary",
      label: () => "panels-trial-b-summary",
      initial: { selectedTask: task("task-7") },
      readProjection: async (id) => records.get(id)!,
    });
    p.state.set("selectedTask", task("task-9"));
    expect(p.pageContext.value.selection[0]?.id).toBe("task-9");
    // Q shows the task its address named, and keeps it when P's reader chooses another.
    expect(q.pageContext.value.selection[0]?.id).toBe("task-7");
  });

  it("hands a draft to the form whose owner names its operation, and marks the fields it changed", async () => {
    const adapters = new PanelFormAdapters();
    // A form whose owner performs another operation for the draft's target declines it; the next form is asked.
    const form = (performs: string, changed: readonly string[]) => ({
      handle: { fields: shallowRef([]), values: shallowRef({}), errors: shallowRef({}), changed: shallowRef(new Set<string>()), busy: ref(false), set: () => {} },
      receive: async (draft: { operation: string }) => (draft.operation === performs ? new Set(changed) : null),
      // Which slot takes the draft and what it changed is this test's subject; the form's own save and showing are the
      // component's, checked where the component is mounted.
      submit: async () => ({}),
      dirty: () => false,
      discard: () => {},
    });
    adapters.register("other", form("agent.update", []));
    adapters.register("form", form("platform:ScheduledTask.save", ["/instruction", "/operation"]));
    const received = await new Promise<ReceivedPanelDraft<Record<string, unknown>>>((taken) =>
      void receivePanelDraft(
        "panels-trial-a-tasks",
        adapters,
        {
          readPageDraft: async () => ({
            pageKey: "panels-trial-a-tasks",
            operation: "platform:ScheduledTask.save",
            target: { id: "task-1" },
            form: { operation: "inspection", instruction: "look at tonight's failures" },
          }),
        },
        { sessionId: "s", runId: "r", path: "outputs/drafts/a.page-draft.json" },
        taken,
      ),
    );
    // The draft is unsaved: it is what the form now holds, and the fields it changed are marked.
    expect(received.slot).toBe("form");
    expect([...received.changed].sort()).toEqual(["/instruction", "/operation"]);
    expect(adapters.unclaimed(["other", "form"])).toBe(false);
  });
});

describe("a panel's module", () => {
  it("mounts a component that only places its projections, and the SDK reads each one", async () => {
    // The type the trial's projections bind, read by a stand-in client: the component draws it, the record says which.
    registerPlatformObject({
      objectType: SCHEDULED_TASK,
      list: async () => [{ primaryKey: "task-1", label: "Nightly", fields: {} }],
      read: async (primaryKey) => ({ primaryKey, label: "Nightly", fields: { application: "operations", state: "on" } }),
      form: async () => ({ fields: [], values: {}, revision: 0 }),
      changed: async () => ({ fields: [], values: {}, revision: 0 }),
      save: async (primaryKey) => ({ primaryKey: primaryKey!, label: "Nightly", fields: {} }),
    });
    const panelInstance = instance();
    const Panel = defineComponent({
      setup: () => () =>
        h("div", [
          h(Projection, { slot: "tasks" }),
          h(Projection, { slot: "summary" }),
          h(Projection, { slot: "form" }),
          h(Projection, { slot: "run" }),
        ]),
    });
    const reads: string[] = [];
    panelInstance.projection = async (id) => {
      reads.push(id);
      return records.get(id)!;
    };
    const app = createApp({ setup: () => () => h(Panel) });
    app.provide(panelContextKey, {
      panel: { content: { html: '<div id="app"></div>', module: "" }, manifest: panel, sdkVersion: "1.1.1" },
      manifest: panel,
      instance: panelInstance,
      projection: (id: string) => panelInstance.projection(id),
      invoke: (handlerRef: string, call) => panelInstance.runHandler(handlerRef, call),
      projectionsChanged: () => () => {},
      draft: ref(null),
      holdUnsaved: () => () => {},
      t: (key: string) => key,
    });
    app.mount(document.createElement("div"));
    await nextTick();
    await vi.waitFor(() => expect(reads).toHaveLength(4));
    expect(reads).toEqual([
      "projection-schedules-tasks",
      "projection-schedules-summary",
      "projection-schedules-form",
      "projection-schedules-run",
    ]);
    // Every slot's projection is registered with the ports its record gave it.
    expect(panelInstance.projections.value.map((item) => item.slot)).toEqual(["tasks", "summary", "form", "run"]);
    app.unmount();
  });
});
