/* eslint-disable vue/one-component-per-file */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref } from "vue";
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
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import elementEn from "element-plus/es/locale/lang/en";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * ObjectList, ObjectSummary and SegmentedControl under the Step 2 zero-config member-parameter contract:
 * - M7 BusinessKnowledge pattern: SegmentedControl reading ordered `counts` (`panelGroupCounts`: `[{ key, label, count }]`)
 *   with zero static options; ObjectList inferring search, cursor paging and checkboxes from read signatures and member
 *   bindings, with flattened `status` input, escaped UTF-16 highlights, fallback-to-first (never re-selecting once cleared
 *   to null), and ObjectSummary reading `record` with highlights and pre-wrap body text.
 * - Multi-column table labelKey/emptyKey resolution via `panel.t`, fallback to owner `fieldLabels`, and header commands.
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
    locale?: string;
    i18nMessages?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const activeLocale = options.locale ?? "en";
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const reads: Read[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-list-test",
    url: () => "/panels/object-list",
    label: () => "Object list test",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, ref(activeLocale), "en"),
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
  }).use(createI18n({ legacy: false, locale: activeLocale, messages: (options.i18nMessages ?? { en: publicEn }) as never })).use(ElementPlus);
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
    commands: {},
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
    },
    members: {
      tabs: { target: { projectionId: "status-tabs" }, outputs: { value: { state: "status" } } },
    },
    commands: {},
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
    commands: {
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
    commands: {},
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

  // Load more sends runtimeParams { cursor: "page-2", size: 2 } and appends page 2 to the existing rows.
  const loadMoreBtn = element.querySelector<HTMLButtonElement>(".sdk-object-list-load-more")!;
  expect(loadMoreBtn.textContent?.trim()).toBe(publicEn.platform.listLoadMore);
  expect(loadMoreBtn.disabled).toBe(false);
  loadMoreBtn.click();
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(3));
  expect(reads).toHaveLength(2);
  expect(reads[1]!.runtimeParams).toEqual({ cursor: "page-2", size: 2 });
  expect(element.querySelector<HTMLButtonElement>(".sdk-object-list-load-more")!.disabled).toBe(true);

  // Typing search resets cursor to page 1 and triggers ONE read carrying runtimeParams { search: "beta", size: 2 }.
  const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "beta";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  await nextTick();
  expect(reads).toHaveLength(3);
  expect(reads[2]!.runtimeParams).toEqual({ search: "beta", size: 2 });
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(1));
  expect(element.querySelector("tbody tr td")?.textContent?.trim()).toBe("Beta rule");

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
    commands: {},
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
    commands: {},
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

  // Loading more appends page 2 rows and checking k-3 unions with already-checked items from page 1.
  element.querySelector<HTMLButtonElement>(".sdk-object-list-load-more")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(4));
  const checkboxesAfterLoad = [...element.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
  expect(checkboxesAfterLoad.map((box) => box.checked)).toEqual([true, true, false, false]);
  checkboxesAfterLoad[2]!.click();
  await nextTick();
  expect(instance.state.values.value.checkedKnowledge).toEqual([knowledge("k-1"), knowledge("k-2"), knowledge("k-3")]);

  // The panel clearing checkedKnowledge to [] syncs checkboxes back to unchecked.
  instance.state.set("checkedKnowledge", []);
  await nextTick();
  expect(instance.state.values.value.checkedKnowledge).toEqual([]);
  expect([...element.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every((box) => !box.checked)).toBe(true);

  // External partial retention (e.g. failed item left checked after batch write) reflects in UI and indeterminate state.
  instance.state.set("checkedKnowledge", [knowledge("k-4")]);
  await nextTick();
  const rowBoxes = [...element.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
  expect(rowBoxes.map((box) => box.checked)).toEqual([false, false, false, true]);
  expect(element.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.indeterminate).toBe(true);

  // Wrong objectType inside list state is rejected by checkPanelValue.
  expect(() => instance.state.set("checkedKnowledge", [{ className: SCHEDULED_TASK, primaryKey: "t-1" }])).toThrow(TypeError);
});

it("selects a row without touching the checked list, and supports explicit toggleable: true", async () => {
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
    commands: {},
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
    checkedKnowledge: [knowledge("k-1"), knowledge("k-2")],
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
    commands: {},
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
    commands: {},
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
        notify: () => { throw new Error("This test tells the reader nothing"); }, readPanelData: async () => { throw new Error("This test reads no member data through the platform"); }, navigate: async () => { throw new Error("This test opens no address"); }, currentEntry: computed(() => null), entryMenu: computed(() => null),
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

// A list's columns (the feedback page, 2026-11-22): a short value never breaks onto two lines; a long one ends in an
// ellipsis within the space the table has, its whole text kept as the cell's title; a table wider than its frame scrolls
// inside it; and only a column the panel marks `wrap` runs onto several lines. No column is given a width.
it("keeps short columns on one line, ends long text in an ellipsis, and wraps only a column marked to wrap", async () => {
  const projections: Record<string, DirectProjection> = {
    "feedback-list": {
      ...meta,
      id: "feedback-list",
      name: "Feedback",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
      config: { columns: [{ key: "source" }, { key: "question" }, { key: "answer", wrap: true }] },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
    },
  };
  const manifest = definePanel({
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
    members: { list: { target: { projectionId: "feedback-list" }, outputs: { selected: { state: "selectedTask" } } } },
    commands: {},
  });
  const question = "How many contract staff joined the faculty of engineering after the 2024 reorganisation?";
  const record = { primaryKey: "f-1", label: "Feedback 1", fields: { source: "问答", question, answer: "A long answer the reader reads whole." } };
  const { element } = mountDirect(manifest, projections, () => ready([record]));
  await vi.waitFor(() => expect(element.querySelectorAll("tbody td")).toHaveLength(3));
  const [source, long, answer] = [...element.querySelectorAll<HTMLElement>("tbody td")];
  expect(element.querySelector(".sdk-object-list-table")?.parentElement?.classList.contains("sdk-object-list-table-wrap")).toBe(true);
  expect(source!.className).toBe("");
  expect(long!.classList.contains("sdk-object-list-col-shrink")).toBe(true);
  expect(long!.title).toBe(question);
  expect(answer!.classList.contains("sdk-object-list-col-wrap")).toBe(true);
  expect([...element.querySelectorAll<HTMLElement>("thead th")].map((th) => th.className)).toEqual(["", "sdk-object-list-col-shrink", "sdk-object-list-col-wrap"]);
});

// A time column (the feedback page, 2026-11-22, A's contract; rule by the panelisation lead): the owner gives an ISO
// time; the list shows it in the reader's language and time zone so that neighbours keep their order at a glance — within
// a minute "just now", within an hour minutes ago, today's and yesterday's by their clock time, an older one by its date
// — with the whole time as the cell's title, on one line. A value that is no time is shown as it is, an empty one as the
// column's empty text.
it("shows a time column so neighbouring times keep their order, the whole time in its title", async () => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null, messages: { en: publicEn }, elementLocale: () => elementEn,
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = new Date(2026, 10, 22, 12, 0, 0);
  vi.setSystemTime(now);
  try {
    const projections: Record<string, DirectProjection> = {
      "feedback-list": {
        ...meta,
        id: "feedback-list",
        name: "Feedback",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
        config: { columns: [{ key: "createdAt", kind: "time" }] },
        data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
      },
    };
    const manifest = definePanel({
      state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
      members: { list: { target: { projectionId: "feedback-list" }, outputs: { selected: { state: "selectedTask" } } } },
      commands: {},
    });
    const today = new Date(2026, 10, 22, 6, 14, 46);
    const yesterday = new Date(2026, 10, 21, 6, 14, 42);
    const older = new Date(2026, 10, 20, 22, 14, 41);
    const times = [new Date(now.getTime() - 30_000), new Date(now.getTime() - 5 * 60_000), today, yesterday, older];
    const values = [...times.map((time) => time.toISOString()), "not a time", ""];
    const rows = values.map((createdAt, index) => ({ primaryKey: `f-${index}`, label: `Feedback ${index}`, fields: { createdAt } }));
    const { element } = mountDirect(manifest, projections, () => ready(rows));
    await vi.waitFor(() => expect(element.querySelectorAll("tbody td")).toHaveLength(values.length));
    const cells = [...element.querySelectorAll<HTMLElement>("tbody td")];
    const clock = (time: Date) => time.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
    expect(cells.map((cell) => cell.textContent?.trim())).toEqual([
      "Just now",
      "5 minutes ago",
      `Today ${clock(today)}`,
      `Yesterday ${clock(yesterday)}`,
      older.toLocaleString("en", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      "not a time",
      "—",
    ]);
    expect(cells.slice(0, 5).map((cell) => cell.title)).toEqual(times.map((time) => time.toLocaleString("en")));
    expect(cells.map((cell) => cell.className)).toEqual(values.map(() => ""));
  } finally {
    vi.useRealTimers();
  }
});

// A list with nothing in it says so quietly; a search that finds nothing says nothing matches, so the reader widens it
// instead of thinking there is nothing at all (原页面对照《函数》: the empty and no-hit states differ).
it("tells an empty list from a search that matched nothing", async () => {
  const projections: Record<string, DirectProjection> = {
    "functions-table": {
      ...meta, id: "functions-table", name: "Functions", componentId: "@ontomato/sdk:ObjectList", inputs: {},
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: { columns: [{ key: "label", labelKey: "cols.title" }] },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    members: { list: { target: { projectionId: "functions-table" }, outputs: { selected: { state: "selected" } } } },
    commands: {},
  });
  let items: { primaryKey: string; label: string; fields: Record<string, string> }[] = [];
  const { element } = mountDirect(manifest, projections, (request) => {
    const search = typeof request.runtimeParams?.search === "string" ? request.runtimeParams.search : "";
    const rows = items.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
    return ready({ rows, total: rows.length });
  }, { messages: { en: { "cols.title": "Title" } } });
  const state = () => element.querySelector<HTMLElement>('[data-state="empty"]');

  await vi.waitFor(() => expect(state()?.dataset.empty).toBe("none"));
  expect(state()!.textContent?.trim()).toBe(publicEn.platform.dataEmpty);

  items = [{ primaryKey: "k-1", label: "Revenue", fields: {} }];
  const search = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  search.value = "nothing like it";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(state()?.dataset.empty).toBe("no-match"));
  expect(state()!.querySelector(".fui-data-state-message")?.textContent?.trim()).toBe(publicEn.platform.dataNoMatch);
  const clearBtn = state()!.querySelector<HTMLButtonElement>(".fui-data-state-clear");
  expect(clearBtn?.textContent?.trim()).toBe(publicEn.platform.clearFilters);
  clearBtn!.click();
  await vi.waitFor(() => expect(element.querySelector("tbody tr td")?.textContent?.trim()).toBe("Revenue"));
  expect(search.value).toBe("");
});

it("activates table rows from the keyboard without colliding with inner checkboxes or links", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-table": {
      ...meta,
      id: "knowledge-table",
      name: "Knowledge table",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      config: {
        toggleable: true,
        columns: [
          { key: "label", labelKey: "cols.title" },
          { key: "owner", labelKey: "cols.owner" },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    },
    members: {
      list: {
        target: { projectionId: "knowledge-table" },
        outputs: { selected: { state: "selected" }, checked: { state: "checked" } },
      },
    },
    commands: {},
  });
  const rows = [
    { primaryKey: "k-1", label: "First rule", fields: { owner: "Alice" } },
    { primaryKey: "k-2", label: "Second rule", fields: { owner: "Bob" } },
    { primaryKey: "k-3", label: "Third rule", fields: { owner: "Cara" } },
  ];
  const { instance, element } = mountDirect(manifest, projections, () => ready({ rows, total: rows.length }), {
    messages: { en: { "cols.title": "Title", "cols.owner": "Owner" } },
  });
  await vi.waitFor(() => expect(element.querySelectorAll("tbody tr")).toHaveLength(3));
  const tableRows = [...element.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  expect(tableRows.every((row) => row.getAttribute("tabindex") === "0")).toBe(true);

  // Focusing a row and pressing Enter selects it.
  tableRows[0]!.focus();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  tableRows[0]!.dispatchEvent(enter);
  await nextTick();
  expect(enter.defaultPrevented).toBe(true);
  expect(instance.state.values.value.selected).toEqual(knowledge("k-1"));
  expect(tableRows[0]!.getAttribute("aria-selected")).toBe("true");

  // Pressing Space on the selected row toggles it off when toggleable is enabled, preventing page scroll.
  const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  tableRows[0]!.dispatchEvent(space);
  await nextTick();
  expect(space.defaultPrevented).toBe(true);
  expect(instance.state.values.value.selected).toBeNull();

  // Modified keys on a row do not trigger selection.
  tableRows[1]!.focus();
  const ctrlEnter = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
  tableRows[1]!.dispatchEvent(ctrlEnter);
  await nextTick();
  expect(ctrlEnter.defaultPrevented).toBe(false);
  expect(instance.state.values.value.selected).toBeNull();

  // ArrowDown / ArrowUp / Home / End move focus between table rows.
  tableRows[0]!.focus();
  tableRows[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tableRows[1]);
  tableRows[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tableRows[2]);
  tableRows[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tableRows[1]);
  tableRows[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tableRows[0]);

  // Enter/Space originating from an inner checkbox or interactive button inside a cell does not activate the row.
  const checkbox = tableRows[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.focus();
  const checkboxSpace = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  checkbox.dispatchEvent(checkboxSpace);
  await nextTick();
  expect(checkboxSpace.defaultPrevented).toBe(false);
  expect(instance.state.values.value.selected).toBeNull();

  const innerButton = document.createElement("button");
  innerButton.type = "button";
  tableRows[1]!.querySelector("td:last-child")!.appendChild(innerButton);
  innerButton.focus();
  const buttonEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  innerButton.dispatchEvent(buttonEnter);
  await nextTick();
  expect(buttonEnter.defaultPrevented).toBe(false);
  expect(instance.state.values.value.selected).toBeNull();
});

it("outputs listed references for the current batch (current page when paged, all rows when unpaged) without extra reads", async () => {
  const projections: Record<string, DirectProjection> = {
    "knowledge-query": {
      ...meta,
      id: "knowledge-query",
      name: "Knowledge query",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { search: { kind: "scalar", type: "string" } },
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        listed: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
        search: { kind: "scalar", type: "string" },
      },
      config: { pageSize: 2 },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      keyword: { type: { kind: "scalar", type: "string" }, deepLink: true },
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      listed: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    },
    members: {
      list: {
        target: { projectionId: "knowledge-query" },
        outputs: { selected: { state: "selected" }, listed: { state: "listed" }, search: { state: "keyword" } },
      },
    },
    commands: {},
  });

  const allRows = [
    { primaryKey: "k-1", label: "Alpha rule", fields: {} },
    { primaryKey: "k-2", label: "Beta rule", fields: {} },
    { primaryKey: "k-3", label: "Gamma rule", fields: {} },
  ];
  let deferredPage2: ((response: ProductPanelReadResponse) => void) | null = null;
  let forceForbidden = false;

  const { instance, element, reads } = mountDirect(manifest, projections, (request) => {
    if (forceForbidden) return { status: "forbidden" };
    const search = typeof request.inputs.search === "string" ? request.inputs.search.trim().toLowerCase() : "";
    const matched = search ? allRows.filter((row) => row.label.toLowerCase().includes(search)) : allRows;
    const cursor = request.runtimeParams?.cursor;
    if (cursor === "page-2") {
      return new Promise<ProductPanelReadResponse>((resolve) => {
        deferredPage2 = resolve;
      });
    }
    const pageRows = matched.slice(0, 2);
    return ready({
      rows: pageRows,
      total: matched.length,
      ...(matched.length > 2 ? { nextCursor: "page-2" } : {}),
    });
  });

  // Page 1 publishes only the current page's refs without triggering a second read.
  await vi.waitFor(() => expect(instance.state.values.value.listed).toEqual([knowledge("k-1"), knowledge("k-2")]));
  expect(reads).toHaveLength(1);
  // Listed refs are collection state, never deep-linked or reported as user selection in pageContext.
  expect(instance.deepLink()).toEqual({});
  expect(instance.pageContext.value.selection).toEqual([]);

  // While page 2 is still loading via Load more, listed retains page 1's refs instead of flickering to [].
  const loadMoreBtn = element.querySelector<HTMLButtonElement>(".sdk-object-list-load-more")!;
  loadMoreBtn.click();
  await vi.waitFor(() => expect(deferredPage2).not.toBeNull());
  expect(loadMoreBtn.disabled).toBe(true);
  expect(loadMoreBtn.getAttribute("aria-busy")).toBe("true");
  expect(instance.state.values.value.listed).toEqual([knowledge("k-1"), knowledge("k-2")]);

  // Once page 2 settles, listed appends page 2's refs so it matches the loaded batch.
  deferredPage2!(ready({ rows: [allRows[2]!], total: 3 }));
  await vi.waitFor(() => expect(instance.state.values.value.listed).toEqual([knowledge("k-1"), knowledge("k-2"), knowledge("k-3")]));
  expect(reads).toHaveLength(2);

  // Narrowing to zero matches clears listed to [].
  const search = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  search.value = "nomatch";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(instance.state.values.value.listed).toEqual([]));

  // Narrowing back to one match publishes that match, and a subsequent forbidden read clears it to [].
  search.value = "beta";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(instance.state.values.value.listed).toEqual([knowledge("k-2")]));

  forceForbidden = true;
  search.value = "gamma";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(instance.state.values.value.listed).toEqual([]));
});

