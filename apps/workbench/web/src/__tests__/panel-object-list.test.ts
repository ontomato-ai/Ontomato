/* eslint-disable vue/one-component-per-file */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  ACTION,
  BUSINESS_KNOWLEDGE,
  ONTOLOGY_TYPE,
  platformOntologyLayers,
  ROLE,
  SCHEDULED_TASK,
  USER,
  WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * ObjectList, ObjectSummary and SegmentedControl under the unified member-data contract:
 * - M7 BusinessKnowledge pattern: SegmentedControl reading `counts` (`panelGroupCounts`), ObjectList reading
 *   `rows` (`panelRecordQuery`) with escaped UTF-16 highlights, fallback-to-first selection and non-toggleable
 *   selection, plus ObjectSummary reading `record` with highlights and pre-wrap body text.
 * - Multi-column table labelKey/emptyKey resolution via `panel.t`, fallback to owner `fieldLabels`, and
 *   event-based state operations.
 * - Server-side cursor pagination (`panelRecordQuery`), submit-mode search resetting to page 1, refresh,
 *   and per-row detail action.
 * - Two-way search binding with scalar deepLink panel state (restore, submit, clear to null, external update).
 * - Instance-local checked list (`{ kind: "list", items: { kind: "object", objectType } }`) separate from
 *   single selection, visible-only select-all across pages, excluded from deepLink & pageContext, atomic
 *   `clears`, partial retention, and type rejection.
 * - M3 dynamic type catalog (`data.objects`: `panelOntologyObjects`): awaiting prompt with zero reads,
 *   offset/page pagination, local keyword search, full `(className, primaryKey)` identity matching, owner
 *   labels under the real object type, and distinct refused/failed/unavailable statuses.
 */

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

type Read = Omit<ProductPanelReadRequest, "source">;

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const knowledge = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });

let cleanup: (() => void) | null = null;

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    messages?: Record<string, Record<string, string>>;
    members?: readonly string[];
  } = {},
) {
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const reads: Read[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-list-test",
    url: () => "/panels/object-list",
    label: () => "Object list test",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member, key: member }))),
  }).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element, reads };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.resetModules();
});

