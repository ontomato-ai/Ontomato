import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { PanelFormAdapters, receivePanelDraft, type ReceivedPanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import { operationCall } from "../../../../../packages/apps-sdk/src/panel/ports";
import { registeredHandlers } from "../../../../../packages/apps-sdk/src/panel/handlers";
import {
  registerPlatformObjectAdapter,
  platformObjectAdapter,
  registeredPlatformObjects,
} from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";

import { noOperations, projections } from "./panel-frame";
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
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: {
    tasks: { target: { projectionId: "projection-schedules-tasks" }, inputs: { value: { state: "selectedTask" } } },
    summary: { target: { projectionId: "projection-schedules-summary" }, inputs: { task: { state: "selectedTask" } } },
    form: { target: { projectionId: "projection-schedules-form" }, inputs: { task: { state: "selectedTask" } } },
    run: { target: { projectionId: "projection-schedules-run" }, inputs: { task: { state: "selectedTask" } } },
  },
  events: {},
});

/** Panel Q, as its declaration file has it: the same summary projection and nothing of P. */
const summaryPanel = definePanel({
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: { summary: { target: { projectionId: "projection-schedules-summary" }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
});

const records = new Map<string, ProductProjection>(Object.entries(projections));
records.set("projection-schedules-summary", {
  ...projections["projection-schedules-summary"]!,
  config: { fields: ["application", "state"] },
});

function instance(initial?: Record<string, unknown>) {
  return createPanelInstance(panel, {
    text: (key) => key,
    ...noOperations,
    pageKey: "panels-trial-a-tasks",
    url: () => "/applications/app-panels-trial-a/tasks",
    label: () => "panels-trial-a-tasks",
    initial: initial as never,
    recordDraftCreated: async () => {},
    readProjection: async (id) => records.get(id)!,
  });
}

describe("a panel's projection", () => {
  it("publishes the operation its record binds, with the handler the catalogue names", async () => {
    expect(portsOf(records.get("projection-schedules-run")!).operations).toEqual([
      { name: "runNow", label: "Run now", kind: "action", inputSchema: {}, handlerRef: "schedules.runNow" },
    ]);
  });

  it("runs the selected task, not some other one, through the platform's coordinator", async () => {
    const prepare = vi.fn(async (operationId: string) => ({
      intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d04", operationId, label: "Run now", confirmation: { kind: "none" as const },
    }));
    const first = createPanelInstance(panel, {
      text: (key) => key,
      operations: { ...noOperations.operations, prepare },
      confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: null } }),
      pageKey: "panels-trial-a-tasks",
      url: () => "/applications/app-panels-trial-a/tasks",
      label: () => "panels-trial-a-tasks",
      initial: { selectedTask: task("task-1") },
      recordDraftCreated: async () => {},
      readProjection: async (id) => records.get(id)!,
    });
    first.register({ slot: "run", projectionId: "projection-schedules-run", ports: portsOf(records.get("projection-schedules-run")!) });
    await first.invoke("run.runNow");
    expect(prepare).toHaveBeenCalledWith("run.runNow", { call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" }, input: {} } });
  });

  it("has no target at all when nothing is selected, so a handler cannot act on the wrong object", () => {
    expect(operationCall({ id: "run.runNow", label: "Run now", kind: "action", inputSchema: {}, target: { source: "state", state: "selectedTask" }, slot: "run", handlerRef: "schedules.runNow" }, {}))
      .toEqual({ target: null, input: {} });
  });
});

describe("the platform objects this version reads", () => {
  it("registers a type's adapter and its own save, once", async () => {
    const forms = { describe: vi.fn(), save: vi.fn(async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} })) };
    registerPlatformObjectAdapter({ objectType: "test:OnlyOnce", forms });
    expect(registeredPlatformObjects()).toContain("test:OnlyOnce");
    // The type's save is a handler like any other, so a header button and an agent's call reach the same code.
    expect(registeredHandlers()).toContain("test:OnlyOnce.save");
    expect(() => registerPlatformObjectAdapter({ objectType: "test:OnlyOnce" })).toThrow(/already registered/);
    expect(() => platformObjectAdapter("test:NotRegistered")).toThrow(/reads no platform object/);
  });

  it("saves through the type's own adapter with the owner's values and the revision, and refuses a call it cannot read", async () => {
    const save = vi.fn(async () => ({ primaryKey: "task-1", label: "Nightly", fields: {} }));
    registerPlatformObjectAdapter({ objectType: "test:Saved", forms: { describe: vi.fn(), save } });
    const instanceUnderTest = instance({ selectedTask: task("task-1") });
    const target = { kind: "object" as const, objectType: "test:Saved", primaryKey: "task-1" };
    await instanceUnderTest.runHandler("test:Saved.save", {
      target,
      input: { values: { operation: "inspection", checks: ["a", "b"], paused: false, owner: null }, revision: 3 },
    });
    // The owner's own value shape, untouched, and the revision the caller read the object at.
    expect(save).toHaveBeenCalledWith(target, { values: { operation: "inspection", checks: ["a", "b"], paused: false, owner: null }, revision: 3 });
    // A caller's input is checked at this boundary: values the form does not hold are no save.
    await expect(instanceUnderTest.runHandler("test:Saved.save", { target, input: { operation: "inspection" } })).rejects.toThrow();
    expect(save).toHaveBeenCalledTimes(1);
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
      text: (key) => key,
    ...noOperations,
      pageKey: "panels-trial-b-summary",
      url: () => "/applications/app-panels-trial-b/summary",
      label: () => "panels-trial-b-summary",
      initial: { selectedTask: task("task-7") },
      recordDraftCreated: async () => {},
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
    registerPlatformObjectAdapter({
      objectType: SCHEDULED_TASK,
      list: async () => [{ primaryKey: "task-1", label: "Nightly", fields: {} }],
      read: async (primaryKey) => ({ primaryKey, label: "Nightly", fields: { application: "operations", state: "on" } }),
      forms: {
        describe: async () => ({ fields: [], values: {}, errors: [], revision: 1, save: { method: "PUT", path: "/", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` } }),
        save: async (target) => ({ primaryKey: target.kind === "object" ? target.primaryKey : "", label: "Nightly", fields: {} }),
      },
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
    // The frame installs the platform's words and Element Plus (apps-sdk panel/mount), so the drawn components have them.
    const app = createApp({ setup: () => () => h(Panel) })
      .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
    app.provide(panelContextKey, {
      panel: { content: { html: '<div id="app"></div>', module: "" }, manifest: panel },
      manifest: panel,
      instance: panelInstance,
      projection: (id: string) => panelInstance.projection(id),
      invoke: (handlerRef: string, call) => panelInstance.runHandler(handlerRef, call),
      projectionsChanged: () => () => {},
      draft: ref(null),
      holdUnsaved: () => () => {},
      t: (key: string) => key,
      resources: async () => {},
      expandPageComposer: async () => {},
      readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
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
    await vi.waitFor(() => expect(panelInstance.projections.value.map((item) => item.slot)).toEqual(["tasks", "summary", "form", "run"]));
    app.unmount();
  });
});