it("outputs all matching references when the list read does not page", async () => {
  const projections: Record<string, DirectProjection> = {
    "task-list": {
      ...meta,
      id: "task-list",
      name: "Scheduled tasks",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        listed: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } },
      },
      config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      listedTasks: { type: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } } },
    },
    members: {
      list: {
        target: { projectionId: "task-list" },
        outputs: { listed: { state: "listedTasks" } },
      },
    },
    commands: {},
  });
  const rows = [
    { primaryKey: "t-1", label: "Daily sync", fields: {} },
    { primaryKey: "t-2", label: "Weekly audit", fields: {} },
  ];
  const { instance, reads } = mountDirect(manifest, projections, () => ready(rows));
  await vi.waitFor(() => expect(instance.state.values.value.listedTasks).toEqual([
    { className: SCHEDULED_TASK, primaryKey: "t-1" },
    { className: SCHEDULED_TASK, primaryKey: "t-2" },
  ]));
  expect(reads).toHaveLength(1);
});

it("renders all 6 PanelRecordFieldValue types in ObjectList and ObjectSummary with localized booleans, references, arrays, and highlights", async () => {
  const projections: Record<string, DirectProjection> = {
    "universal-table": {
      ...meta,
      id: "universal-table",
      name: "Universal records",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        owner: { kind: "object", objectType: USER },
        navigate: { kind: "object", objectType: ROLE },
      },
      config: {
        columns: [
          { key: "title", labelKey: "cols.title" },
          { key: "score", labelKey: "cols.score" },
          { key: "enabled", labelKey: "cols.enabled" },
          { key: "archived", labelKey: "cols.archived" },
          { key: "owner", labelKey: "cols.owner" },
          { key: "meta", labelKey: "cols.meta" },
          { key: "related", labelKey: "cols.related" },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
    "universal-summary": {
      ...meta,
      id: "universal-summary",
      name: "Universal summary",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { item: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      outputs: {
        owner: { kind: "object", objectType: USER },
        navigate: { kind: "object", objectType: ROLE },
      },
      config: { fields: ["title", "score", "enabled", "archived", "owner", "meta", "related"] },
      data: { record: { source: { object: { input: "item" } }, read: "record", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      focusedOwner: { type: { kind: "object", objectType: USER } },
      navigatedRole: { type: { kind: "object", objectType: ROLE } },
    },
    members: {
      list: {
        target: { projectionId: "universal-table" },
        outputs: {
          selected: { state: "selected" },
          owner: { state: "focusedOwner" },
          navigate: { state: "navigatedRole" },
        },
      },
      summary: {
        target: { projectionId: "universal-summary" },
        inputs: { item: { state: "selected" } },
        outputs: {
          owner: { state: "focusedOwner" },
          navigate: { state: "navigatedRole" },
        },
      },
    },
    commands: {},
  });
  const universalRecord = {
    primaryKey: "k-uni",
    label: "Revenue policy",
    fields: {
      title: { kind: "localized" as const, values: { "zh-CN": "营收口径", en: "Revenue definition" } },
      score: 0,
      enabled: true,
      archived: false,
      owner: { kind: "reference" as const, className: USER, primaryKey: "u-1", label: "Alice" },
      meta: { kind: "json" as const, value: { version: 2, strict: true } },
      related: [
        "finance",
        42,
        false,
        { kind: "reference" as const, className: ROLE, primaryKey: "r-1", label: "Auditor" },
      ],
    },
    highlights: {
      title: [{ start: 0, end: 2 }],
      owner: [{ start: 0, end: 3 }],
    },
  };

  const zhMessages = {
    "zh-CN": {
      ...publicEn,
      platform: { ...publicEn.platform, booleanTrue: "是", booleanFalse: "否" },
    },
  };
  const { instance, element } = mountDirect(
    manifest,
    projections,
    (request) => ready(request.dataName === "rows" ? { rows: [universalRecord], total: 1 } : universalRecord),
    {
      locale: "zh-CN",
      i18nMessages: zhMessages,
      messages: {
        en: {
          "cols.title": "Title",
          "cols.score": "Score",
          "cols.enabled": "Enabled",
          "cols.archived": "Archived",
          "cols.owner": "Owner",
          "cols.meta": "Meta",
          "cols.related": "Related",
        },
      },
    },
  );

  await vi.waitFor(() => expect(element.querySelectorAll("tbody td")).toHaveLength(7));
  const cells = [...element.querySelectorAll<HTMLElement>("tbody td")];
  // 1. localized with highlight
  expect(cells[0]!.textContent?.trim()).toBe("营收口径");
  expect(cells[0]!.querySelector("mark")?.textContent).toBe("营收");
  // 2. number 0 (must not fall back to empty dash)
  expect(cells[1]!.textContent?.trim()).toBe("0");
  // 3-4. localized booleans
  expect(cells[2]!.textContent?.trim()).toBe("是");
  expect(cells[3]!.textContent?.trim()).toBe("否");
  // 5. reference with highlight -> routes to named `owner` output
  const ownerBtn = cells[4]!.querySelector<HTMLButtonElement>(".sdk-object-ref-link")!;
  expect(ownerBtn.textContent?.trim()).toBe("Alice");
  expect(ownerBtn.querySelector("mark")?.textContent).toBe("Ali");
  ownerBtn.click();
  await vi.waitFor(() => expect(instance.state.values.value.focusedOwner).toEqual({ className: USER, primaryKey: "u-1" }));
  // 6. json payload summary
  expect(cells[5]!.textContent?.trim()).toBe('{"version":2,"strict":true}');
  // 7. mixed array: scalar tags (including localized boolean) + clickable reference -> routes to `navigate`
  const arrayTags = [...cells[6]!.querySelectorAll(".sdk-object-list-tag")].map((el) => el.textContent?.trim());
  expect(arrayTags).toEqual(["finance", "42", "否"]);
  const relatedRefBtn = cells[6]!.querySelector<HTMLButtonElement>(".sdk-object-ref-link")!;
  expect(relatedRefBtn.textContent?.trim()).toBe("Auditor");
  relatedRefBtn.click();
  await vi.waitFor(() => expect(instance.state.values.value.navigatedRole).toEqual({ className: ROLE, primaryKey: "r-1" }));

  // Select row to inspect ObjectSummary rendering of the same 6 universal field types
  element.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-summary dd")).toHaveLength(7));
  const summaryValues = [...element.querySelectorAll<HTMLElement>(".sdk-object-summary dd")];
  expect(summaryValues[0]!.textContent?.trim()).toBe("营收口径");
  expect(summaryValues[0]!.querySelector("mark")?.textContent).toBe("营收");
  expect(summaryValues[1]!.textContent?.trim()).toBe("0");
  expect(summaryValues[2]!.textContent?.trim()).toBe("是");
  expect(summaryValues[3]!.textContent?.trim()).toBe("否");
  expect(summaryValues[4]!.querySelector<HTMLButtonElement>(".sdk-object-ref-link")?.textContent?.trim()).toBe("Alice");
  expect(summaryValues[5]!.textContent?.trim()).toBe('{"version":2,"strict":true}');
  expect([...summaryValues[6]!.querySelectorAll(".sdk-object-summary-tag")].map((el) => el.textContent?.trim())).toEqual([
    "finance", "42", "否",
  ]);
  expect(summaryValues[6]!.querySelector<HTMLButtonElement>(".sdk-object-ref-link")?.textContent?.trim()).toBe("Auditor");
});

it("resolves heterogeneous className row identity via panelRecordObjectRef and renders universal fields in compact list without [object Object]", async () => {
  const unionType = { kind: "object-union" as const, objectTypes: [ACTION, WORKFLOW] as [string, ...string[]] };
  const projections: Record<string, DirectProjection> = {
    "mixed-list": {
      ...meta,
      id: "mixed-list",
      name: "Mixed items",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: unionType,
      },
      config: {
        statusField: "status",
        subtitleField: "summary",
        tagsField: "badges",
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: ACTION } }, read: "list", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: unionType, deepLink: true },
    },
    members: {
      list: {
        target: { projectionId: "mixed-list" },
        outputs: { selected: { state: "selected" } },
      },
    },
    commands: {},
  });
  const rows = [
    {
      primaryKey: "a-1",
      className: ACTION,
      label: "Approve order",
      fields: {
        status: { kind: "localized" as const, values: { en: "Active" } },
        summary: { kind: "localized" as const, values: { en: "Approves pending orders" } },
        badges: ["v2", true],
      },
      tones: { status: "success" as const },
    },
    {
      primaryKey: "w-1",
      className: WORKFLOW,
      label: "Fulfill order",
      fields: {
        status: false,
        summary: { kind: "json" as const, value: { steps: 3 } },
        badges: ["auto"],
      },
    },
  ];
  const { instance, element } = mountDirect(manifest, projections, () => ready(rows));
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list [role='option']")).toHaveLength(2));
  expect(element.textContent).not.toContain("[object Object]");

  const items = [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-list [role='option']")];
  expect(items[0]!.querySelector(".sdk-object-list-item-head .sdk-object-list-tag")?.textContent?.trim()).toBe("Active");
  expect(items[0]!.querySelector(".sdk-object-list-item-sub")?.textContent?.trim()).toBe("Approves pending orders");
  expect([...items[0]!.querySelectorAll(".sdk-object-list-item-tags .sdk-object-list-tag")].map((el) => el.textContent?.trim())).toEqual([
    "v2", "Yes",
  ]);
  expect(items[1]!.querySelector(".sdk-object-list-item-head .sdk-object-list-tag")?.textContent?.trim()).toBe("No");
  expect(items[1]!.querySelector(".sdk-object-list-item-sub")?.textContent?.trim()).toBe('{"steps":3}');

  // Selecting each heterogeneous row writes its own `className` and registers owner labels under that className.
  items[1]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual({ className: WORKFLOW, primaryKey: "w-1" }));
  expect(instance.pageContext.value.selection[0]?.label).toContain("Fulfill order");

  items[0]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual({ className: ACTION, primaryKey: "a-1" }));
  expect(instance.pageContext.value.selection[0]?.label).toContain("Approve order");
});