it("pairs SegmentedControl panelGroupCounts with ObjectList panelRecordQuery highlights, fallback-to-first, and ObjectSummary", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-tabs": {
      ...meta,
      id: "knowledge-tabs",
      name: "Status tabs",
      componentId: "@ontomato/sdk:SegmentedControl",
      inputs: { search: { kind: "scalar", type: "string" } },
      outputs: { value: { kind: "scalar", type: "string" } },
      config: {
        ariaLabel: "Knowledge status",
        options: [
          { value: "all", labelKey: "knowledge.filterAll" },
          { value: "pending", labelKey: "knowledge.filterPending" },
          { value: "approved", labelKey: "knowledge.filterApproved" },
        ],
      },
      data: {
        counts: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "counts",
          params: { by: { literal: "status" }, search: { input: "search" } },
        },
      },
    },
    "knowledge-list": {
      ...meta,
      id: "knowledge-list",
      name: "Knowledge list",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        search: { kind: "scalar", type: "string" },
        status: { kind: "scalar", type: "string" },
        filter: { kind: "json" },
      },
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        search: { kind: "scalar", type: "string" },
      },
      config: {
        searchable: true,
        statusField: "status",
        fallbackToFirst: true,
        toggleable: false,
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { search: { input: "search" }, filter: { input: "filter" } },
        },
      },
    },
    "knowledge-summary": {
      ...meta,
      id: "knowledge-summary",
      name: "Knowledge detail",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: {
        item: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        search: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: { fields: ["status", "body"] },
      data: {
        record: {
          source: { object: { input: "item" } },
          read: "record",
          params: { search: { input: "search" } },
        },
      },
    },
  };

  const manifest = definePanel({
    state: {
      keyword: { type: { kind: "scalar", type: "string" }, deepLink: true },
      status: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "all" },
      selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
    },
    members: {
      tabs: {
        target: { projectionId: "knowledge-tabs" },
        inputs: { search: { state: "keyword" } },
        outputs: { value: { state: "status" } },
      },
      list: {
        target: { projectionId: "knowledge-list" },
        inputs: { search: { state: "keyword" }, status: { state: "status" } },
        outputs: { selected: { state: "selectedKnowledge" }, search: { state: "keyword" } },
      },
      detail: {
        target: { projectionId: "knowledge-summary" },
        inputs: { item: { state: "selectedKnowledge" }, search: { state: "keyword" } },
      },
    },
    events: {},
  });

  const entries = [
    {
      primaryKey: "k-1",
      label: "<img src=x onerror=alert(1)> Order rule",
      subtitle: "Order must have customer",
      fields: { status: "Approved", body: "Order must have customer\nLine 2" },
      statusValue: "approved",
    },
    {
      primaryKey: "k-2",
      label: "Pending Order rule",
      subtitle: "Draft order rule",
      fields: { status: "Pending", body: "Draft order rule" },
      statusValue: "pending",
    },
  ];

  const { instance, element } = mountDirect(
    manifest,
    projections,
    (request) => {
      const search = typeof request.inputs.search === "string" ? request.inputs.search.trim().toLowerCase() : "";
      const matched = search ? entries.filter((entry) => entry.label.toLowerCase().includes(search)) : entries;
      const rangeOf = (text: string) => {
        if (!search) return [];
        const index = text.toLowerCase().indexOf(search);
        return index >= 0 ? [{ start: index, end: index + search.length }] : [];
      };
      if (request.dataName === "counts") {
        return ready({
          all: matched.length,
          pending: matched.filter((entry) => entry.statusValue === "pending").length,
          approved: matched.filter((entry) => entry.statusValue === "approved").length,
        });
      }
      if (request.dataName === "rows") {
        const filter = (request.inputs.filter as { status?: string } | undefined)?.status ?? "all";
        const visible = filter === "all" ? matched : matched.filter((entry) => entry.statusValue === filter);
        return ready({
          rows: visible.map(({ statusValue: _s, ...item }) => {
            const labelHits = rangeOf(item.label);
            const subtitleHits = rangeOf(item.subtitle);
            const highlights = {
              ...(labelHits.length ? { label: labelHits } : {}),
              ...(subtitleHits.length ? { subtitle: subtitleHits } : {}),
            };
            return {
              ...item,
              ...(Object.keys(highlights).length ? { highlights } : {}),
            };
          }),
          total: visible.length,
        });
      }
      const key = (request.inputs.item as { primaryKey: string }).primaryKey;
      const found = entries.find((entry) => entry.primaryKey === key)!;
      const bodyHits = rangeOf(found.fields.body);
      return ready({
        primaryKey: found.primaryKey,
        label: found.label,
        fields: found.fields,
        ...(bodyHits.length ? { highlights: { body: bodyHits } } : {}),
      });
    },
    {
      messages: {
        en: {
          "knowledge.filterAll": "All",
          "knowledge.filterPending": "Pending",
          "knowledge.filterApproved": "Approved",
        },
      },
    },
  );

  // Fallback-to-first selects k-1 automatically on initial load.
  await vi.waitFor(() => expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-1")));

  // SegmentedControl shows panelGroupCounts beside each option label.
  await vi.waitFor(() => {
    const counts = [...element.querySelectorAll(".sdk-segmented-count")].map((node) => node.textContent?.trim());
    expect(counts).toEqual(["2", "1", "1"]);
  });
  const radios = [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");

  // Re-clicking selected row does not toggle off when toggleable: false.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-item-btn")!.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-1"));

  // Typing search highlights matched UTF-16 ranges safely (zero raw HTML injection) in both list and summary.
  const searchInput = element.querySelector<HTMLInputElement>('input[type="search"]')!;
  searchInput.value = "Order";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list mark").length).toBeGreaterThan(0));
  expect(element.querySelector(".sdk-object-list img")).toBeNull();
  expect(element.querySelector(".sdk-object-list mark")?.textContent).toBe("Order");
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary mark")?.textContent).toBe("Order"));
  const summaryTexts = [...element.querySelectorAll(".sdk-object-summary-text")].map((node) => node.textContent);
  expect(summaryTexts[1]).toContain("Line 2");

  // Switching status tab via SegmentedControl updates filter and falls back selection to k-2.
  radios[1]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("pending"));
  await vi.waitFor(() => expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2")));
  expect(radios[1]!.getAttribute("aria-checked")).toBe("true");

  // Keyboard ArrowLeft switches back to "all".
  radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("all"));
});

