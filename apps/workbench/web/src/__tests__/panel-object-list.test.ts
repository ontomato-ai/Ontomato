/* eslint-disable vue/one-component-per-file */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
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
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * ObjectList, ObjectSummary and SegmentedControl under the Step 2 zero-config member-parameter contract:
 * - M7 BusinessKnowledge pattern: SegmentedControl reading ordered `counts` (`panelGroupCounts`: `[{ key, label, count }]`)
 *   with zero static options; ObjectList inferring search, cursor paging and checkboxes from read signatures and member
 *   bindings, with flattened `status` input, escaped UTF-16 highlights, fallback-to-first (never re-selecting once cleared
 *   to null), and ObjectSummary reading `record` with highlights and pre-wrap body text.
 * - Multi-column table labelKey/emptyKey resolution via `panel.t`, fallback to owner `fieldLabels`, and state events.
 * - Server-side cursor pagination (`runtimeParams: { cursor, size }`), unbound runtime search (`runtimeParams.search`),
 *   and automatic reset to page 1 on search or filter change without double reads.
 * - Single-binding two-way search via `outputs.search` on scalar deepLink panel state (restore, type, clear to null,
 *   external update) sent in `inputs.search` (authored, never `runtimeParams`).
 * - Instance-local checked list (`outputs.checked`) separate from single selection, visible-only select-all across pages,
 *   excluded from deepLink & pageContext, panel event clearing on selection change, partial retention, and type rejection.
 * - M3 dynamic type catalog (`data.objects`: `panelOntologyObjects`): awaiting state with zero reads, runtime `page` and
 *   `search` params, type-switch search & page reset, full `(className, primaryKey)` identity matching, owner labels under
 *   the real object type, and distinct refused/failed/unavailable statuses.
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

type Read = PanelMemberReadRequest;

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

it("pairs zero-config SegmentedControl ordered counts with ObjectList flat status filter, highlights, fallback-to-first, and ObjectSummary", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-tabs": {
      ...meta,
      id: "knowledge-tabs",
      name: "Status tabs",
      componentId: "@ontomato/sdk:SegmentedControl",
      inputs: { search: { kind: "scalar", type: "string" } },
      outputs: { value: { kind: "scalar", type: "string" } },
      config: { ariaLabel: "Knowledge status" },
      data: {
        counts: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "counts",
          params: { by: { literal: "status" } },
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
      },
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        search: { kind: "scalar", type: "string" },
      },
      config: {
        statusField: "status",
        fallbackToFirst: true,
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: {},
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
          params: {},
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
        inputs: { status: { state: "status" } },
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
        return ready([
          { key: "all", label: "All", count: matched.length },
          { key: "pending", label: "Pending", count: matched.filter((entry) => entry.statusValue === "pending").length },
          { key: "approved", label: "Approved", count: matched.filter((entry) => entry.statusValue === "approved").length },
        ]);
      }
      if (request.dataName === "rows") {
        const status = typeof request.inputs.status === "string" ? request.inputs.status : "all";
        const visible = status === "all" ? matched : matched.filter((entry) => entry.statusValue === status);
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
  );

  // Fallback-to-first selects k-1 automatically on initial load.
  await vi.waitFor(() => expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-1")));

  // SegmentedControl derives options directly from ordered panelGroupCounts without static config.options.
  await vi.waitFor(() => {
    const counts = [...element.querySelectorAll(".sdk-segmented-count")].map((node) => node.textContent?.trim());
    expect(counts).toEqual(["2", "1", "1"]);
  });
  const radios = [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios.map((radio) => radio.getAttribute("data-value"))).toEqual(["all", "pending", "approved"]);
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");

  // Re-clicking selected row does not toggle off (toggleable defaults to false).
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

  // Switching status tab via SegmentedControl updates flat `status` input and falls back selection to k-2.
  radios[1]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("pending"));
  await vi.waitFor(() => expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2")));
  expect(radios[1]!.getAttribute("aria-checked")).toBe("true");

  // Once selection is cleared to null (e.g. clicking New), ObjectList does NOT auto-reselect on subsequent reads.
  instance.state.set("selectedKnowledge", null);
  await nextTick();
  radios[0]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("all"));
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(2));
  expect(instance.state.values.value.selectedKnowledge).toBeNull();

  // Keyboard ArrowRight moves to "pending".
  radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await vi.waitFor(() => expect(instance.state.values.value.status).toBe("pending"));
});