it("renders layout='cards' with columns, status, tags, selection, keyboard activation, and checkboxes", async () => {
  const projections: Record<string, DirectProjection> = {
    "cards-list": {
      ...meta,
      id: "cards-list",
      name: "Knowledge cards",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
        navigate: { kind: "object", objectType: USER },
      },
      config: {
        layout: "cards",
        statusField: "status",
        subtitleField: "summary",
        tagsField: "topics",
        columns: [
          { key: "owner", labelKey: "cols.owner" },
          { key: "updatedAt", labelKey: "cols.updatedAt", kind: "time", timeFormat: "date" },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true },
      checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
      navigated: { type: { kind: "object", objectType: USER } },
    },
    members: {
      list: {
        target: { projectionId: "cards-list" },
        outputs: { selected: { state: "selected" }, checked: { state: "checked" }, navigate: { state: "navigated" } },
      },
    },
    commands: {},
  });
  const ts = "2026-11-18T09:15:30.000Z";
  const rows = [
    {
      primaryKey: "k-1",
      label: "Pricing guide",
      fields: {
        status: "Published",
        summary: "How tiers are calculated",
        owner: { kind: "reference" as const, className: USER, primaryKey: "u-9", label: "Dana" },
        updatedAt: ts,
        topics: ["sales", "billing"],
      },
      tones: { status: "success" as const },
    },
    {
      primaryKey: "k-2",
      label: "Discount rules",
      fields: {
        status: "Draft",
        summary: "Approval limits",
        owner: { kind: "reference" as const, className: USER, primaryKey: "u-10", label: "Evan" },
        updatedAt: ts,
        topics: ["finance"],
      },
      tones: { status: "warning" as const },
    },
  ];
  const { instance, element } = mountDirect(manifest, projections, () => ready({ rows, total: rows.length }), {
    messages: { en: { "cols.owner": "Owner", "cols.updatedAt": "Updated" } },
  });

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-card")).toHaveLength(2));
  expect(element.querySelector("table")).toBeNull();
  const cards = [...element.querySelectorAll<HTMLElement>(".sdk-object-list-card")];
  expect(cards[0]!.getAttribute("tabindex")).toBe("0");
  expect(cards[0]!.querySelector(".sdk-object-list-card-title")?.textContent?.trim()).toBe("Pricing guide");
  expect(cards[0]!.querySelector(".sdk-object-list-card-sub")?.textContent?.trim()).toBe("How tiers are calculated");
  expect(cards[0]!.querySelector(".sdk-object-list-card-head .sdk-object-list-tag")?.textContent?.trim()).toBe("Published");
  expect([...cards[0]!.querySelectorAll(".sdk-object-list-card-tags .sdk-object-list-tag")].map((el) => el.textContent?.trim())).toEqual([
    "sales", "billing",
  ]);
  const expectedDate = new Date(ts).toLocaleDateString("en", { year: "numeric", month: "2-digit", day: "2-digit" });
  expect(cards[0]!.querySelectorAll(".sdk-object-list-card-field-value")[1]?.textContent?.trim()).toBe(expectedDate);

  // Reference link inside card navigates without selecting the card.
  cards[0]!.querySelector<HTMLButtonElement>(".sdk-object-ref-link")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.navigated).toEqual({ className: USER, primaryKey: "u-9" }));
  expect(instance.state.values.value.selected).toBeNull();

  // Checkbox inside card toggles checked without selecting the card.
  const checkbox = cards[0]!.querySelector<HTMLInputElement>(".sdk-object-list-card-check")!;
  checkbox.click();
  await vi.waitFor(() => expect(instance.state.values.value.checked).toEqual([knowledge("k-1")]));
  expect(instance.state.values.value.selected).toBeNull();

  // Clicking card selects it and highlights with .chosen + aria-selected="true".
  cards[0]!.click();
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual(knowledge("k-1")));
  expect(cards[0]!.classList.contains("chosen")).toBe(true);
  expect(cards[0]!.getAttribute("aria-selected")).toBe("true");

  // Keyboard navigation + Enter activates the second card.
  cards[0]!.focus();
  cards[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(cards[1]);
  cards[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(instance.state.values.value.selected).toEqual(knowledge("k-2")));
});