it("keeps SegmentedControl interactive when its counts datum fails or is loading", async () => {
  const projections: Record<string, DirectProjection> = {
    "status-tabs": {
      ...meta,
      id: "status-tabs",
      name: "Status tabs",
      componentId: "@ontomato/sdk:SegmentedControl",
      inputs: {},
      outputs: { value: { kind: "scalar", type: "string" } },
      config: {
        options: [
          { value: "all", label: "All" },
          { value: "pending", label: "Pending" },
        ],
      },
      data: {
        counts: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "counts",
          params: { by: { literal: "status" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      status: { type: { kind: "scalar", type: "string" }, default: "all" },
      cleared: { type: { kind: "scalar", type: "boolean" }, default: false },
    },
    members: {
      tabs: { target: { projectionId: "status-tabs" }, outputs: { value: { state: "status" } } },
    },
    events: {
      onStatusChange: {
        on: { member: "tabs", output: "value" },
        do: { set: { fields: { cleared: { literal: true } } } },
      },
    },
  });

  const { instance, element } = mountDirect(manifest, projections, () => ({ status: "error", message: "Counts failed" }));
  await vi.waitFor(() => expect(element.querySelectorAll('[role="radio"]')).toHaveLength(2));
  expect(element.querySelectorAll(".sdk-segmented-count")).toHaveLength(0);

  element.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("pending"));
  expect(instance.state.values.value.cleared).toBe(true);
});

it("resolves column labelKey/emptyKey via panel.t, falls back to owner fieldLabels, and resolves state event labelKey", async () => {
  const projections: Record<string, DirectProjection> = {
    "labeled-list": {
      ...meta,
      id: "labeled-list",
      name: "Tasks",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
      config: {
        columns: [
          { key: "source" },
          { key: "comment", labelKey: "cols.notes", emptyKey: "cols.noNotes" },
          { key: "rawCode" },
        ],
      },
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
      },
    },
    "labeled-summary": {
      ...meta,
      id: "labeled-summary",
      name: "Summary",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { item: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      config: { fields: ["source", "rawCode"] },
      data: {
        record: { source: { object: { input: "item" } }, read: "record", params: {} },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
    },
    members: {
      list: { target: { projectionId: "labeled-list" }, outputs: { selected: { state: "selectedTask" } } },
      summary: { target: { projectionId: "labeled-summary" }, inputs: { item: { state: "selectedTask" } } },
    },
    events: {
      clearSelection: {
        labelKey: "ops.clear",
        do: { set: { fields: { selectedTask: { literal: null } } } },
      },
    },
  });
  const record = {
    primaryKey: "t-1",
    label: "Task 1",
    fields: { source: "Q&A", comment: "", rawCode: "E-100" },
    fieldLabels: { source: "Task source", comment: "Owner comment" },
  };
  const { instance, element } = mountDirect(
    manifest,
    projections,
    (request) => (request.dataName === "rows" ? ready([record]) : ready(record)),
    {
      messages: {
        en: { "cols.notes": "Reviewer notes", "cols.noNotes": "No notes", "ops.clear": "Clear selection" },
      },
    },
  );

  await vi.waitFor(() => expect(element.querySelectorAll("thead th").length).toBe(3));
  const headers = [...element.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
  expect(headers).toEqual(["Task source", "Reviewer notes", "rawCode"]);
  const cells = [...element.querySelectorAll("tbody tr td")].map((td) => td.textContent?.trim());
  expect(cells).toEqual(["Q&A", "No notes", "E-100"]);
  expect(instance.operations.value.find((op) => op.id === "clearSelection")?.label).toBe("Clear selection");

  element.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-summary dt").length).toBe(2));
  const summaryLabels = [...element.querySelectorAll(".sdk-object-summary dt")].map((dt) => dt.textContent?.trim());
  expect(summaryLabels).toEqual(["Task source", "rawCode"]);

  await instance.invoke("clearSelection");
  expect(instance.state.values.value.selectedTask).toBeNull();
});

it("supports cursor pagination, submit-mode search resetting to page 1, refresh, and row detail action", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-table": {
      ...meta,
      id: "knowledge-table",
      name: "Knowledge",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        search: { kind: "scalar", type: "string" },
        cursor: { kind: "scalar", type: "string" },
        size: { kind: "scalar", type: "number" },
      },
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: {
        columns: [
          { key: "label", labelKey: "cols.title" },
          { key: "status", labelKey: "cols.status" },
        ],
        searchable: true,
        searchMode: "submit",
        refreshable: true,
        showCount: true,
        pageSize: 2,
        toggleable: false,
        rowActionLabel: "cols.details",
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { search: { input: "search" }, cursor: { input: "cursor" }, size: { input: "size" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
    },
    members: {
      list: { target: { projectionId: "knowledge-table" }, outputs: { selected: { state: "selectedKnowledge" } } },
    },
    events: {},
  });

  const allItems = [
    { primaryKey: "k-1", label: "Alpha rule", fields: { status: "Approved" } },
    { primaryKey: "k-2", label: "Beta rule", fields: { status: "Pending" } },
    { primaryKey: "k-3", label: "Gamma rule", fields: { status: "Approved" } },
  ];

  const { instance, element, reads } = mountDirect(
    manifest,
    projections,
    (request) => {
      const search = typeof request.inputs.search === "string" ? request.inputs.search.toLowerCase() : "";
      const filtered = search ? allItems.filter((item) => item.label.toLowerCase().includes(search)) : allItems;
      const size = typeof request.inputs.size === "number" ? request.inputs.size : 2;
      const offset = request.inputs.cursor === "page-2" ? size : 0;
      const pageRows = filtered.slice(offset, offset + size);
      const nextCursor = offset + size < filtered.length ? "page-2" : undefined;
      return ready({
        rows: pageRows,
        total: filtered.length,
        ...(nextCursor ? { nextCursor } : {}),
      });
    },
    { messages: { en: { "cols.title": "Title", "cols.status": "Status", "cols.details": "Details" } } },
  );

  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(2));
  expect(reads[0]!.inputs).toEqual({ size: 2 });
  expect(element.querySelector(".sdk-object-list-count")?.textContent).toContain("3");

  // Next page sends cursor="page-2" and size=2.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(1));
  expect(reads[1]!.inputs).toEqual({ cursor: "page-2", size: 2 });

  // Typing in submit mode does NOT query until clicking Query button, which resets to page 1 (no cursor).
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "beta";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(reads).toHaveLength(2);

  element.querySelector<HTMLButtonElement>(".sdk-object-list-query")!.click();
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads[2]!.inputs).toEqual({ search: "beta", size: 2 });
  await vi.waitFor(() => expect(element.querySelector("tbody tr td")?.textContent?.trim()).toBe("Beta rule"));

  // Refresh re-runs the same query.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-refresh")!.click();
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[3]!.inputs).toEqual({ search: "beta", size: 2 });

  // Row detail action selects k-2 without toggling off on repeated click.
  const detailButton = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-object-list-row-action");
    if (!found) throw new Error("Row action button not rendered yet");
    return found;
  });
  detailButton.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2"));
  detailButton.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2"));
});

