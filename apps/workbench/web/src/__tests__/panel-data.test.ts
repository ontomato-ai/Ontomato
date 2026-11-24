import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { noOperations, directRun } from "./panel-frame";

/*
 * Direct panel members: official projection components read their declared data through the host's one read port,
 * refresh when bound state or affected object types change or when the panel calls `instance.refreshObjects()`,
 * isolate forbidden/failing projections to their own slot, and `PanelData` members strictly declare non-UI operations
 * invoked via `usePanelOperation`.
 */

const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "", revision: 1 };
const taskSummary: DirectProjection = {
  ...base, id: "task-summary", name: "Task", componentId: "@ontomato/sdk:ObjectSummary",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
};
const taskOperationOnly: DirectProjection = {
  ...base, id: "task-ops", name: "Task ops", componentId: "@ontomato/sdk:PanelData",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: {},
  operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
};
const runNow = { kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: {
    task: { target: { projectionId: taskSummary.id }, inputs: { task: { state: "selectedTask" } } },
    actions: { target: { projectionId: taskOperationOnly.id }, inputs: { task: { state: "selectedTask" } } },
  },
};
const record = (primaryKey: string) => ({ primaryKey, label: `Task ${primaryKey}`, fields: {} });
const chosen = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

afterEach(() => {
  document.body.innerHTML = "";
});