it("formats kind='time' columns according to timeFormat ('datetime' and 'date') while keeping full local time in title", async () => {
  const projections: Record<string, DirectProjection> = {
    "time-table": {
      ...meta,
      id: "time-table",
      name: "Timed items",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        columns: [
          { key: "createdAt", labelKey: "cols.datetime", kind: "time", timeFormat: "datetime" },
          { key: "publishedAt", labelKey: "cols.date", kind: "time", timeFormat: "date" },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {},
    members: { list: { target: { projectionId: "time-table" } } },
    commands: {},
  });
  const stamp = "2026-11-22T06:05:09.000Z";
  const rows = [
    { primaryKey: "k-t1", label: "Item 1", fields: { createdAt: stamp, publishedAt: stamp } },
    { primaryKey: "k-t2", label: "Item 2", fields: { createdAt: "invalid-ts", publishedAt: "" } },
  ];
  const { element } = mountDirect(manifest, projections, () => ready({ rows, total: rows.length }), {
    messages: { en: { "cols.datetime": "Exact time", "cols.date": "Date" } },
  });

  await vi.waitFor(() => expect(element.querySelectorAll("tbody td")).toHaveLength(4));
  const cells = [...element.querySelectorAll<HTMLElement>("tbody td")];
  const parsed = new Date(stamp);
  expect(cells[0]!.textContent?.trim()).toBe(parsed.toLocaleString("en", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }));
  expect(cells[0]!.title).toBe(parsed.toLocaleString("en"));
  expect(cells[1]!.textContent?.trim()).toBe(parsed.toLocaleDateString("en", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }));
  expect(cells[1]!.title).toBe(parsed.toLocaleString("en"));
  expect(cells[2]!.textContent?.trim()).toBe("invalid-ts");
  expect(cells[2]!.title).toBe("");
  expect(cells[3]!.textContent?.trim()).toBe("—");
});