it("two-way binds ObjectList search keyword with scalar deepLink panel state without double reads", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-search": {
      ...meta,
      id: "knowledge-search",
      name: "Knowledge search",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        search: { kind: "scalar", type: "string" },
        size: { kind: "scalar", type: "number" },
      },
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        search: { kind: "scalar", type: "string" },
      },
      config: {
        searchable: true,
        searchMode: "submit",
        pageSize: 10,
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { search: { input: "search" }, size: { input: "size" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      keyword: { type: { kind: "scalar", type: "string" }, deepLink: true },
    },
    members: {
      list: {
        target: { projectionId: "knowledge-search" },
        inputs: { search: { state: "keyword" } },
        outputs: { selected: { state: "selectedKnowledge" }, search: { state: "keyword" } },
      },
    },
    events: {},
  });

  const { instance, element, reads } = mountDirect(
    manifest,
    projections,
    (request) => ready({
      rows: [{ primaryKey: "k-1", label: `Hit: ${String(request.inputs.search ?? "")}`, fields: {} }],
      total: 1,
    }),
    { initial: { keyword: "timeout" } },
  );

  // 1. Initial read carries restored deepLink keyword; search input reflects it.
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  expect(reads[0]!.inputs).toEqual({ search: "timeout", size: 10 });
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  expect(searchInput.value).toBe("timeout");

  // 2. Submitting a new search writes back to panel state & deepLink with exactly ONE new read.
  searchInput.value = "chart";
  searchInput.dispatchEvent(new Event("input"));
  element.querySelector<HTMLButtonElement>(".sdk-object-list-query")!.click();
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  await nextTick();
  expect(reads).toHaveLength(2);
  expect(reads[1]!.inputs).toEqual({ search: "chart", size: 10 });
  expect(instance.deepLink()).toEqual({ keyword: "chart" });

  // 3. Clearing search writes null so deepLink drops the cleared key.
  searchInput.value = "";
  searchInput.dispatchEvent(new Event("input"));
  element.querySelector<HTMLButtonElement>(".sdk-object-list-query")!.click();
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(instance.state.values.value.keyword).toBeNull();
  expect(instance.deepLink()).toEqual({});

  // 4. External state update syncs search input and triggers a single re-read.
  instance.state.set("keyword", "external");
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[3]!.inputs).toEqual({ search: "external", size: 10 });
  expect(searchInput.value).toBe("external");
});