it("reads a member's datum through its projection component when selected, and lists undrawn PanelData operations", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<Projection slot="task" /><p class="status">{{ status }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest,
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      const task = request.inputs.task as { primaryKey: string } | null;
      if (request.operations) return { status: "ready", value: (task ? { runNow } : {}) as never };
      return { status: "ready", value: record(task!.primaryKey) as never };
    },
  });
  const { context } = await module.mountPanel({
    setup() {
      const status = module.usePanelOutput("task", "status");
      return { status };
    },
  });
  const run = await mount;

  // Nothing chosen: the datum waits, unread, and neither member offers an operation yet.
  await vi.waitFor(() => expect(element.querySelector(".status")?.textContent).toBe("awaiting"));
  expect(reads.filter((read) => read.dataName)).toEqual([]);
  expect(context.instance.operations.value).toEqual([]);

  // A choice: the projection reads the record, and both the drawn member and the undrawn PanelData member expose runNow.
  context.instance.state.set("selectedTask", chosen("t-1"));
  await vi.waitFor(() => expect(element.textContent).toContain("Task t-1"));
  await vi.waitFor(() => expect(context.instance.operations.value.map(({ id, label }) => [id, label])).toEqual([
    ["task.runNow", "Run now"], ["actions.runNow", "Run now"],
  ]));
  expect(reads.filter((read) => read.dataName)).toEqual([{ memberPath: [{ member: "task" }], dataName: "record", inputs: { task: chosen("t-1") } }]);

  // Another choice reads again through the platform read port.
  context.instance.state.set("selectedTask", chosen("t-2"));
  await vi.waitFor(() => expect(element.textContent).toContain("Task t-2"));
  expect(reads.filter((read) => read.dataName).every((read) => read.memberPath[0]!.member === "task")).toBe(true);
  run.dispose();
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
    mounted, element, template: `<Projection slot="task" /><Projection slot="hidden"/>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest: twoMembers,
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      failed: (reason) => failed.push(reason),
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => (path.endsWith("/hidden")
      ? Response.json({ error: { message: "Product use Grant required" } }, { status: 403 })
      : Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary })) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> =>
      ({ status: "ready", value: (request.operations ? { runNow } : record("t-1")) as never }),
  });
  await module.mountPanel({ setup: () => ({}) });
  await vi.waitFor(() => expect(element.textContent).toContain("Task t-1"));
  await vi.waitFor(() => expect(element.querySelector('[data-member="hidden"]')?.textContent).toContain(publicEn.platform.dataForbidden));
  expect(failed).toEqual([]);
  (await mount).dispose();
});

it("reads a list and its counts again when an operation reports their type changed", async () => {
  const countsProjection: DirectProjection = {
    ...base, id: "knowledge-counts", name: "Counts", componentId: "@ontomato/sdk:SegmentedControl",
    inputs: {}, outputs: {}, config: {},
    data: { counts: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "counts", params: { by: { literal: "status" } } } },
  };
  const listProjection: DirectProjection = {
    ...base, id: "knowledge-list", name: "Rows", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
  };
  const element = document.createElement("div");
  document.body.append(element);
  const reads: PanelMemberReadRequest[] = [];
  let pending = 7;
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<Projection slot="tabs" /><Projection slot="list" /><p class="rows">{{ loadedCount }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest: definePanel({
      state: {},
      members: {
        tabs: { target: { projectionId: countsProjection.id } },
        list: { target: { projectionId: listProjection.id } },
      },
    }),
    run: directRun({
      pageKey: "board", url: () => "/board", label: () => "Board", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: {
      request: async (path: string) => Response.json({
        projection: path.endsWith(countsProjection.id) ? countsProjection : listProjection,
      }),
    },
    use: { applicationId: "app-board", useId: "board" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
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
      const loadedCount = module.usePanelOutput("list", "loadedCount");
      return { loadedCount };
    },
  });
  const run = await mount;
  await vi.waitFor(() => expect(element.querySelector(".sdk-segmented-count")?.textContent).toBe("7"));
  await vi.waitFor(() => expect(element.querySelector(".rows")?.textContent).toBe("7"));

  // An operation approved four: the owner reports the type changed, and the host hands that to the run.
  pending = 3;
  run.refresh(null, { objects: [], objectTypes: [BUSINESS_KNOWLEDGE] });
  await vi.waitFor(() => expect(element.querySelector(".sdk-segmented-count")?.textContent).toBe("3"));
  await vi.waitFor(() => expect(element.querySelector(".rows")?.textContent).toBe("3"));
  // A change to another type reads nothing of these again.
  const before = reads.filter((read) => read.dataName).length;
  run.refresh(null, { objects: [], objectTypes: ["platform:Other"] });
  await nextTick();
  expect(reads.filter((read) => read.dataName).length).toBe(before);
  run.dispose();
});

it("reads every projection again when the panel calls instance.refreshObjects()", async () => {
  const countsProjection: DirectProjection = {
    ...base, id: "knowledge-counts", name: "Counts", componentId: "@ontomato/sdk:SegmentedControl",
    inputs: {}, outputs: {}, config: {},
    data: { counts: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "counts", params: { by: { literal: "status" } } } },
  };
  const listProjection: DirectProjection = {
    ...base, id: "knowledge-list", name: "Rows", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
  };
  const element = document.createElement("div");
  document.body.append(element);
  let pending = 7;
  let refreshObjects!: () => void;
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<Projection slot="tabs" /><Projection slot="list" /><p class="rows">{{ loadedCount }}</p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest: definePanel({
      state: {},
      members: {
        tabs: { target: { projectionId: countsProjection.id } },
        list: { target: { projectionId: listProjection.id } },
      },
    }),
    run: directRun({
      pageKey: "board", url: () => "/board", label: () => "Board", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: {
      request: async (path: string) => Response.json({
        projection: path.endsWith(countsProjection.id) ? countsProjection : listProjection,
      }),
    },
    use: { applicationId: "app-board", useId: "board" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: {} as never };
      return request.dataName === "counts"
        ? { status: "ready", value: [{ key: "pending", label: "Pending", count: pending }] as never }
        : { status: "ready", value: { rows: Array.from({ length: pending }, (_, index) => record(`k-${index}`)) } as never };
    },
  });
  await module.mountPanel({
    setup() {
      const { instance } = module.usePanelContext();
      refreshObjects = () => instance.refreshObjects();
      const loadedCount = module.usePanelOutput("list", "loadedCount");
      return { loadedCount };
    },
  });
  const run = await mount;
  await vi.waitFor(() => expect(element.querySelector(".sdk-segmented-count")?.textContent).toBe("7"));
  await vi.waitFor(() => expect(element.querySelector(".rows")?.textContent).toBe("7"));

  pending = 3;
  refreshObjects();
  await vi.waitFor(() => expect(element.querySelector(".sdk-segmented-count")?.textContent).toBe("3"));
  await vi.waitFor(() => expect(element.querySelector(".rows")?.textContent).toBe("3"));
  run.dispose();
});

it("runs a PanelData member's non-UI operation via usePanelOperation once its owner admits it", async () => {
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
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string, init?: { body?: unknown }) => {
      if (path === "/panel-operations/intents") {
        intents.push(JSON.parse(String(init!.body)));
        return Response.json({ intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId: "actions.runNow", label: "Run now", confirmation: { kind: "none" } });
      }
      return Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary });
    } },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
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
      handle = module.usePanelOperation("actions", "runNow");
      return { runNow: handle };
    },
  });
  await vi.waitFor(() => expect(element.querySelector(".run")?.textContent).toBe("none"));
  expect(handle.operation.value).toBeNull();

  context.instance.state.set("selectedTask", chosen("t-1"));
  await vi.waitFor(() => expect(element.querySelector(".run")?.textContent).toBe("Run now"));
  await handle.run();
  expect(intents).toEqual([{ applicationId: "app-tasks", useId: "tasks", operationId: "actions.runNow", call: {
    target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, input: {},
  } }]);
  expect(confirmed).toEqual(["5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05"]);
  (await mount).dispose();
  expect(() => module.usePanelOperation("actions", "runNow")).toThrow("Call usePanelOperation in a component's setup");
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
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    nested: noOperations.nested,
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

it("draws a document as the product's Markdown, a file as code, and tells the reader in the platform's message", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<markdown-view :content="doc"></markdown-view><code-editor :model-value="code" language="javascript" readonly></code-editor>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate, nested: noOperations.nested,
    read: async (): Promise<ProductPanelReadResponse> => ({ status: "ready", value: {} as never }),
  });
  const { context } = await module.mountPanel({ setup: () => ({ doc: "# Review\n\nChecks **every** change.", code: "export const answer = 42;" }) });
  await vi.waitFor(() => expect(element.querySelector("h1")?.textContent).toBe("Review"));
  expect(element.querySelector("strong")?.textContent).toBe("every");
  await vi.waitFor(() => expect(element.querySelector(".cm-content")?.textContent).toBe("export const answer = 42;"));
  expect(element.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  context.notify({ kind: "success", text: "Exported" });
  await vi.waitFor(() => expect(document.querySelector(".el-message--success")?.textContent).toContain("Exported"));
  (await mount).dispose();
});

it("shows a read the platform could not answer as the projection's failure, with the platform's reason", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element, template: `<Projection slot="task" />`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest,
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.endsWith(taskOperationOnly.id) ? taskOperationOnly : taskSummary }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate, nested: noOperations.nested,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: {} as never };
      throw new Error("Service unavailable");
    },
  });
  await module.mountPanel({ setup: () => ({}) });
  await vi.waitFor(() => expect(element.textContent).toContain("Service unavailable"));
  (await mount).dispose();
});

it("recovers a failed projection load when retried in place", async () => {
  let shouldFail = true;
  let attempts = 0;
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<Projection slot="task" />`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus); },
    manifest: {
      state: manifest.state,
      members: { task: manifest.members.task! },
    },
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: chosen("t-1") },
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: {
      request: async () => {
        attempts += 1;
        if (shouldFail) throw new Error("Projection store temporarily unreachable");
        return Response.json({ projection: taskSummary });
      },
    },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate, nested: noOperations.nested,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: {} as never };
      return { status: "ready", value: record("t-1") as never };
    },
  });
  await module.mountPanel({ setup: () => ({}) });
  await vi.waitFor(() => expect(element.textContent).toContain("Projection store temporarily unreachable"));
  shouldFail = false;
  const retry = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === publicEn.common.retry)!;
  retry.click();
  await vi.waitFor(() => expect(element.textContent).toContain("Task t-1"));
  expect(attempts).toBe(2);
  (await mount).dispose();
});