it("renders total count, clickable numeric page jump buttons, and ellipsis folding in pageMode='page'", async () => {
  const projections: Record<string, DirectProjection> = {
    "paged-objects": {
      ...meta,
      id: "paged-objects",
      name: "Paged objects",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { type: { kind: "scalar", type: "string" } },
      outputs: {},
      config: { pageSize: 10 },
      data: {
        objects: {
          source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
          read: "objects",
          params: { type: { input: "type" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selectedType: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      list: {
        target: { projectionId: "paged-objects" },
        inputs: { type: { state: "selectedType" } },
      },
    },
    commands: {},
  });

  const { element, reads } = mountDirect(
    manifest,
    projections,
    (request) => {
      const page = (request.runtimeParams?.page as { number: number; size: number } | undefined)?.number ?? 1;
      return ready({
        status: "ok",
        type: USER,
        layer: "governance",
        page,
        pageSize: 10,
        total: 120,
        items: [{ node: { className: USER, primaryKey: `u-${page}` }, label: `User page ${page}` }],
      });
    },
    { initial: { selectedType: USER } },
  );

  // Page 1 of 12: [1, 2, …, 12] + total count
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-pagination")).not.toBeNull());
  expect(element.querySelector(".sdk-object-list-page-total")?.textContent?.trim()).toBe("120 items");
  const pageButtons = () => [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-page-num")];
  expect(pageButtons().map((btn) => btn.textContent?.trim())).toEqual(["1", "2", "12"]);
  expect(pageButtons()[0]!.getAttribute("aria-current")).toBe("page");
  expect(pageButtons()[0]!.classList.contains("active")).toBe(true);
  expect(element.querySelectorAll(".sdk-object-list-page-ellipsis")).toHaveLength(1);

  // Jump directly to page 12
  pageButtons()[2]!.click();
  await vi.waitFor(() => expect(reads.at(-1)?.runtimeParams?.page).toEqual({ number: 12, size: 10 }));
  await vi.waitFor(() => expect(element.textContent).toContain("User page 12"));
  expect(pageButtons().map((btn) => btn.textContent?.trim())).toEqual(["1", "11", "12"]);
  expect(pageButtons()[2]!.getAttribute("aria-current")).toBe("page");
  expect(element.querySelectorAll(".sdk-object-list-page-ellipsis")).toHaveLength(1);

  // Jump to page 11 -> [1, …, 10, 11, 12]
  pageButtons()[1]!.click();
  await vi.waitFor(() => expect(reads.at(-1)?.runtimeParams?.page).toEqual({ number: 11, size: 10 }));
  await vi.waitFor(() => expect(pageButtons().map((btn) => btn.textContent?.trim())).toEqual(["1", "10", "11", "12"]));
  expect(pageButtons()[2]!.getAttribute("aria-current")).toBe("page");

  // Jump to page 10 -> [1, …, 9, 10, 11, 12] (trailing ellipsis collapses when window reaches 11)
  pageButtons()[1]!.click();
  await vi.waitFor(() => expect(reads.at(-1)?.runtimeParams?.page).toEqual({ number: 10, size: 10 }));
  await vi.waitFor(() => expect(pageButtons().map((btn) => btn.textContent?.trim())).toEqual(["1", "9", "10", "11", "12"]));
  expect(element.querySelectorAll(".sdk-object-list-page-ellipsis")).toHaveLength(1);

  // Jump to page 9 -> [1, …, 8, 9, 10, …, 12] (both ellipses shown)
  pageButtons()[1]!.click();
  await vi.waitFor(() => expect(reads.at(-1)?.runtimeParams?.page).toEqual({ number: 9, size: 10 }));
  await vi.waitFor(() => expect(pageButtons().map((btn) => btn.textContent?.trim())).toEqual(["1", "8", "9", "10", "12"]));
  expect(element.querySelectorAll(".sdk-object-list-page-ellipsis")).toHaveLength(2);
});

it("applies single-line vs two-line list row density, fixed table height tokens, and left-total/right-pager footer layout", async () => {
  const projections: Record<string, DirectProjection> = {
    "single-line-list": {
      ...meta,
      id: "single-line-list",
      name: "Single line",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: { statusField: "status" },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
    "two-line-list": {
      ...meta,
      id: "two-line-list",
      name: "Two line",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: { subtitleField: "summary", statusField: "status" },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      a: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      b: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    },
    members: {
      single: { target: { projectionId: "single-line-list" }, outputs: { selected: { state: "a" } } },
      twoLine: { target: { projectionId: "two-line-list" }, outputs: { selected: { state: "b" } } },
    },
    commands: {},
  });

  const { element } = mountDirect(manifest, projections, () => ready({
    rows: [
      { primaryKey: "k-1", label: "Order", fields: { status: "Active", summary: "Customer purchase order" }, tones: { status: "success" } },
    ],
    total: 1,
  }));

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-items")).toHaveLength(2));
  const [singleUl, twoLineUl] = [...element.querySelectorAll<HTMLElement>(".sdk-object-list-items")];
  expect(singleUl!.dataset.rowDensity).toBe("single");
  expect(singleUl!.querySelector(".sdk-object-list-item-btn")?.classList.contains("sdk-object-list-item-two-line")).toBe(false);
  expect(twoLineUl!.dataset.rowDensity).toBe("two-line");
  expect(twoLineUl!.querySelector(".sdk-object-list-item-btn")?.classList.contains("sdk-object-list-item-two-line")).toBe(true);

  // Total count is shown in the fixed bottom footer whenever the owner returns `total`, even on a single page.
  const footers = [...element.querySelectorAll<HTMLElement>(".sdk-object-list-footer")];
  expect(footers).toHaveLength(2);
  expect(footers[0]!.querySelector(".sdk-object-list-page-total")?.textContent?.trim()).toBe("1 items");

  // Verify paradigm CSS tokens for row heights and table heights.
  const repoRoot = resolve(import.meta.dirname, "../../../../..");
  const objectListSource = readFileSync(
    resolve(repoRoot, "packages/apps-sdk/src/base/ObjectList.vue"),
    "utf8",
  );
  expect(objectListSource).toContain("min-height: var(--list-row-height, 44px);");
  expect(objectListSource).toContain("min-height: var(--list-row-two-line-height, 60px);");
  expect(objectListSource).toContain("height: var(--table-head-height, 36px);");
  expect(objectListSource).toContain("height: var(--table-row-height, 40px);");
});

it("scrolls the selected row into view when primaryKey changes and tolerates environments without scrollIntoView", async () => {
  const projections: Record<string, DirectProjection> = {
    "scroll-list": {
      ...meta,
      id: "scroll-list",
      name: "Scrollable",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE }, deepLink: true } },
    members: { list: { target: { projectionId: "scroll-list" }, outputs: { selected: { state: "selected" } } } },
    commands: {},
  });

  const { instance, element } = mountDirect(manifest, projections, () => ready({
    rows: [
      { primaryKey: "k-1", label: "First", fields: {} },
      { primaryKey: "k-2", label: "Second", fields: {} },
      { primaryKey: "k-3", label: "Third", fields: {} },
    ],
    total: 3,
  }));

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-row")).toHaveLength(3));
  const rowEls = [...element.querySelectorAll<HTMLElement>(".sdk-object-list-row")];
  const spy2 = vi.fn();
  rowEls[1]!.scrollIntoView = spy2;

  instance.state.set("selected", knowledge("k-2"));
  await vi.waitFor(() => expect(spy2).toHaveBeenCalledWith({ block: "nearest" }));

  // Missing scrollIntoView (e.g. JSDOM) must not throw.
  Object.defineProperty(rowEls[2]!, "scrollIntoView", { value: undefined, configurable: true });
  expect(() => instance.state.set("selected", knowledge("k-3"))).not.toThrow();
  await nextTick();
  expect(rowEls[2]!.classList.contains("chosen")).toBe(true);
});

it("clears search and optional filter parameters back to page 1 from the narrowed empty state, supports emptyHint, and shows forbidden reasons", async () => {
  const projections: Record<string, DirectProjection> = {
    "filtered-list": {
      ...meta,
      id: "filtered-list",
      name: "Filtered",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        status: { kind: "scalar", type: "string" },
        search: { kind: "scalar", type: "string" },
      },
      outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      config: { emptyHint: "empty.hint", pageSize: 2 },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { status: { input: "status" }, search: { input: "search" } },
        },
      },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      statusFilter: { type: { kind: "scalar", type: "string" } },
      keyword: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      list: {
        target: { projectionId: "filtered-list" },
        inputs: { status: { state: "statusFilter" }, search: { state: "keyword" } },
        outputs: { selected: { state: "selected" } },
      },
    },
    commands: {},
  });

  let mode: "empty" | "normal" | "forbidden-reason" | "forbidden-default" = "empty";
  const allRows = [
    { primaryKey: "k-1", label: "Alpha", fields: { status: "active" } },
    { primaryKey: "k-2", label: "Beta", fields: { status: "draft" } },
  ];

  const { instance, element, reads } = mountDirect(
    manifest,
    projections,
    (request) => {
      if (mode === "forbidden-reason") return { status: "forbidden", reason: "Requires ontology maintainer role" };
      if (mode === "forbidden-default") return { status: "forbidden" };
      if (mode === "empty") return ready({ rows: [], total: 0 });
      const search = typeof request.inputs.search === "string" ? request.inputs.search.toLowerCase() : "";
      const status = typeof request.inputs.status === "string" ? request.inputs.status : "";
      const matched = allRows.filter(
        (row) => (!search || row.label.toLowerCase().includes(search)) && (!status || row.fields.status === status),
      );
      return ready({ rows: matched, total: matched.length });
    },
    { messages: { en: { "empty.hint": "Click New in the header to create one" } } },
  );

  // Un-narrowed empty shows emptyHint and no Clear filters button.
  await vi.waitFor(() => expect(element.querySelector('[data-state="empty"]')?.getAttribute("data-empty")).toBe("none"));
  expect(element.querySelector(".fui-data-state-hint")?.textContent?.trim()).toBe("Click New in the header to create one");
  expect(element.querySelector(".fui-data-state-clear")).toBeNull();

  // Switch to normal data and apply both search + status filter so nothing matches.
  mode = "normal";
  instance.state.set("statusFilter", "archived");
  instance.state.set("keyword", "ghost");
  await vi.waitFor(() => expect(element.querySelector('[data-state="empty"]')?.getAttribute("data-empty")).toBe("no-match"));
  expect(element.querySelector(".fui-data-state-hint")).toBeNull();

  // Clicking Clear filters resets search, optional filter params, and paging in one read.
  const readsBeforeClear = reads.length;
  element.querySelector<HTMLButtonElement>(".fui-data-state-clear")!.click();
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-row")).toHaveLength(2));
  expect(reads.length).toBe(readsBeforeClear + 1);
  expect(instance.state.values.value.keyword).toBeNull();
  expect(instance.state.values.value.statusFilter).toBeNull();
  expect(reads.at(-1)?.runtimeParams?.cursor).toBeUndefined();

  // Forbidden with owner-supplied reason displays that reason; without reason falls back to platform.dataForbidden.
  mode = "forbidden-reason";
  instance.state.set("keyword", "check-reason");
  await vi.waitFor(() => expect(element.querySelector('[data-state="forbidden"]')).not.toBeNull());
  expect(element.querySelector(".fui-data-state-message")?.textContent?.trim()).toBe("Requires ontology maintainer role");

  mode = "forbidden-default";
  instance.state.set("keyword", "check-default");
  await vi.waitFor(() => expect(element.querySelector(".fui-data-state-message")?.textContent?.trim()).toBe(publicEn.platform.dataForbidden));
});