it("keeps checked list separate from selected, freezes visible rows on select-all, supports clears and excludes checked from deepLink", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-checked": {
      ...meta,
      id: "knowledge-checked",
      name: "Knowledge",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { cursor: { kind: "scalar", type: "string" }, size: { kind: "scalar", type: "number" } },
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      config: {
        columns: [{ key: "label", labelKey: "cols.name" }],
        selectable: true,
        pageSize: 2,
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { cursor: { input: "cursor" }, size: { input: "size" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      checkedKnowledge: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    },
    members: {
      list: {
        target: { projectionId: "knowledge-checked" },
        outputs: { selected: { state: "selectedKnowledge" }, checked: { state: "checkedKnowledge" } },
      },
    },
    events: {
      clearChecked: {
        labelKey: "ops.clearChecked",
        do: { set: { fields: { checkedKnowledge: { literal: [] } } } },
      },
    },
  });

  const allItems = [
    { primaryKey: "k-1", label: "Rule 1", fields: {} },
    { primaryKey: "k-2", label: "Rule 2", fields: {} },
    { primaryKey: "k-3", label: "Rule 3", fields: {} },
    { primaryKey: "k-4", label: "Rule 4", fields: {} },
  ];

  const { instance, element } = mountDirect(
    manifest,
    projections,
    (request) => {
      const offset = request.inputs.cursor === "p2" ? 2 : 0;
      return ready({
        rows: allItems.slice(offset, offset + 2),
        total: allItems.length,
        ...(offset === 0 ? { nextCursor: "p2" } : {}),
      });
    },
    { messages: { en: { "cols.name": "Knowledge", "ops.clearChecked": "Clear checked" } } },
  );

  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(2));

  // Selecting row 1 sets selectedKnowledge without touching checkedKnowledge.
  element.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-1"));
  expect(instance.state.values.value.checkedKnowledge).toBeNull();

  // Select-all on page 1 (2 visible of 4 total) freezes ONLY the 2 visible objects into checkedKnowledge.
  const selectAll = element.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
  selectAll.click();
  await nextTick();
  expect(instance.state.values.value.checkedKnowledge).toEqual([knowledge("k-1"), knowledge("k-2")]);

  // Checked list is instance-local: excluded from deepLink() and pageContext.selection.
  expect(instance.deepLink()).toEqual({ selectedKnowledge: knowledge("k-1") });
  expect(instance.pageContext.value.selection).toEqual([
    { kind: BUSINESS_KNOWLEDGE, id: "k-1", label: `Rule 1 (${BUSINESS_KNOWLEDGE} k-1)` },
  ]);

  // Navigating to page 2 and checking k-3 unions with already-checked items from page 1.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(element.querySelector("tbody tr td:nth-child(2)")?.textContent?.trim()).toBe("Rule 3"));
  element.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click();
  await nextTick();
  expect(instance.state.values.value.checkedKnowledge).toEqual([knowledge("k-1"), knowledge("k-2"), knowledge("k-3")]);

  // Event clearing checkedKnowledge to [] syncs checkboxes back to unchecked.
  await instance.invoke("clearChecked");
  await nextTick();
  expect(instance.state.values.value.checkedKnowledge).toEqual([]);
  expect([...element.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every((box) => !box.checked)).toBe(true);

  // External partial retention (e.g. failed item left checked after batch write) reflects in UI and indeterminate state.
  instance.state.set("checkedKnowledge", [knowledge("k-4")]);
  await nextTick();
  const rowBoxes = [...element.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
  expect(rowBoxes.map((box) => box.checked)).toEqual([false, true]);
  expect(element.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.indeterminate).toBe(true);

  // Wrong objectType inside list state is rejected by checkPanelValue.
  expect(() => instance.state.set("checkedKnowledge", [{ className: SCHEDULED_TASK, primaryKey: "t-1" }])).toThrow(TypeError);
});

