import { afterEach, expect, it, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { noOperations } from "./panel-frame";

/*
 * Data a panel's own code draws (big main's ruling, 2026-11-20): a member whose projection is a `PanelData` one is never
 * placed; the panel's code reads its datum with `usePanelData` and draws it its own way, and runs its operation with
 * `instance.invoke`. The datum is read the way every member's is — through the run's one read port, waiting while the
 * object it is read from is not chosen, read again when the panel state the member binds changes — and the member's
 * operations are listed whether or not anything draws it.
 *
 * What this rules out: a read the page's code makes of its own; a datum read for nothing chosen, or not read again when
 * the choice changes; a member's operation missing from what the panel offers because nothing draws or reads it; a datum the projection does not
 * declare read anyway.
 */

const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "", revision: 1 };
const taskData: DirectProjection = {
  ...base, id: "task-data", name: "Task", componentId: "@ontomato/sdk:PanelData",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
};
const runNow = { kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: {
    task: { target: { projectionId: taskData.id }, inputs: { task: { state: "selectedTask" } } },
    // A member the panel's code neither reads nor draws: its own buttons run its operation.
    actions: { target: { projectionId: taskData.id }, inputs: { task: { state: "selectedTask" } } },
  },
  events: {},
};
const record = (primaryKey: string) => ({ primaryKey, label: `Task ${primaryKey}`, fields: {} });
const chosen = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

afterEach(() => {
  document.body.innerHTML = "";
});

it("reads a member's datum for the panel's own code, as its projection declares, and lists its operations undrawn", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<p class="task">{{ shown }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskData }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      const task = request.inputs.task as { primaryKey: string } | null;
      if (request.operations) return { status: "ready", value: (task ? { runNow } : {}) as never };
      return { status: "ready", value: record(task!.primaryKey) as never };
    },
  });
  // The panel's own code: the chosen task's record, drawn its own way.
  const { context } = await module.mountPanel({
    setup() {
      const task = module.usePanelData("task", "record");
      return { shown: computed(() => (task.value.status === "ready" ? (task.value.value as { label: string }).label : task.value.status)) };
    },
  });
  const run = await mount;

  // Nothing chosen: the datum waits, unread, and the member offers no operation yet.
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("awaiting"));
  expect(reads.filter((read) => read.dataName)).toEqual([]);
  expect(context.instance.operations.value).toEqual([]);

  // A choice: the datum is read for it, and the member's run-now is offered, though nothing draws the member.
  context.instance.state.set("selectedTask", chosen("t-1"));
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("Task t-1"));
  await vi.waitFor(() => expect(context.instance.operations.value.map(({ id, label }) => [id, label])).toEqual([
    ["task.runNow", "Run now"], ["actions.runNow", "Run now"],
  ]));
  expect(reads.filter((read) => read.dataName)).toEqual([{ memberPath: [{ member: "task" }], dataName: "record", inputs: { task: chosen("t-1") } }]);

  // Another choice is read again; the page's code sent no request of its own.
  context.instance.state.set("selectedTask", chosen("t-2"));
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("Task t-2"));
  expect(reads.filter((read) => read.dataName).every((read) => read.memberPath[0]!.member === "task")).toBe(true);
  run.dispose();
});

it("says so when the projection declares no such datum", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<p class="task">{{ shown }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskData }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> =>
      ({ status: "ready", value: (request.operations ? {} : record("t-1")) as never }),
  });
  await module.mountPanel({
    setup() {
      const rows = module.usePanelData("task", "rows");
      return { shown: computed(() => (rows.value.status === "error" ? rows.value.message : rows.value.status)) };
    },
  });
  await nextTick();
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("The projection of member 'task' declares no datum 'rows'"));
  (await mount).dispose();
});