it("keeps SegmentedControl interactive with static fallback options when its counts datum fails or is loading", async () => {
  const projections: Record<string, DirectProjection> = {
    "status-tabs": {
      ...meta,
      id: "status-tabs",
      name: "Status tabs",
      componentId: "@ontomato/sdk:SegmentedControl",
      inputs: {},
      outputs: { value: { kind: "scalar", type: "string" } },
      config: {
        ariaLabelKey: "tabs.aria",
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

  const { instance, element } = mountDirect(
    manifest,
    projections,
    () => ({ status: "error", message: "Counts failed" }),
    { messages: { en: { "tabs.aria": "Filter by status" } } },
  );
  await vi.waitFor(() => expect(element.querySelectorAll('[role="radio"]')).toHaveLength(2));
  expect(element.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Filter by status");
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

it("infers cursor pagination and runtime search from query signature, resetting to page 1 in a single read", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-table": {
      ...meta,
      id: "knowledge-table",
      name: "Knowledge",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: {
        columns: [
          { key: "label", labelKey: "cols.title" },
          { key: "status", labelKey: "cols.status" },
        ],
        pageSize: 2,
      },
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
      const search = typeof request.runtimeParams?.search === "string" ? request.runtimeParams.search.toLowerCase() : "";
      const filtered = search ? allItems.filter((item) => item.label.toLowerCase().includes(search)) : allItems;
      const size = typeof request.runtimeParams?.size === "number" ? request.runtimeParams.size : 2;
      const offset = request.runtimeParams?.cursor === "page-2" ? size : 0;
      const pageRows = filtered.slice(offset, offset + size);
      const nextCursor = offset + size < filtered.length ? "page-2" : undefined;
      return ready({
        rows: pageRows,
        total: filtered.length,
        ...(nextCursor ? { nextCursor } : {}),
      });
    },
    { messages: { en: { "cols.title": "Title", "cols.status": "Status" } } },
  );

  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(2));
  expect(reads).toHaveLength(1);
  expect(reads[0]!.inputs).toEqual({});
  expect(reads[0]!.runtimeParams).toEqual({ size: 2 });
  expect(element.querySelector(".sdk-object-list-count")?.textContent).toContain("3");

  // Next page sends runtimeParams { cursor: "page-2", size: 2 }.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(1));
  expect(reads).toHaveLength(2);
  expect(reads[1]!.runtimeParams).toEqual({ cursor: "page-2", size: 2 });

  // Typing search resets cursor to page 1 and triggers ONE read carrying runtimeParams { search: "beta", size: 2 }.
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "beta";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  await nextTick();
  expect(reads).toHaveLength(3);
  expect(reads[2]!.runtimeParams).toEqual({ search: "beta", size: 2 });
  await vi.waitFor(() => expect(element.querySelector("tbody tr td")?.textContent?.trim()).toBe("Beta rule"));

  // Clicking the row selects k-2 and does not toggle off on repeated click.
  element.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2"));
  element.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toEqual(knowledge("k-2"));
});

it("single-binds ObjectList search via outputs.search to deepLink panel state without double reads", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-search": {
      ...meta,
      id: "knowledge-search",
      name: "Knowledge search",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        search: { kind: "scalar", type: "string" },
      },
      config: { pageSize: 10 },
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
      keyword: { type: { kind: "scalar", type: "string" }, deepLink: true },
    },
    members: {
      list: {
        target: { projectionId: "knowledge-search" },
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

  // 1. Initial read carries restored deepLink keyword as authored input and pageSize as runtimeParam.
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  expect(reads[0]!.inputs).toEqual({ search: "timeout" });
  expect(reads[0]!.runtimeParams).toEqual({ size: 10 });
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  expect(searchInput.value).toBe("timeout");

  // 2. Typing a new search writes back to panel state & deepLink with ONE new read.
  searchInput.value = "chart";
  searchInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  await nextTick();
  expect(reads).toHaveLength(2);
  expect(reads[1]!.inputs).toEqual({ search: "chart" });
  expect(reads[1]!.runtimeParams).toEqual({ size: 10 });
  expect(instance.deepLink()).toEqual({ keyword: "chart" });

  // 3. Clearing search writes null so deepLink drops the cleared key.
  searchInput.value = "";
  searchInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(instance.state.values.value.keyword).toBeNull();
  expect(instance.deepLink()).toEqual({});

  // 4. External state update syncs search input and triggers a single re-read.
  instance.state.set("keyword", "external");
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[3]!.inputs).toEqual({ search: "external" });
  expect(searchInput.value).toBe("external");
});

