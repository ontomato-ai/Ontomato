/* eslint-disable vue/one-component-per-file */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type {
  PanelOwnerOperationDescriptor,
  PanelReadOperationResult,
} from "@ontomato/contracts/panel-operations";
import { BUSINESS_KNOWLEDGE, SKILL } from "@ontomato/contracts/platform-object-types";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import { createDirectPanelInstance, directPanelContext, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import OperationResult from "../../../../../packages/apps-sdk/src/base/OperationResult.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import {
  localDraftStoreKey,
  objectDraftKey,
  objectDraftPrefix,
  type PanelLocalDraftRecord,
  type PanelLocalDraftStore,
} from "../../../../../packages/apps-sdk/src/panel/local-drafts";
import { noOperations } from "./panel-frame";

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const readyRows = (rows: readonly Record<string, unknown>[]): ProductPanelReadResponse =>
  ready({ rows, total: rows.length });

function makeInMemoryDraftStore(): PanelLocalDraftStore {
  const entries = new Map<string, PanelLocalDraftRecord>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, record) => {
      entries.set(key, record);
      notify();
    },
    remove: (key) => {
      if (entries.delete(key)) notify();
    },
    has: (key) => entries.has(key),
    hasObject: (objectType, primaryKey) => {
      const prefix = objectDraftPrefix(objectType, primaryKey);
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    messages?: Record<string, Record<string, string>>;
    memberProps?: Record<string, Record<string, unknown>>;
    memberSlots?: Record<string, Record<string, (...args: any[]) => any>>;
    draftStore?: PanelLocalDraftStore;
    operations?: Partial<typeof noOperations.operations>;
    confirmOperation?: typeof noOperations.confirmOperation;
  } = {},
) {
  const reads: PanelMemberReadRequest[] = [];
  const mergedOperations = {
    ...noOperations.operations,
    ...(options.operations ?? {}),
  };
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "group-a-test",
    url: () => "/panels/group-a",
    label: () => "Group A test",
    initial: options.initial as never,
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    operations: mergedOperations,
    ...(options.confirmOperation ? { confirmOperation: options.confirmOperation } : {}),
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const memberKeys = Object.keys(manifest.members);
  const app = createApp(defineComponent({
    setup() {
      if (options.draftStore) provide(localDraftStoreKey, options.draftStore);
      return () => h("div", memberKeys.map((member) => h(
        PanelMember,
        {
          instance,
          member,
          key: member,
          ...(options.memberProps?.[member] ?? {}),
        },
        options.memberSlots?.[member],
      )));
    },
  }));
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } as never }));
  app.use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element, reads };
}

