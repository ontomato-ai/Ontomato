import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { definePanel, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { createPanelInstance, applyPanelRequest } from "../../../../../packages/apps-sdk/src/panel/instance";
import { PanelFormAdapters, receivePanelDraft, type ReceivedPanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { registerHandler, handlerFor, registeredHandlers } from "../../../../../packages/apps-sdk/src/panel/handlers";
import { componentFor } from "../../../../../packages/apps-sdk/src/catalogue-components";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";

/*
 * A panel declares its state and places its projections, and the SDK does the rest: it reads each projection by ID,
 * draws the component the catalogue names, derives the projection's ports from the record and the catalogue, and runs an
 * operation through the handler reference the catalogue registered. These are the mistakes that would send the work back
 * to hand-written wiring: a panel that has to pass a projection's ports itself, a projection whose record is never read
 * (so changing it changes nothing), and an operation whose button reaches a handler of the panel's own.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";

/** The panel of the trial scenario: a task list, the task's form, and a button that runs the selected task now. */
const panel = definePanel({
  state: {
    selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true },
    application: { kind: "object", objectType: "platform:Application", deepLink: false },
    search: { kind: "scalar", type: "string", deepLink: false },
  },
  slots: {
    tasks: { projectionId: "projection-x", inputs: {} },
    taskForm: { projectionId: "projection-task-form", inputs: { task: { state: "selectedTask" } } },
    runTask: { projectionId: "projection-run-task", inputs: { task: { state: "selectedTask" } } },
  },
  operations: [{ id: "task.clear", label: "Clear", kind: "state", sets: { selectedTask: null } }],
});

/** The panel's own registered definition: what the host read and the frame was handed. */
const registered: ProductPanel = {
  id: "panel-schedules",
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
  editable: false,
  name: "Scheduled tasks",
  description: "",
  visibility: "domain",
  content: { html: '<div id="app"></div>', module: 'import {mountPanel} from "@ontomato/sdk/panel";' },
  manifest: panel,
};

/** The records the platform holds, as the frame reads them by ID. */
function record(id: string, componentId: string, binding: ProductProjection["binding"]): ProductProjection {
  return {
    id,
    domainId: "domain-1",
    ownerId: "owner-1",
    revision: 1,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    editable: false,
    name: id,
    description: "",
    visibility: "domain",
    componentId,
    binding,
    inputs: componentId === "FormFields" ? { task: { kind: "object", objectType: SCHEDULED_TASK } } : {},
    display: {},
  };
}

const records = new Map<string, ProductProjection>([
  ["projection-x", record("projection-x", "MarkdownView", { kind: "PlatformObjectType", id: SCHEDULED_TASK })],
  ["projection-task-form", record("projection-task-form", "FormFields", { kind: "PlatformOperation", id: "schedules.update" })],
  ["projection-run-task", record("projection-run-task", "MarkdownView", { kind: "PlatformOperation", id: "schedules.runNow" })],
]);

function instance(initial?: Record<string, unknown>) {
  return createPanelInstance(panel, {
    pageKey: "schedules",
    url: () => "/a/schedules",
    label: () => "Scheduled tasks",
    initial: initial as never,
    readProjection: async (id) => records.get(id)!,
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

  it("takes a projection's ports from its record alone, with no panel-written port", async () => {
    const panelInstance = instance({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } });
    // The list binds a read-only platform object and publishes no operation: the catalogue's entry for the component
    // says so, and the panel says nothing about it.
    expect(portsOf(await panelInstance.projection("projection-x"))).toEqual({
      binding: `PlatformObjectType:${SCHEDULED_TASK}`,
      inputs: {},
      operations: [],
    });
    // A record bound to a platform operation publishes that operation: its handler is the reference the record names,
    // and the panel says nothing about it either.
    const form = portsOf(await panelInstance.projection("projection-task-form"));
    expect(form.binding).toBe("PlatformOperation:schedules.update");
    expect(form.operations.map((operation) => operation.handlerRef)).toEqual(["schedules.update"]);
  });

  it("draws the component the catalogue names, and refuses one this version has not got", async () => {
    // A component is fetched the first time a projection names it, and the same one twice is one fetch.
    expect(await componentFor("MarkdownView")).not.toBe(await componentFor("FormFields"));
    expect(await componentFor("MarkdownView")).toBe(await componentFor("MarkdownView"));
    await expect(componentFor("NoSuchComponent")).rejects.toThrow(/no component 'NoSuchComponent'/);
  });

  it("runs an operation through the handler reference the catalogue registered, not one of the panel's own", async () => {
    const run = vi.fn(async () => ({ id: "run-1" }));
    registerHandler({ handlerRef: "schedules.runNow", invoke: run });
    expect(registeredHandlers()).toContain("schedules.runNow");
    const panelInstance = instance();
    const ports = { binding: "PlatformOperation:schedules.runNow", inputs: {}, operations: [
      { name: "runNow", label: "Run now", kind: "action" as const, inputSchema: {}, handlerRef: "schedules.runNow" },
    ] };
    panelInstance.register({
      slot: "runTask",
      projectionId: "projection-run-task",
      ports,
      invoke: (handlerRef, call) => panelInstance.runHandler(handlerRef, call),
    });
    const [operation] = panelInstance.operations.value.filter((candidate) => candidate.slot === "runTask");
    await panelInstance.invoke(operation!.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(handlerFor("schedules.runNow")).toBeDefined();
  });

  it("takes a draft of its own form, comparing it with the owner's reading", async () => {
    const adapters = new PanelFormAdapters();
    const prepareDraft = vi.fn(async () => ({ baseline: { title: "Nightly", application: "reports" }, apply: () => {} }));
    adapters.register("taskForm", {
      operation: "schedules.update",
      prepareDraft,
      save: async () => ({ id: "task-1" }),
      // This test only checks which slot takes the draft and which fields it changed; the form's own save and the
      // showing of the draft are the component's, checked in its own test.
      submit: async () => ({}),
    });
    const received = await new Promise<ReceivedPanelDraft<Record<string, unknown>>>((taken) =>
      void receivePanelDraft(
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
        taken,
      ),
    );
    expect(received.slot).toBe("taskForm");
    expect([...received.changed]).toEqual(["title"]);
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
      return records.get(id)!;
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
    });
    app.mount(element);
    await nextTick();
    await vi.waitFor(() => expect(reads).toHaveLength(3));
    // Every slot's projection was read by its own ID: the panel named them, and the SDK is what read them.
    expect(reads).toEqual(["projection-x", "projection-task-form", "projection-run-task"]);
    app.unmount();
  });
});