it("clears declared list state atomically when ObjectList changes selection with clears", async () => {
  const projections: Record<string, DirectProjection> = {
    "clearing-list": {
      ...meta,
      id: "clearing-list",
      name: "Knowledge",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      config: { selectable: true, clears: ["checkedKnowledge"] },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: {},
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      checkedKnowledge: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    },
    members: {
      list: {
        target: { projectionId: "clearing-list" },
        outputs: { selected: { state: "selectedKnowledge" }, checked: { state: "checkedKnowledge" } },
      },
    },
    events: {},
  });

  const { instance, element } = mountDirect(
    manifest,
    projections,
    () => ready({
      rows: [
        { primaryKey: "k-1", label: "Rule 1", fields: {} },
        { primaryKey: "k-2", label: "Rule 2", fields: {} },
      ],
      total: 2,
    }),
    { initial: { selectedKnowledge: knowledge("k-1"), checkedKnowledge: [knowledge("k-1"), knowledge("k-2")] } },
  );

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(2));
  element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")[1]!.click();
  await nextTick();
  expect(instance.state.values.value).toEqual({
    selectedKnowledge: knowledge("k-2"),
    checkedKnowledge: [],
  });
});

it("supports dynamic type queries via data.objects (panelOntologyObjects) with status separation and identity matching", async () => {
  const pickerProj: DirectProjection = {
    ...meta,
    id: "type-object-picker",
    name: "Type Object Picker",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      type: { kind: "scalar", type: "string" },
      keyword: { kind: "scalar", type: "string" },
      page: { kind: "json" },
    },
    outputs: { selected: { kind: "object-union", layers: [...platformOntologyLayers] } },
    config: { searchable: true, showCount: true, pageSize: 2, emptyTypeText: "picker.selectType" },
    data: {
      objects: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "objects",
        params: { type: { input: "type" }, keyword: { input: "keyword" }, page: { input: "page" } },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedType: { type: { kind: "scalar", type: "string" } },
      start: { type: { kind: "object-union", layers: [...platformOntologyLayers] } },
    },
    members: {
      picker: {
        target: { projectionId: pickerProj.id },
        inputs: { type: { state: "selectedType" } },
        outputs: { selected: { state: "start" } },
      },
    },
    events: {},
  });

  const { instance, element, reads } = mountDirect(
    manifest,
    { [pickerProj.id]: pickerProj },
    (request) => {
      const type = String(request.inputs.type);
      const keyword = typeof request.inputs.keyword === "string" ? request.inputs.keyword.toLowerCase() : "";
      const page = (request.inputs.page as { number: number; size: number } | undefined) ?? { number: 1, size: 20 };
      const offset = (page.number - 1) * page.size;
      if (type === ROLE) {
        return ready({ type: ROLE, layer: "governance", status: "refused", reason: "No role permission", items: [], total: 0, page: page.number, pageSize: page.size });
      }
      if (type === USER) {
        return ready({ type: USER, layer: "governance", status: "failed", reason: "Identity service 503", items: [], total: 0, page: page.number, pageSize: page.size });
      }
      if (type === "platform:Definition") {
        return ready({ type: "platform:Definition", layer: "capability", status: "unavailable", reason: "Owner not connected", items: [], total: 0, page: page.number, pageSize: page.size });
      }
      if (type === WORKFLOW) {
        return ready({
          type: WORKFLOW,
          layer: "capability",
          status: "ok",
          items: [{ node: { className: WORKFLOW, primaryKey: "shared-1" }, label: "Nightly Flow" }],
          total: 1,
          page: page.number,
          pageSize: page.size,
        });
      }
      const all = [
        { node: { className: ACTION, primaryKey: "shared-1" }, label: "Deploy Action" },
        { node: { className: ACTION, primaryKey: "act-2" }, label: "Rollback Action" },
        { node: { className: ACTION, primaryKey: "act-3" }, label: "Audit Action" },
      ].filter((item) => !keyword || item.label.toLowerCase().includes(keyword));
      return ready({
        type,
        layer: "capability",
        status: "ok",
        items: all.slice(offset, offset + page.size),
        total: all.length,
        page: page.number,
        pageSize: page.size,
      });
    },
    { messages: { en: { "picker.selectType": "Choose a type from the graph" } } },
  );

  // 1) No type selected yet -> prompt shown via panel.t, zero reads, no count/pagination.
  await vi.waitFor(() => {
    expect(element.querySelector('[data-status="no-type"]')?.textContent).toContain("Choose a type from the graph");
  });
  expect(reads).toHaveLength(0);
  expect(element.querySelector(".sdk-object-list-count")).toBeNull();
  expect(element.querySelector(".sdk-object-list-pagination")).toBeNull();

  // 2) Select ACTION -> reads page 1 with pageSize 2, renders 2 items + count 3 + pagination.
  instance.state.set("selectedType", ACTION);
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(2));
  expect(reads[0]!.inputs).toEqual({ type: ACTION, page: { number: 1, size: 2 } });
  expect(element.querySelector(".sdk-object-list-count")?.textContent).toContain("3");
  expect(element.querySelector(".sdk-object-list-pagination")).not.toBeNull();

  // 3) Next page -> page 2.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(1));
  expect(reads[1]!.inputs).toEqual({ type: ACTION, page: { number: 2, size: 2 } });

  // 4) Search resets to page 1 and filters by keyword.
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "deploy";
  searchInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads[2]!.inputs).toEqual({ type: ACTION, keyword: "deploy", page: { number: 1, size: 2 } });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Deploy Action"));

  // 5) Clicking item writes complete { className: ACTION, primaryKey: shared-1 } and registers label under ACTION.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-item-btn")!.click();
  await nextTick();
  expect(instance.state.values.value.start).toEqual({ className: ACTION, primaryKey: "shared-1" });
  expect(instance.pageContext.value.selection).toEqual([
    { kind: ACTION, id: "shared-1", label: expect.stringContaining(`Deploy Action (${ACTION} shared-1)`) },
  ]);

  // 6) Switch to WORKFLOW (same primaryKey "shared-1"): resets search & paging, does not mis-highlight WORKFLOW/shared-1.
  instance.state.set("selectedType", WORKFLOW);
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[3]!.inputs).toEqual({ type: WORKFLOW, page: { number: 1, size: 2 } });
  expect(searchInput.value).toBe("");
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Nightly Flow"));
  expect(element.querySelector(".sdk-object-list-item-btn")?.getAttribute("aria-selected")).toBe("false");

  // 7) Distinct refused / failed / unavailable statuses hide count & pagination and never collapse into empty.
  instance.state.set("selectedType", ROLE);
  await vi.waitFor(() => expect(element.querySelector('[data-status="refused"]')?.textContent).toContain("No role permission"));
  expect(element.querySelector(".sdk-object-list-count")).toBeNull();
  expect(element.querySelector(".sdk-object-list-pagination")).toBeNull();

  instance.state.set("selectedType", USER);
  await vi.waitFor(() => expect(element.querySelector('[data-status="failed"]')?.textContent).toContain("Identity service 503"));

  instance.state.set("selectedType", "platform:Definition");
  await vi.waitFor(() => expect(element.querySelector('[data-status="unavailable"]')?.textContent).toContain("Owner not connected"));
});

