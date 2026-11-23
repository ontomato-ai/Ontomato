import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type PanelManifest, type PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { panelRowOperationKey } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { APPLICATION, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance,
  type DirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import type { PanelWriteInvocation } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const meta = {
  domainId: "domain-1",
  ownerId: "user-1",
  revision: 1,
  editable: false,
  visibility: "domain" as const,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  description: "",
};

const ready = (
  value: unknown,
  rowOperations?: Extract<ProductPanelReadResponse, { status: "ready" }>["rowOperations"],
): ProductPanelReadResponse => ({
  status: "ready",
  value: value as never,
  ...(rowOperations ? { rowOperations } : {}),
});

interface PreparedCall {
  operationId: string;
  invocation: PanelWriteInvocation;
  memberPath?: PanelMemberPath;
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountPanel(options: {
  manifest: PanelManifest;
  projections: Record<string, DirectProjection>;
  members: readonly string[];
  messages?: Record<string, Record<string, string>>;
  initial?: Record<string, unknown>;
  listeners?: Record<string, Record<string, (...args: unknown[]) => void>>;
  memberSlots?: (
    instance: DirectPanelInstance,
  ) => Record<string, Record<string, (slotProps: Record<string, unknown>) => unknown>>;
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
}) {
  const reads: PanelMemberReadRequest[] = [];
  const preparedCalls: PreparedCall[] = [];
  const instance: DirectPanelInstance = createDirectPanelInstance(options.manifest, {
    pageKey: "tasks-page",
    url: () => "/panels/tasks",
    label: () => "Tasks",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation, memberPath) {
        preparedCalls.push({ operationId, invocation, memberPath });
        return {
          intentId: `intent-${preparedCalls.length}`,
          operationId,
          label: operationId,
          confirmation: { kind: "none" },
        };
      },
    },
    confirmOperation: async (preparation) => ({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId: preparation.intentId,
        outcome: { kind: "success", message: "Done", data: {} },
      },
    }),
    readProjection: async (id) => {
      const found = options.projections[id];
      if (!found) throw new Error(`Unknown projection ${id}`);
      return found;
    },
    read: async (request) => {
      reads.push(request);
      return options.answer(request);
    },
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const resolvedSlots = options.memberSlots?.(instance);
  const app = createApp({
    setup: () => () =>
      h(
        "div",
        options.members.map((member) =>
          h(PanelMember, { instance, member, key: member, ...(options.listeners?.[member] ?? {}) }, resolvedSlots?.[member]),
        ),
      ),
  })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } as never }))
    .use(ElementPlus);
  app.mount(element);

  cleanup = () => {
    app.unmount();
    element.remove();
  };

  return { instance, element, reads, preparedCalls };
}