it("infers checkboxes from outputs.checked, freezes visible rows on select-all, and excludes checked from deepLink", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-checked": {
      ...meta,
      id: "knowledge-checked",
      name: "Knowledge",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      config: {
        columns: [{ key: "label", labelKey: "cols.name" }],
        pageSize: 2,
      },
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
      const offset = request.runtimeParams?.cursor === "p2" ? 2 : 0;
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

it("clears declared list state via panel event when ObjectList emits selected, and supports explicit toggleable: true", async () => {
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
      config: { toggleable: true },
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
    events: {
      clearOnSelect: {
        on: { member: "list", output: "selected" },
        do: { set: { fields: { checkedKnowledge: { literal: [] } } } },
      },
    },
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
  await vi.waitFor(() => expect(instance.state.values.value).toEqual({
    selectedKnowledge: knowledge("k-2"),
    checkedKnowledge: [],
  }));

  // With toggleable: true, clicking the already-selected row clears selection to null.
  element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")[1]!.click();
  await nextTick();
  expect(instance.state.values.value.selectedKnowledge).toBeNull();
});

it("supports dynamic type queries via data.objects (panelOntologyObjects) with status separation and identity matching", async () => {
  const pickerProj: DirectProjection = {
    ...meta,
    id: "type-object-picker",
    name: "Type Object Picker",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { type: { kind: "scalar", type: "string" } },
    outputs: { selected: { kind: "object-union", layers: [...platformOntologyLayers] } },
    config: { pageSize: 2 },
    data: {
      objects: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "objects",
        params: { type: { input: "type" } },
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
      const search = typeof request.runtimeParams?.search === "string" ? request.runtimeParams.search.toLowerCase() : "";
      const page = (request.runtimeParams?.page as { number: number; size: number } | undefined) ?? { number: 1, size: 20 };
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
      ].filter((item) => !search || item.label.toLowerCase().includes(search));
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
  );

  // 1) No type selected yet -> DataState awaiting, zero reads, no count/pagination.
  await vi.waitFor(() => {
    expect(element.querySelector('[data-state="awaiting"]')?.textContent).toContain("Select an item first");
  });
  expect(reads).toHaveLength(0);
  expect(element.querySelector(".sdk-object-list-count")).toBeNull();
  expect(element.querySelector(".sdk-object-list-pagination")).toBeNull();

  // 2) Select ACTION -> reads page 1 with runtimeParams { page: { number: 1, size: 2 } }, shows count + pagination.
  instance.state.set("selectedType", ACTION);
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(2));
  expect(reads[0]!.inputs).toEqual({ type: ACTION });
  expect(reads[0]!.runtimeParams).toEqual({ page: { number: 1, size: 2 } });
  expect(element.querySelector(".sdk-object-list-count")?.textContent).toContain("3");
  expect(element.querySelector(".sdk-object-list-pagination")).not.toBeNull();

  // 3) Advance to page 2.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(1));
  expect(reads[1]!.runtimeParams).toEqual({ page: { number: 2, size: 2 } });

  // 4) Typing search resets to page 1 in a single read with runtimeParams.search.
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "deploy";
  searchInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads[2]!.runtimeParams).toEqual({ search: "deploy", page: { number: 1, size: 2 } });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Deploy Action"));

  // 5) Selecting item writes full { className: ACTION, primaryKey: "shared-1" } and registers label under ACTION.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-item-btn")!.click();
  await nextTick();
  expect(instance.state.values.value.start).toEqual({ className: ACTION, primaryKey: "shared-1" });
  expect(instance.pageContext.value.selection).toEqual([
    { kind: ACTION, id: "shared-1", label: expect.stringContaining(`Deploy Action (${ACTION} shared-1)`) },
  ]);

  // 6) Switch to WORKFLOW (same primaryKey "shared-1"): resets search & paging in ONE read, does NOT mis-highlight.
  instance.state.set("selectedType", WORKFLOW);
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[3]!.inputs).toEqual({ type: WORKFLOW });
  expect(reads[3]!.runtimeParams).toEqual({ page: { number: 1, size: 2 } });
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
    inputs: { type: { kind: "scalar", type: "string" } },
    outputs: { selected: { kind: "object-union", layers: [...platformOntologyLayers] } },
    config: { pageSize: 10 },
    data: {
      objects: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "objects",
        params: { type: { input: "type" } },
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
        readPanelData: async () => { throw new Error("This test reads no member data through the platform"); },
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