describe("D1-3: ObjectTree & PathTree directoryIndexFile", () => {
  const treeProjection: DirectProjection = {
    ...meta,
    id: "tree.files",
    name: "Skill files",
    componentId: "@ontomato/sdk:ObjectTree",
    inputs: { skill: { kind: "object", objectType: SKILL } },
    outputs: { selected: { kind: "scalar", type: "string" } },
    config: {
      directoryIndexFile: "index.md",
    },
    data: {
      files: {
        source: { object: { input: "skill" } },
        read: "files",
        params: {},
      },
    },
  };

  const treeManifest: DirectPanelManifest = definePanel({
    state: {
      skill: { type: { kind: "object", objectType: SKILL } },
      selected: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      tree: {
        target: { projectionId: "tree.files" },
        inputs: { skill: { state: "skill" } },
        outputs: { selected: { state: "selected" } },
      },
    },
  });

  const fileRows = [
    { primaryKey: "guide/index.md", label: "index.md", fields: { path: "guide/index.md" } },
    { primaryKey: "guide/setup.md", label: "setup.md", fields: { path: "guide/setup.md" } },
    { primaryKey: "notes/todo.md", label: "todo.md", fields: { path: "notes/todo.md" } },
  ];

  it("opens a folder's index file when present and clears selection when clicking a folder without an index file", async () => {
    const { instance, element } = mountDirect(
      treeManifest,
      { "tree.files": treeProjection },
      (req) => ("dataName" in req && req.dataName === "files" ? ready(fileRows) : ready({})),
      { initial: { skill: { className: SKILL, primaryKey: "sk-1" }, selected: "guide/setup.md" } },
    );

    await vi.waitFor(() => {
      expect(element.querySelectorAll('[role="treeitem"]').length).toBeGreaterThanOrEqual(5);
    });

    const guideItem = element.querySelector<HTMLElement>('[data-path="guide"]');
    const guideBtn = element.querySelector<HTMLButtonElement>('[data-path="guide"] > button');
    const notesItem = element.querySelector<HTMLElement>('[data-path="notes"]');
    const notesBtn = element.querySelector<HTMLButtonElement>('[data-path="notes"] > button');
    expect(guideBtn).toBeTruthy();
    expect(notesBtn).toBeTruthy();

    // Clicking folder with direct child index.md selects guide/index.md and keeps folder expanded.
    guideBtn!.click();
    await nextTick();
    expect(instance.state.values.value.selected).toBe("guide/index.md");
    expect(guideItem!.getAttribute("aria-expanded")).toBe("true");

    // Clicking folder without index.md toggles folder and clears selection.
    notesBtn!.click();
    await nextTick();
    expect(instance.state.values.value.selected).toBeNull();
    expect(notesItem!.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Gap 5 + Gap 2 + D2-1 + D3-4: ObjectList", () => {
  const listRows = [
    { primaryKey: "k-1", label: "Alpha", fields: { title: "Alpha", status: "passed" } },
    { primaryKey: "k-2", label: "Beta", fields: { title: "Beta", status: "failed" } },
    { primaryKey: "k-3", label: "Gamma", fields: { title: "Gamma", status: "warning" } },
    { primaryKey: "k-4", label: "Delta", fields: { title: "Delta", status: "pending" } },
  ];

  const baseListProjection: DirectProjection = {
    ...meta,
    id: "list.items",
    name: "Knowledge list",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
    },
    outputs: {
      selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
    },
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "query",
        params: {},
      },
    },
    operations: {
      inspect: {
        operation: { kind: "PlatformOperation", id: `${BUSINESS_KNOWLEDGE}.inspect` },
        target: { row: true },
      },
      createByName: {
        operation: { kind: "PlatformOperation", id: `${BUSINESS_KNOWLEDGE}.createByName` },
      },
    },
  };

  const baseManifest: DirectPanelManifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    },
    members: {
      list: {
        target: { projectionId: "list.items" },
        inputs: { selected: { state: "selected" } },
        outputs: { selected: { state: "selected" } },
      },
    },
  });

  it("supports rowExpandMode='multiple' with concurrent row details and independent per-row collapse()", async () => {
    const { element } = mountDirect(
      baseManifest,
      { "list.items": baseListProjection },
      (req) => ("operations" in req && req.operations ? ready({}) : readyRows(listRows)),
      {
        memberProps: {
          list: {
            layout: "table",
            columns: [{ key: "title" }],
            rowExpandMode: "multiple",
          },
        },
        memberSlots: {
          list: {
            "row-detail": (scope: { ref: { primaryKey: string }; collapse: () => void }) =>
              h("div", { class: "custom-detail", "data-pk": scope.ref.primaryKey }, [
                h("span", `Detail ${scope.ref.primaryKey}`),
                h("button", { type: "button", class: "collapse-btn", onClick: scope.collapse }, "Close"),
              ]),
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(4);
      expect(element.querySelectorAll(".sdk-object-list-expand-btn").length).toBe(4);
    });

    const expandBtns = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn");
    expandBtns[0]!.click();
    await nextTick();
    expandBtns[1]!.click();
    await nextTick();

    const details = Array.from(element.querySelectorAll<HTMLElement>(".custom-detail")).map((el) => el.dataset.pk);
    expect(details).toEqual(["k-1", "k-2"]);

    // Collapsing k-1 leaves k-2 open.
    const k1Close = element.querySelector<HTMLButtonElement>(".custom-detail[data-pk='k-1'] .collapse-btn");
    expect(k1Close).toBeTruthy();
    k1Close!.click();
    await nextTick();

    const remaining = Array.from(element.querySelectorAll<HTMLElement>(".custom-detail")).map((el) => el.dataset.pk);
    expect(remaining).toEqual(["k-2"]);
  });

  it("isolates per-row operation results & busy state and auto-expands with close button when rowResultDisplay='expand'", async () => {
    const inspectDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: `${BUSINESS_KNOWLEDGE}.inspect`,
      label: "Inspect",
      effect: "read",
      target: { source: "row" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    };

    const resolvers = new Map<string, (res: PanelReadOperationResult) => void>();
    const readOp = vi.fn((_opId: string, call: { target?: { primaryKey?: string } | null }) => {
      const pk = call.target?.primaryKey ?? "";
      return new Promise<PanelReadOperationResult>((resolve) => {
        resolvers.set(pk, resolve);
      });
    });

    const { element } = mountDirect(
      baseManifest,
      { "list.items": baseListProjection },
      (req) => {
        if ("operations" in req && req.operations) {
          return ready({ inspect: inspectDescriptor });
        }
        return readyRows(listRows.slice(0, 2));
      },
      {
        operations: {
          read: readOp as never,
        },
        memberProps: {
          list: {
            layout: "table",
            columns: [{ key: "title" }],
            rowExpandMode: "multiple",
            rowResultDisplay: "expand",
            rowActions: {
              items: [{ kind: "operation", operation: "inspect", labelKey: "Inspect" }],
            },
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(2);
      expect(element.querySelectorAll(".sdk-object-list-action-btn").length).toBe(2);
    });

    const actionButtons = () => Array.from(element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-action-btn"));
    // Start inspect on row 1 (k-1) — row 2's button must remain enabled.
    actionButtons()[0]!.click();
    await nextTick();
    expect(actionButtons()[0]!.disabled).toBe(true);
    expect(actionButtons()[1]!.disabled).toBe(false);

    // Start inspect on row 2 (k-2) concurrently.
    actionButtons()[1]!.click();
    await nextTick();
    expect(actionButtons()[1]!.disabled).toBe(true);

    // Resolve both rows with distinct results.
    resolvers.get("k-1")?.({ kind: "markdown", markdown: "Result for Alpha" });
    resolvers.get("k-2")?.({ kind: "markdown", markdown: "Result for Beta" });

    await vi.waitFor(() => {
      const panels = element.querySelectorAll(".sdk-object-list-row-result-panel");
      expect(panels.length).toBe(2);
      expect(element.textContent).toContain("Result for Alpha");
      expect(element.textContent).toContain("Result for Beta");
    });

    // Close row 1 result — row 2 result stays visible.
    const closeButtons = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-row-result-close");
    expect(closeButtons.length).toBe(2);
    expect(closeButtons[0]!.textContent?.trim()).toBe(publicEn.platform.listRowResultClose);
    closeButtons[0]!.click();
    await nextTick();

    expect(element.querySelectorAll(".sdk-object-list-row-result-panel").length).toBe(1);
    expect(element.textContent).not.toContain("Result for Alpha");
    expect(element.textContent).toContain("Result for Beta");
  });

  it("renders reactive 6px draft indicator dot when showDraftIndicator is enabled", async () => {
    const draftStore = makeInMemoryDraftStore();
    draftStore.write(objectDraftKey(BUSINESS_KNOWLEDGE, "k-1", "edit"), {
      values: { title: "Alpha edited" },
      baselineHash: "h1",
      updatedAt: Date.now(),
    });

    const { element } = mountDirect(
      baseManifest,
      { "list.items": baseListProjection },
      (req) => ("operations" in req && req.operations ? ready({}) : readyRows(listRows.slice(0, 2))),
      {
        draftStore,
        memberProps: {
          list: {
            layout: "table",
            columns: [{ key: "title" }],
            showDraftIndicator: true,
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(element.querySelectorAll(".sdk-object-list-draft-dot").length).toBe(1);
    });
    const dot = element.querySelector<HTMLElement>(".sdk-object-list-draft-dot");
    expect(dot?.getAttribute("title")).toBe(publicEn.platform.formDraftIndicator);

    // Writing a draft for k-2 adds a second dot reactively; removing k-1 removes its dot.
    draftStore.write(objectDraftKey(BUSINESS_KNOWLEDGE, "k-2", "edit"), {
      values: { title: "Beta edited" },
      baselineHash: "h2",
      updatedAt: Date.now(),
    });
    await nextTick();
    expect(element.querySelectorAll(".sdk-object-list-draft-dot").length).toBe(2);

    draftStore.remove(objectDraftKey(BUSINESS_KNOWLEDGE, "k-1", "edit"));
    await nextTick();
    expect(element.querySelectorAll(".sdk-object-list-draft-dot").length).toBe(1);
  });

  it("applies semantic row tone classes via rowToneField and rowToneMap (D3-4)", async () => {
    const { element } = mountDirect(
      baseManifest,
      { "list.items": baseListProjection },
      (req) => ("operations" in req && req.operations ? ready({}) : readyRows(listRows)),
      {
        memberProps: {
          list: {
            layout: "table",
            columns: [{ key: "title" }, { key: "status" }],
            rowToneField: "status",
            rowToneMap: {
              passed: "success",
              failed: "danger",
              warning: "warning",
              pending: "info",
            },
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(4);
    });

    const rows = Array.from(element.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']"));
    expect(rows[0]!.classList.contains("is-tone-success")).toBe(true);
    expect(rows[1]!.classList.contains("is-tone-danger")).toBe(true);
    expect(rows[2]!.classList.contains("is-tone-warning")).toBe(true);
    expect(rows[3]!.classList.contains("is-tone-info")).toBe(true);
  });

  it("handles searchSubmit on Enter: selects loaded primaryKey match or invokes operation on miss (D2-1)", async () => {
    const createDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: `${BUSINESS_KNOWLEDGE}.createByName`,
      label: "Create",
      effect: "write",
      target: { source: "none" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    };

    const prepare = vi.fn(async (_opId: string, invocation: { call?: { input?: Record<string, unknown> } }) => ({
      intentId: "intent-1",
      preview: { summary: "Create item" },
      confirmation: { kind: "none" as const },
      invocation,
    }));
    const confirmOperation = vi.fn(async (): Promise<{
      decision: "confirm";
      response: PanelHumanOperationDispatchResponse;
    }> => ({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId: "intent-1",
        outcome: {
          kind: "success",
          data: {},
          created: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-new" },
        },
      },
    }));

    const { instance, element } = mountDirect(
      baseManifest,
      { "list.items": baseListProjection },
      (req) => {
        if ("operations" in req && req.operations) {
          return ready({ createByName: createDescriptor });
        }
        return readyRows(listRows.slice(0, 2));
      },
      {
        operations: {
          prepare: prepare as never,
        },
        confirmOperation: confirmOperation as never,
        memberProps: {
          list: {
            layout: "table",
            columns: [{ key: "title" }],
            searchable: true,
            searchSubmit: { operation: "createByName", inputField: "name" },
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(element.querySelector("input.sdk-object-list-search")).not.toBeNull();
      expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(2);
    });

    const input = element.querySelector<HTMLInputElement>("input.sdk-object-list-search")!;
    // 1. Exact primaryKey hit selects k-2 directly and clears search without invoking operation.
    input.value = "k-2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();

    expect(instance.state.values.value.selected).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-2" });
    expect(input.value).toBe("");
    expect(prepare).not.toHaveBeenCalled();

    // 2. Miss invokes operations.createByName with { name: "k-new" }, clears search, and selects created object.
    input.value = "k-new";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(confirmOperation).toHaveBeenCalledTimes(1);
      expect(input.value).toBe("");
      expect(instance.state.values.value.selected).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-new" });
    });
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({ call: { input: { name: "k-new" } } });
  });
});

describe("Gap 2 + fallbackToFirst: ReferencePicker", () => {
  const pickerProjection: DirectProjection = {
    ...meta,
    id: "picker.rows",
    name: "Knowledge picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "query",
        params: {},
      },
    },
  };

  const pickerManifest: DirectPanelManifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    },
    members: {
      picker: {
        target: { projectionId: "picker.rows" },
        inputs: { selected: { state: "selected" } },
        outputs: { selected: { state: "selected" } },
      },
    },
  });

  const rows = [
    { primaryKey: "ref-1", label: "First Ref", fields: {} },
    { primaryKey: "ref-2", label: "Second Ref", fields: {} },
  ];

  it("auto-selects first option on load with fallbackToFirst and renders reactive draft dot", async () => {
    const draftStore = makeInMemoryDraftStore();
    draftStore.write(objectDraftKey(BUSINESS_KNOWLEDGE, "ref-1", "edit"), {
      values: { title: "Drafted" },
      baselineHash: "h1",
      updatedAt: Date.now(),
    });

    const { instance, element } = mountDirect(
      pickerManifest,
      { "picker.rows": pickerProjection },
      () => readyRows(rows),
      {
        draftStore,
        initial: { selected: { className: BUSINESS_KNOWLEDGE, primaryKey: "missing-ref" } },
        memberProps: {
          picker: {
            fallbackToFirst: true,
            showDraftIndicator: true,
          },
        },
      },
    );

    await vi.waitFor(() => {
      expect(instance.state.values.value.selected).toEqual({
        className: BUSINESS_KNOWLEDGE,
        primaryKey: "ref-1",
      });
    });

    await vi.waitFor(() => {
      const selectedDot = element.querySelector<HTMLElement>(".sdk-reference-selected-draft-dot");
      expect(selectedDot).not.toBeNull();
      expect(selectedDot?.getAttribute("title")).toBe(publicEn.platform.formDraftIndicator);
    });

    // Clearing draft removes the selected warning dot reactively.
    draftStore.remove(objectDraftKey(BUSINESS_KNOWLEDGE, "ref-1", "edit"));
    await nextTick();
    expect(element.querySelector(".sdk-reference-selected-draft-dot")).toBeNull();
  });
});

describe("Gap 3: OperationResult pre-declared resultSections and defaultSectionId", () => {
  it("renders pre-declared resultSections empty states before execution and follows defaultSectionId on new results", async () => {
    const manifest: DirectPanelManifest = definePanel({
      state: {},
      members: {
        runner: {
          target: { projectionId: "runner.op" },
        },
      },
    });
    const instance = createDirectPanelInstance(manifest, {
      pageKey: "op-result-test",
      url: () => "/panels/op-result",
      label: () => "Op result",
      text: createPanelText({}, ref("en"), "en"),
      ...noOperations,
      readProjection: async () => {
        throw new Error("unused");
      },
      read: async () => ready({}),
    });
    const runnerOp: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: `${BUSINESS_KNOWLEDGE}.execute`,
      label: "Execute",
      effect: "read",
      target: { source: "none" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
      resultSections: [
        { id: "rows", label: "Data", kind: "records", emptyText: "Run query to view rows" },
        { id: "sql", label: "SQL", kind: "code", emptyText: "No SQL generated yet" },
        { id: "raw", label: "Raw", kind: "json", emptyText: "No raw payload yet" },
      ],
    };
    instance.register({
      slot: "runner",
      projectionId: "runner.op",
      ports: { binding: BUSINESS_KNOWLEDGE, inputs: {}, outputs: {} },
      operations: { execute: runnerOp },
    });

    const result = shallowRef<PanelReadOperationResult | null>(null);
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup() {
        provide(panelContextKey, directPanelContext(instance));
        return () => h(OperationResult, {
          result: result.value,
          operationSlot: "runner",
          operationName: "execute",
        });
      },
    }));
    app.use(ElementPlus);
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } as never }));
    app.mount(host);
    cleanup = () => {
      app.unmount();
      host.remove();
    };

    await vi.waitFor(() => {
      const tabs = Array.from(host.querySelectorAll<HTMLElement>(".el-tabs__item")).map((el) => el.textContent?.trim());
      expect(tabs).toEqual(["Data", "SQL", "Raw"]);
      expect(host.textContent).toContain("Run query to view rows");
    });

    // Error-style response with defaultSectionId: "raw" switches active tab to Raw.
    result.value = {
      kind: "sections",
      defaultSectionId: "raw",
      sections: [
        { id: "rows", label: "Data", kind: "records", columns: [], rows: [], emptyText: "No rows" },
        { id: "sql", label: "SQL", kind: "code", language: "text", content: "SELECT 1" },
        { id: "raw", label: "Raw", kind: "json", value: { error: "syntax error" } },
      ],
    };
    await vi.waitFor(() => {
      const active = host.querySelector<HTMLElement>(".el-tabs__item.is-active");
      expect(active?.textContent?.trim()).toBe("Raw");
    });

    // Next result without defaultSectionId resets back to the first section ("Data"), not stale "Raw".
    result.value = {
      kind: "sections",
      sections: [
        {
          id: "rows",
          label: "Data",
          kind: "records",
          columns: [{ key: "col", label: "Col" }],
          rows: [{ col: 42 }],
        },
        { id: "raw", label: "Raw", kind: "json", value: { ok: true } },
      ],
    };
    await vi.waitFor(() => {
      const active = host.querySelector<HTMLElement>(".el-tabs__item.is-active");
      expect(active?.textContent?.trim()).toBe("Data");
      expect(host.textContent).toContain("42");
    });
  });
});