it("keeps a member whose projection cannot be read to itself: the rest of the panel goes on", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const failed: unknown[] = [];
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const twoMembers: DirectPanelManifest = {
    ...manifest,
    members: { ...manifest.members, hidden: { target: { projectionId: "hidden" }, inputs: { task: { state: "selectedTask" } } } },
  };
  const module = panelModuleFor({
    mounted, element, template: `<p class="task">{{ shown }}</p><Projection slot="hidden"/>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest: twoMembers,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => failed.push(reason),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    // The reader may not use the hidden member's projection; the platform says so.
    requests: { request: async (path: string) => (path.endsWith("/hidden")
      ? Response.json({ error: { message: "Product use Grant required" } }, { status: 403 })
      : Response.json({ projection: taskData })) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> =>
      ({ status: "ready", value: (request.operations ? { runNow } : record("t-1")) as never }),
  });
  await module.mountPanel({
    setup() {
      const task = module.usePanelData("task", "record");
      return { shown: computed(() => (task.value.status === "ready" ? (task.value.value as { label: string }).label : task.value.status)) };
    },
  });
  // The readable member reads and is shown; the other says why where it is placed; the panel itself has not failed.
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("Task t-1"));
  await vi.waitFor(() => expect(element.querySelector('[data-member="hidden"]')?.textContent).toContain("Product use Grant required"));
  expect(failed).toEqual([]);
  (await mount).dispose();
});

it("says where to call it when it is called outside a component's setup", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const module = panelModuleFor({
    mounted: () => {}, element, template: "<p></p>",
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskData }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: noOperations.confirmOperation,
    read: async (): Promise<ProductPanelReadResponse> => ({ status: "ready", value: {} as never }),
  });
  // At a module's top level (or after an await in setup), not in a panel's frame: the reason names the call's place.
  expect(() => module.usePanelData("task", "record")).toThrow("Call usePanelData in a component's setup, before any await");
});

it("reads a list and its counts again when an operation reports their type changed", async () => {
  const counted: DirectProjection = {
    ...base, id: "knowledge", name: "Knowledge", componentId: "@ontomato/sdk:PanelData",
    inputs: {}, outputs: {}, config: {},
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} },
      counts: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "counts", params: { by: { literal: "status" } } },
    },
  };
  const element = document.createElement("div");
  document.body.append(element);
  const reads: PanelMemberReadRequest[] = [];
  let pending = 7;
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<p class="counts">{{ pendingCount }}</p><p class="rows">{{ rowCount }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest: definePanel({ state: {}, members: { board: { target: { projectionId: counted.id } } }, events: {} }),
    run: {
      pageKey: "board", url: () => "/board", label: () => "Board", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: counted }) },
    use: { applicationId: "app-board", useId: "board" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      if (request.operations) return { status: "ready", value: {} as never };
      return request.dataName === "counts"
        ? { status: "ready", value: [{ key: "pending", label: "Pending", count: pending }] as never }
        : { status: "ready", value: { rows: Array.from({ length: pending }, (_, index) => record(`k-${index}`)) } as never };
    },
  });
  await module.mountPanel({
    setup() {
      const counts = module.usePanelData("board", "counts");
      const rows = module.usePanelData("board", "rows");
      return {
        pendingCount: computed(() => (counts.value.status === "ready" ? (counts.value.value as { count: number }[])[0]!.count : "…")),
        rowCount: computed(() => (rows.value.status === "ready" ? (rows.value.value as { rows: unknown[] }).rows.length : "…")),
      };
    },
  });
  const run = await mount;
  await vi.waitFor(() => expect(element.querySelector(".counts")?.textContent).toBe("7"));

  // An operation approved four: the owner reports the type changed, and the host hands that to the run.
  pending = 3;
  run.refresh(null, { objects: [], objectTypes: [BUSINESS_KNOWLEDGE] });
  await vi.waitFor(() => expect(element.querySelector(".counts")?.textContent).toBe("3"));
  await vi.waitFor(() => expect(element.querySelector(".rows")?.textContent).toBe("3"));
  // A change to another type reads nothing of these again.
  const before = reads.filter((read) => read.dataName).length;
  run.refresh(null, { objects: [], objectTypes: ["platform:Other"] });
  await nextTick();
  expect(reads.filter((read) => read.dataName).length).toBe(before);
  run.dispose();
});

it("runs a member's operation from the panel's own code, found by the member and its name, once its owner admits it", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const intents: unknown[] = [];
  const confirmed: string[] = [];
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<button class="run" :disabled="!runNow.operation.value">{{ runNow.operation.value?.label ?? "none" }}</button>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string, init?: { body?: unknown }) => {
      if (path === "/panel-operations/intents") {
        intents.push(JSON.parse(String(init!.body)));
        return Response.json({ intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId: "task.runNow", label: "Run now", confirmation: { kind: "none" } });
      }
      return Response.json({ projection: taskData });
    } },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, placement: noOperations.placement,
    confirmOperation: async ({ intentId }) => {
      confirmed.push(intentId);
      return { decision: "confirm", response: { kind: "dispatched", intentId, outcome: { kind: "success", data: {} } } };
    },
    read: async (request): Promise<ProductPanelReadResponse> => {
      const task = request.inputs.task as { primaryKey: string } | null;
      if (request.operations) return { status: "ready", value: (task ? { runNow } : {}) as never };
      return { status: "ready", value: record(task!.primaryKey) as never };
    },
  });
  let handle!: ReturnType<typeof module.usePanelOperation>;
  const { context } = await module.mountPanel({
    setup() {
      handle = module.usePanelOperation("task", "runNow");
      return { runNow: handle };
    },
  });
  // Nothing chosen: the owner admits nothing, and the page shows it cannot run.
  await vi.waitFor(() => expect(element.querySelector(".run")?.textContent).toBe("none"));
  expect(handle.operation.value).toBeNull();

  context.instance.state.set("selectedTask", chosen("t-1"));
  await vi.waitFor(() => expect(element.querySelector(".run")?.textContent).toBe("Run now"));
  await handle.run();
  // It ran as the header's does: one intent for the chosen task, confirmed by the host.
  expect(intents).toEqual([{ applicationId: "app-tasks", useId: "tasks", operationId: "task.runNow", call: {
    target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, input: {},
  } }]);
  expect(confirmed).toEqual(["5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05"]);
  (await mount).dispose();
  expect(() => module.usePanelOperation("task", "runNow")).toThrow("Call usePanelOperation in a component's setup");
});

it("opens a platform address from the panel's own code through the host, and hears why it could not", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const opened: string[] = [];
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: "<p></p>",
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskData }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    placement: "page",
    // The host opens what it can, and says why it cannot otherwise.
    navigate: async (address) => {
      opened.push(address);
      if (address.startsWith("/missing")) throw new Error(`This address is not a page you can open: ${address}`);
    },
    read: async (): Promise<ProductPanelReadResponse> => ({ status: "ready", value: {} as never }),
  });
  const { context } = await module.mountPanel({ setup: () => ({}) });
  await context.navigate("/agents/chat?agentId=agent-knowledge-governance");
  await expect(context.navigate("/missing")).rejects.toThrow("This address is not a page you can open: /missing");
  expect(opened).toEqual(["/agents/chat?agentId=agent-knowledge-governance", "/missing"]);
  (await mount).dispose();
});

it("tells the panel's code where the platform shows it, beside a conversation or at its own address", async () => {
  async function placed(placement: "conversation" | "page") {
    const element = document.createElement("div");
    document.body.append(element);
    let mounted!: (mount: DirectPanelMount) => void;
    const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
    const module = panelModuleFor({
      mounted, element, template: `<h1 v-if="placement === 'page'">Report</h1><p>Body</p>`,
      install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
      manifest,
      run: {
        pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
        state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
        failed: (reason) => { throw reason; },
      },
      messages: {}, locale: ref("en"), defaultLocale: "en",
      requests: { request: async () => Response.json({ projection: taskData }) },
      use: { applicationId: "app-tasks", useId: "tasks" },
      expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
      navigate: noOperations.navigate, placement,
      read: async (): Promise<ProductPanelReadResponse> => ({ status: "ready", value: {} as never }),
    });
    const { context } = await module.mountPanel({ setup: () => ({ placement: module.usePanelContext().placement }) });
    await nextTick();
    const seen = { value: context.placement.value, title: element.querySelector("h1") !== null };
    (await mount).dispose();
    return seen;
  }
  // Beside a conversation the conversation draws the title and the way back; at its own address the panel does.
  expect(await placed("conversation")).toEqual({ value: "conversation", title: false });
  expect(await placed("page")).toEqual({ value: "page", title: true });
});

it("shows a read the platform could not answer as the datum's failure, with the platform's reason", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<p class="task">{{ shown }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskData }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate, placement: noOperations.placement,
    // The platform's read entry is unavailable: the port rejects rather than answering one of the four states.
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: {} as never };
      throw new Error("Service unavailable");
    },
  });
  await module.mountPanel({
    setup() {
      const task = module.usePanelData("task", "record");
      return { shown: computed(() => (task.value.status === "error" ? `error: ${task.value.message}` : task.value.status)) };
    },
  });
  await vi.waitFor(() => expect(element.querySelector(".task")?.textContent).toBe("error: Service unavailable"));
  (await mount).dispose();
});