it("draws a declared ObjectList with data.objects in a frame via <Projection> and frameMemberData", async () => {
  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const { platformOntologyAdapters } = await import("../../../../../packages/apps-sdk/src/panel/platform-ontology");
  const { createPanelInstance } = await import("../../../../../packages/apps-sdk/src/panel/instance");
  const { panelContextKey } = await import("../../../../../packages/apps-sdk/src/panel/context");
  const { default: Projection } = await import("../../../../../packages/apps-sdk/src/panel/Projection.vue");

  platformOntologyAdapters({
    async request(path, init) {
      if (path === "/platform-ontology/objects") {
        const body = JSON.parse(String(init.body)) as { type: string; page?: number; pageSize?: number };
        return Response.json({
          type: body.type,
          layer: "capability",
          status: "ok",
          items: [{ node: { className: body.type, primaryKey: "act-1" }, label: "Deploy Release" }],
          total: 1,
          page: body.page ?? 1,
          pageSize: body.pageSize ?? 20,
        });
      }
      throw new Error(`Unexpected path ${path}`);
    },
  }).forEach(registerPlatformObjectAdapter);

  const pickerProj: DirectProjection = {
    ...meta,
    id: "frame-type-picker",
    name: "Picker",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { type: { kind: "scalar", type: "string" }, page: { kind: "json" } },
    outputs: { selected: { kind: "object-union", layers: [...platformOntologyLayers] } },
    config: { pageSize: 10, showCount: true },
    data: {
      objects: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "objects",
        params: { type: { input: "type" }, page: { input: "page" } },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedType: { type: { kind: "scalar", type: "string" } },
      selectedNode: { type: { kind: "object-union", layers: [...platformOntologyLayers] } },
    },
    members: {
      picker: {
        target: { projectionId: pickerProj.id },
        inputs: { type: { state: "selectedType" } },
        outputs: { selected: { state: "selectedNode" } },
      },
    },
    events: {},
  });
  const instance = createPanelInstance(manifest, {
    text: (key) => key,
    pageKey: "frame-picker",
    url: () => "/frame-picker",
    label: () => "Frame picker",
    initial: { selectedType: ACTION },
    ...noOperations,
    recordDraftCreated: async () => {},
    readProjection: async () => pickerProj,
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest },
        manifest,
        instance,
        projection: (id: string) => instance.projection(id),
        invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
        projectionsChanged: () => () => {},
        draft: instance.draft,
        holdUnsaved: () => () => {},
        t: (key: string) => key,
        resources: async () => {},
        expandPageComposer: async () => {},
      });
      return () => h(Projection, { slot: "picker" });
    },
  })).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };

  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Deploy Release"));
  element.querySelector<HTMLButtonElement>(".sdk-object-list-item-btn")!.click();
  await nextTick();
  expect(instance.state.values.value.selectedNode).toEqual({ className: ACTION, primaryKey: "act-1" });
});