it("renders #filters, #bulk-actions, #toolbar-actions, and #create-row inline create block", async () => {
  const projections: Record<string, DirectProjection> = {
    "slotted-list": {
      ...meta,
      id: "slotted-list",
      name: "Slotted",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
        checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    },
    members: {
      list: {
        target: { projectionId: "slotted-list" },
        outputs: { selected: { state: "selected" }, checked: { state: "checked" } },
      },
    },
    commands: {},
  });

  const showCreate = ref(false);
  const bulkClicked = vi.fn();
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "slotted-list-test",
    url: () => "/panels/slotted-list",
    label: () => "Slotted list test",
    recordDraftCreated: async () => {},
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async () => ready({
      rows: [
        { primaryKey: "k-1", label: "First item", fields: {} },
        { primaryKey: "k-2", label: "Second item", fields: {} },
      ],
      total: 2,
    }),
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h(
      PanelMember,
      { instance, member: "list" },
      {
        filters: () => h("span", { class: "test-filter-chip" }, "Status: All"),
        "bulk-actions": (scope: { checked: readonly unknown[]; clear: () => void }) =>
          h("button", { class: "test-bulk-btn", onClick: () => { bulkClicked(scope.checked.length); scope.clear(); } }, `Delete (${scope.checked.length})`),
        "toolbar-actions": () => h("button", { class: "test-add-btn", onClick: () => { showCreate.value = true; } }, "Add item"),
        "create-row": () => (showCreate.value ? h("div", { class: "test-create-form" }, "New item form") : null),
      },
    ),
  }).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-row")).toHaveLength(2));
  expect(element.querySelector(".sdk-object-list-filters .test-filter-chip")?.textContent).toBe("Status: All");
  expect(element.querySelector(".sdk-object-list-toolbar-actions .test-add-btn")?.textContent).toBe("Add item");
  // `#create-row` is hidden while its slot returns no renderable content.
  expect(element.querySelector(".sdk-object-list-create-row")).toBeNull();
  // `#bulk-actions` is hidden until at least one row is checked.
  expect(element.querySelector(".sdk-object-list-bulk-actions")).toBeNull();

  // Checking a row reveals `#bulk-actions` in the toolbar with `{ checked, clear }`.
  element.querySelector<HTMLInputElement>(".sdk-object-list-row-check")!.click();
  await vi.waitFor(() => expect(element.querySelector(".test-bulk-btn")?.textContent).toBe("Delete (1)"));
  element.querySelector<HTMLButtonElement>(".test-bulk-btn")!.click();
  await nextTick();
  expect(bulkClicked).toHaveBeenCalledWith(1);
  expect(element.querySelector(".sdk-object-list-bulk-actions")).toBeNull();

  // Clicking "+ Add item" opens the inline `#create-row` block above the list.
  element.querySelector<HTMLButtonElement>(".test-add-btn")!.click();
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-create-row .test-create-form")?.textContent).toBe("New item form"));
});