describe("ObjectList action column, Vue slots, batch rowOperations, and read-only outputs", () => {
  it("renders built-in rowActions (inline + overflow More + local + conditional + batch rowOperations) and column widths", async () => {
    const rows = [
      { primaryKey: "t-1", label: "Daily Sync", fields: { status: "active", schedule: "0 0 * * *" } },
      { primaryKey: "t-2", label: "System GC", fields: { status: "paused", schedule: "0 3 * * *" } },
    ];
    const rowActionEvents: unknown[] = [];

    const listProjection: DirectProjection = {
      ...meta,
      id: "tasks-list",
      name: "Tasks",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
      config: {
        columns: [
          { key: "label", labelKey: "col.name", width: "240px" },
          { key: "status", labelKey: "col.status", kind: "tag", width: 120 },
        ],
        rowActions: {
          maxVisible: 2,
          width: "220px",
          items: [
            { kind: "local", id: "edit", labelKey: "action.edit" },
            { kind: "operation", operation: "runNow", when: { field: "status", equals: "active" } },
            { kind: "operation", operation: "remove", danger: true },
          ],
        },
      },
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
      },
      operations: {
        runNow: {
          operation: { kind: "PlatformOperation", id: "schedules.runNow" },
          target: { row: true },
          params: { schedule: { rowField: "schedule" }, source: { literal: "table-row" } },
        },
        remove: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { row: true },
        },
      },
    };

    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: false },
      },
      members: {
        tasks: {
          target: { projectionId: "tasks-list" },
          outputs: { selected: { state: "selected" } },
        },
      },
    });

    const rowOps = {
      [panelRowOperationKey(rows[0]!, SCHEDULED_TASK)]: {
        runNow: { available: true },
        remove: { available: true },
      },
      [panelRowOperationKey(rows[1]!, SCHEDULED_TASK)]: {
        runNow: { available: true },
        remove: { available: false, unavailable: { reason: "System task cannot be removed" } },
      },
    };

    const { instance, element, reads, preparedCalls } = mountPanel({
      manifest,
      projections: { "tasks-list": listProjection },
      members: ["tasks"],
      messages: {
        en: { "col.name": "Task", "col.status": "Status", "action.edit": "Edit" },
      },
      listeners: {
        tasks: { onRowAction: (payload: unknown) => rowActionEvents.push(payload) },
      },
      answer(request) {
        if (request.operations) {
          return ready({
            runNow: {
              kind: "action",
              handlerRef: "schedules.runNow",
              label: "Run now",
              effect: "write",
              target: { source: "input", input: "task" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
            remove: {
              kind: "action",
              handlerRef: "schedules.deleteTask",
              label: "Delete",
              effect: "write",
              target: { source: "input", input: "task" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          });
        }
        return ready(rows, rowOps);
      },
    });

    await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(2));

    // Only 1 data read + 1 operations read (zero per-row N+1 availability requests).
    expect(reads.filter((r) => !r.operations)).toHaveLength(1);
    expect(reads.filter((r) => r.operations)).toHaveLength(1);

    // Column widths are rendered.
    const headers = [...element.querySelectorAll<HTMLElement>("thead th")];
    expect(headers[0]?.style.width).toBe("240px");
    expect(headers[1]?.style.width).toBe("120px");
    expect(headers[2]?.style.width).toBe("220px");

    // Row 0 (`status: active`) has 3 visible actions -> 2 inline (`Edit`, `Run now`) + 1 More menu (`···`).
    const tableRows = [...element.querySelectorAll<HTMLElement>("tbody tr")];
    const row0Buttons = [...tableRows[0]!.querySelectorAll<HTMLButtonElement>(".sdk-object-list-row-actions button")];
    expect(row0Buttons.map((b) => b.textContent?.trim())).toEqual(["Edit", "Run now", "···"]);
    expect(row0Buttons[2]!.getAttribute("aria-label")).toContain("More");

    // Row 1 (`status: paused`) hides `Run now` (`when` condition) -> 2 inline (`Edit`, `Delete`), no More button.
    // `Delete` is disabled by batch `rowOperations` with its reason in title.
    const row1Buttons = [...tableRows[1]!.querySelectorAll<HTMLButtonElement>(".sdk-object-list-row-actions button")];
    expect(row1Buttons.map((b) => b.textContent?.trim())).toEqual(["Edit", "Delete"]);
    expect(row1Buttons[1]!.disabled).toBe(true);
    expect(row1Buttons[1]!.title).toBe("System task cannot be removed");

    // Clicking local button emits `row-action`.
    row0Buttons[0]!.click();
    expect(rowActionEvents).toHaveLength(1);
    expect(rowActionEvents[0]).toMatchObject({
      id: "edit",
      ref: { className: SCHEDULED_TASK, primaryKey: "t-1" },
      index: 0,
    });

    // Clicking operation button dispatches with row target and row-bound params.
    row0Buttons[1]!.click();
    await vi.waitFor(() => expect(preparedCalls).toHaveLength(1));
    expect(preparedCalls[0]).toMatchObject({
      operationId: "tasks.runNow",
      invocation: {
        call: {
          target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" },
          input: { schedule: "0 0 * * *", source: "table-row" },
        },
      },
    });

    // Read-only outputs are published separately from writable state.
    expect(instance.outputs.tasks?.total).toBe(2);
    expect(instance.outputs.tasks?.filteredCount).toBe(2);
    expect(instance.outputs.tasks?.checkedCount).toBe(0);
    expect(instance.outputs.tasks?.selectedLabel ?? null).toBeNull();
    expect(Object.keys(instance.state.values.value)).toEqual(["selected"]);

    // Selecting row 0 updates `selectedLabel` and `activeLabel` read-only outputs.
    tableRows[0]!.click();
    await vi.waitFor(() => expect(instance.outputs.tasks?.selectedLabel).toBe("Daily Sync"));
    expect(instance.outputs.tasks?.activeLabel).toBe("Daily Sync");
  });

  it("renders #cell-<key>, #row-detail nested projection, and ObjectForm/ObjectSummary read-only outputs", async () => {
    const listProjection: DirectProjection = {
      ...meta,
      id: "apps-list",
      name: "Apps",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        columns: [
          { key: "label", labelKey: "col.app" },
          { key: "status", labelKey: "col.status" },
        ],
      },
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
      },
    };
    const summaryProjection: DirectProjection = {
      ...meta,
      id: "app-summary",
      name: "App Summary",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { app: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: {},
      data: {
        record: { source: { object: { input: "app" } }, read: "record", params: {} },
      },
    };
    const formProjection: DirectProjection = {
      ...meta,
      id: "app-form",
      name: "App Form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { app: { kind: "object", objectType: APPLICATION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "app" } },
          read: "form",
          params: { section: { literal: "identity" }, values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${APPLICATION}.save` }, target: { input: "app" } },
      },
    };

    const manifest = definePanel({
      state: {
        app: { type: { kind: "object", objectType: APPLICATION } },
      },
      members: {
        apps: { target: { projectionId: "apps-list" } },
        detail: { target: { projectionId: "app-summary" } },
        topSummary: { target: { projectionId: "app-summary" }, inputs: { app: { state: "app" } } },
        topForm: { target: { projectionId: "app-form" }, inputs: { app: { state: "app" } } },
      },
    });

    const { instance, element } = mountPanel({
      manifest,
      projections: {
        "apps-list": listProjection,
        "app-summary": summaryProjection,
        "app-form": formProjection,
      },
      members: ["apps", "topSummary", "topForm"],
      initial: { app: { className: APPLICATION, primaryKey: "app-1" } },
      messages: { en: { "col.app": "Application", "col.status": "Status" } },
      memberSlots: (inst) => ({
        apps: {
          "cell-label": (slotProps) =>
            h("span", { class: "custom-app-cell" }, `Custom:${(slotProps.row as { label: string }).label}`),
          "row-detail": (slotProps) => [
            h(PanelMember, {
              instance: inst,
              member: "detail",
              inputs: { app: slotProps.ref as { className: string; primaryKey: string } },
            }),
          ],
        },
      }),
      answer(request) {
        if (request.operations) {
          return ready({
            save: {
              kind: "form.save",
              handlerRef: `${APPLICATION}.save`,
              label: "Save",
              effect: "write",
              target: { source: "input", input: "app" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          });
        }
        if (request.dataName === "rows") {
          return ready({
            rows: [
              { primaryKey: "app-1", label: "Orders", fields: { status: "active" } },
              { primaryKey: "app-2", label: "Billing", fields: { status: "draft" } },
            ],
            total: 2,
          });
        }
        if (request.dataName === "record") {
          const refVal = request.inputs.app as { primaryKey: string };
          return ready({
            primaryKey: refVal.primaryKey,
            label: refVal.primaryKey === "app-1" ? "Orders App" : "Billing App",
            fields: { description: `Details for ${refVal.primaryKey}` },
          });
        }
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
          ],
          values: { name: "Orders App" },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/apps/:id", bodySchema: {}, draftOperation: `${APPLICATION}.save` },
        });
      },
    });

    // Custom #cell-label renders inside the table.
    await vi.waitFor(() => expect(element.querySelectorAll(".custom-app-cell")).toHaveLength(2));
    expect([...element.querySelectorAll(".custom-app-cell")].map((el) => el.textContent)).toEqual([
      "Custom:Orders",
      "Custom:Billing",
    ]);

    // Expanding row 2 mounts nested `detail` projection receiving row 2's `ref` via `:inputs`.
    const expandBtns = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn");
    expect(expandBtns).toHaveLength(2);
    expandBtns[1]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector(".sdk-object-list-detail-host")?.textContent).toContain("Details for app-2");
    });

    // ObjectSummary and ObjectForm publish read-only outputs without needing writable panel state.
    await vi.waitFor(() => expect(instance.outputs.topSummary?.label).toBe("Orders App"));
    await vi.waitFor(() => expect(instance.outputs.topForm?.label).toBe("Orders App"));
    expect(instance.outputs.topForm?.dirty).toBe(false);
    expect(instance.outputs.topForm?.draft).toEqual({ name: "Orders App" });

    // Editing the form updates `dirty` and `draft` read-only outputs reactively.
    const input = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
    input.value = "Orders v2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(instance.outputs.topForm?.dirty).toBe(true));
    expect(instance.outputs.topForm?.draft).toEqual({ name: "Orders v2" });
  });

  it("renders table showChevron without selected state, emits choose, and keeps filteredCount null while loading", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const chosen: unknown[] = [];

    const projections: Record<string, DirectProjection> = {
      "proj-catalog": {
        ...meta,
        id: "proj-catalog",
        name: "Catalog",
        componentId: "@ontomato/sdk:ObjectList",
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
            read: "list",
            params: {},
          },
        },
        inputs: { search: { kind: "scalar", type: "string" } },
        outputs: { search: { kind: "scalar", type: "string" } },
        config: {
          layout: "table",
          showChevron: true,
          searchable: false,
          columns: [{ key: "label", labelKey: "col.name" }],
        },
      },
    };

    const manifest = definePanel({
      state: { search: { type: { kind: "scalar", type: "string" } } },
      members: {
        catalog: {
          target: { projectionId: "proj-catalog" },
          inputs: { search: { state: "search" } },
          outputs: { search: { state: "search" } },
        },
      },
    });

    const { element, instance } = mountPanel({
      manifest,
      projections,
      members: ["catalog"],
      messages: { en: { "col.name": "Name" } },
      listeners: { catalog: { onChoose: (refValue: unknown) => chosen.push(refValue) } },
      answer: async () => {
        await held;
        return ready([
          { primaryKey: "app-1", label: "Orders", fields: {} },
          { primaryKey: "app-2", label: "Billing", fields: {} },
        ]);
      },
    });

    // While loading, filteredCount and total stay null rather than flashing 0.
    await vi.waitFor(() => expect(element.querySelector(".sdk-object-list")).not.toBeNull());
    expect(instance.outputs.catalog?.filteredCount ?? null).toBeNull();
    expect(instance.outputs.catalog?.total ?? null).toBeNull();

    release();
    await vi.waitFor(() => expect(instance.outputs.catalog?.filteredCount).toBe(2));
    expect(instance.outputs.catalog?.total).toBe(2);
    expect(element.querySelectorAll(".sdk-object-list-row-chevron")).toHaveLength(2);

    // Clicking a row emits choose even though no `selected` state is bound.
    element.querySelector<HTMLTableRowElement>('tr[data-row-item="true"]')!.click();
    expect(chosen).toEqual([{ className: SCHEDULED_TASK, primaryKey: "app-1" }]);

    // Narrowing to zero matches updates filteredCount to 0.
    instance.state.set("search", "nonexistent");
    await vi.waitFor(() => expect(instance.outputs.catalog?.filteredCount).toBe(0));
  });

  it("publishes ObjectHeader status alongside label across loading, ready, empty, and forbidden states", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    const projections: Record<string, DirectProjection> = {
      "proj-header": {
        ...meta,
        id: "proj-header",
        name: "Header",
        componentId: "@ontomato/sdk:ObjectHeader",
        data: {
          record: {
            source: { object: { input: "target" } },
            read: "record",
            params: {},
          },
        },
        inputs: { target: { kind: "object", objectType: APPLICATION } },
        outputs: {},
        config: { subtitle: "" },
      },
    };

    const manifest = definePanel({
      state: { selected: { type: { kind: "object", objectType: APPLICATION } } },
      members: {
        header: {
          target: { projectionId: "proj-header" },
          inputs: { target: { state: "selected" } },
        },
      },
    });

    const { instance } = mountPanel({
      manifest,
      projections,
      members: ["header"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-1" } },
      answer: async (req) => {
        const key = (req.inputs.target as { primaryKey: string } | null)?.primaryKey;
        if (key === "app-1") {
          await held;
          return ready({ primaryKey: "app-1", label: "Orders App", fields: {} });
        }
        if (key === "forbidden") return { status: "forbidden" };
        return { status: "empty" };
      },
    });

    await vi.waitFor(() => expect(instance.outputs.header?.status).toBe("loading"));
    expect(instance.outputs.header?.label ?? null).toBeNull();

    release();
    await vi.waitFor(() => expect(instance.outputs.header?.status).toBe("ready"));
    expect(instance.outputs.header?.label).toBe("Orders App");

    instance.state.set("selected", { className: APPLICATION, primaryKey: "missing" });
    await vi.waitFor(() => expect(instance.outputs.header?.status).toBe("empty"));
    expect(instance.outputs.header?.label ?? null).toBeNull();

    instance.state.set("selected", { className: APPLICATION, primaryKey: "forbidden" });
    await vi.waitFor(() => expect(instance.outputs.header?.status).toBe("forbidden"));
  });
});
