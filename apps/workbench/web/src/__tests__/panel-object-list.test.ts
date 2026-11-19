import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U2 ObjectList & ObjectSummary through the platform's real host and bridge:
 * - Multi-column table with status tags, text search, total count, explicit multi-select separated from single
 *   selection, visible-only select-all with indeterminate state, and clickable reference links (M5 + M4 pattern).
 * - Faceted counts, escaped range highlights (no HTML injection), fallback-to-first selection on filter, and
 *   ObjectSummary highlights/tags/references (M7 knowledge pattern).
 * - Server-side offset/limit pagination, submit-mode search + dropdown filters resetting to page 1, refresh, and
 *   per-row detail action (M7 feedback pattern).
 * - Explicit failure when query features are enabled on a list-only adapter.
 */

const METRIC = "test:MetricView";
const FUNCTION = "test:Function";
const KNOWLEDGE = "test:BusinessKnowledge";
const FEEDBACK = "test:Feedback";
const LEGACY = "test:LegacyListOnly";

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

const projection = (
  id: string,
  componentId: "ObjectList" | "ObjectSummary",
  binding: string,
  display: Record<string, unknown>,
  inputs: ProductProjection["inputs"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", componentId,
  binding: { kind: "PlatformObjectType", id: binding }, inputs, display,
});

function hostWith(projections: Record<string, ProductProjection>) {
  return (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    return nothingAt(request);
  };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("renders multi-column ObjectList with status tags, text search, count, separate single/checked selection and reference navigation", async () => {
  const projections = {
    "metric-list": projection("metric-list", "ObjectList", METRIC, {
      columns: [
        { key: "label", labelKey: "cols.name", subtitleKey: "description" },
        { key: "functionName", labelKey: "cols.function", kind: "reference" },
        { key: "status", labelKey: "cols.status", kind: "tag" },
      ],
      searchable: true,
      showCount: true,
      selectable: true,
    }),
    "function-list": projection("function-list", "ObjectList", FUNCTION, {
      columns: [{ key: "label", labelKey: "cols.function" }],
    }),
  };
  const manifest = definePanel({
    state: {
      selectedMetric: { kind: "object", objectType: METRIC, deepLink: true },
      linkedFunction: { kind: "object", objectType: FUNCTION, deepLink: false },
    },
    slots: {
      metrics: {
        projectionId: "metric-list",
        inputs: {},
        outputs: { selected: { state: "selectedMetric" }, navigate: { state: "linkedFunction" } },
      },
      functions: {
        projectionId: "function-list",
        inputs: {},
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-metrics", "Metrics", manifest);
  panel.content.messages = {
    en: { "cols.name": "Name", "cols.function": "Function", "cols.status": "Status" },
  };
  panel.content.html = `
    <div id="app">
      <section class="metrics-pane">
        <Projection slot="metrics" v-model:checked="checkedRefs">
          <template #batch-actions="{ checked, clear }">
            <button type="button" class="batch-publish" @click="published = checked.map(c => c.primaryKey); clear()">Publish ({{ checked.length }})</button>
          </template>
        </Projection>
      </section>
      <section class="functions-pane">
        <Projection slot="functions"></Projection>
      </section>
    </div>`;
  const use = panelUse("use-metrics", "metrics-test", panel.id, "/applications/app-test/metrics");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const allMetrics = [
    {
      primaryKey: "m-1", label: "Revenue", fields: { description: "Gross revenue", functionName: "calc_rev", status: "Published" },
      tones: { status: "success" as const },
      references: { functionName: { className: FUNCTION, primaryKey: "fn-1", label: "calc_rev" } },
    },
    {
      primaryKey: "m-2", label: "Churn", fields: { description: "Monthly churn", functionName: "calc_churn", status: "Draft" },
      tones: { status: "warning" as const },
      references: { functionName: { className: FUNCTION, primaryKey: "fn-2", label: "calc_churn" } },
    },
  ];
  const queries: unknown[] = [];
  registerPlatformObjectAdapter({
    objectType: METRIC,
    query: async (q) => {
      queries.push(q);
      const term = (q.search ?? "").trim().toLowerCase();
      const items = term ? allMetrics.filter((item) => item.label.toLowerCase().includes(term)) : allMetrics;
      return { items, total: items.length };
    },
  });
  registerPlatformObjectAdapter({
    objectType: FUNCTION,
    list: async () => [{ primaryKey: "fn-1", label: "calc_rev", fields: {} }],
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const checkedRefs = ref<{ className: string; primaryKey: string }[]>([]);
  const published = ref<string[]>([]);
  const mounted = await mountPanel({ setup: () => ({ checkedRefs, published }) });

  await vi.waitFor(() => expect(document.querySelectorAll(".metrics-pane tbody tr").length).toBe(2));

  // Function list did NOT enable selectable: zero checkboxes inside it.
  expect(document.querySelectorAll('.functions-pane input[type="checkbox"]').length).toBe(0);

  // Multi-column headers, status tags with tones, and total count.
  expect([...document.querySelectorAll(".metrics-pane thead th")].map((th) => th.textContent?.trim()))
    .toEqual(["", "Name", "Function", "Status"]);
  expect(document.querySelector('.metrics-pane [data-tone="success"]')?.textContent?.trim()).toBe("Published");
  expect(document.querySelector(".metrics-pane .sdk-object-list-count")?.textContent).toContain("2");

  // Clicking a row sets single selection without touching checked checkboxes.
  document.querySelector<HTMLTableRowElement>(".metrics-pane tbody tr")!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedMetric).toEqual({ className: METRIC, primaryKey: "m-1" });
  expect(checkedRefs.value).toEqual([]);
  expect(document.querySelector(".batch-publish")).toBeNull();

  // Checking row 2 updates checkedRefs and shows batch actions without changing selectedMetric.
  const rowBoxes = document.querySelectorAll<HTMLInputElement>('.metrics-pane tbody input[type="checkbox"]');
  rowBoxes[1]!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedMetric).toEqual({ className: METRIC, primaryKey: "m-1" });
  expect(checkedRefs.value).toEqual([{ className: METRIC, primaryKey: "m-2" }]);
  const selectAll = document.querySelector<HTMLInputElement>('.metrics-pane thead input[type="checkbox"]')!;
  expect(selectAll.indeterminate).toBe(true);
  expect(document.querySelector(".batch-publish")?.textContent).toContain("1");

  // Filtering to "Rev" shows 1 row; clicking select-all checks ONLY the visible row (union with already checked m-2).
  const searchInput = document.querySelector<HTMLInputElement>('.metrics-pane input[type="search"]')!;
  searchInput.value = "Rev";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelectorAll(".metrics-pane tbody tr").length).toBe(1));
  expect(document.querySelector(".metrics-pane .sdk-object-list-count")?.textContent).toContain("1");

  selectAll.click();
  await nextTick();
  expect(checkedRefs.value).toEqual([
    { className: METRIC, primaryKey: "m-2" },
    { className: METRIC, primaryKey: "m-1" },
  ]);

  // Clicking a reference cell writes the navigate output state without changing selectedMetric.
  document.querySelector<HTMLButtonElement>(".metrics-pane .sdk-object-ref-link")!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.linkedFunction).toEqual({ className: FUNCTION, primaryKey: "fn-1" });
  expect(mounted.context.instance.state.values.value.selectedMetric).toEqual({ className: METRIC, primaryKey: "m-1" });

  // Batch action runs and clears selection.
  document.querySelector<HTMLButtonElement>(".batch-publish")!.click();
  await nextTick();
  expect(published.value).toEqual(["m-2", "m-1"]);
  expect(checkedRefs.value).toEqual([]);
});

it("renders faceted count tabs, escaped highlights, fallback-to-first selection, and ObjectSummary highlights/references", async () => {
  const projections = {
    "knowledge-list": projection("knowledge-list", "ObjectList", KNOWLEDGE, {
      searchable: true,
      selectable: true,
      statusField: "status",
      tagsField: "tags",
      fallbackToFirst: true,
      toggleable: false,
      filters: [{
        key: "status", label: "knowledge.status", kind: "tabs", defaultValue: "all",
        options: [{ value: "all", label: "knowledge.filterAll" }],
      }],
    }),
    "knowledge-summary": projection("knowledge-summary", "ObjectSummary", KNOWLEDGE, {
      fields: ["status", "body", "owner"],
    }, { item: { kind: "object", objectType: KNOWLEDGE } }),
  };
  const manifest = definePanel({
    state: {
      selectedKnowledge: { kind: "object", objectType: KNOWLEDGE, deepLink: true },
      linkedOwner: { kind: "object", objectType: FUNCTION, deepLink: false },
    },
    slots: {
      list: { projectionId: "knowledge-list", inputs: {}, outputs: { selected: { state: "selectedKnowledge" } } },
      detail: {
        projectionId: "knowledge-summary",
        inputs: { item: { state: "selectedKnowledge" } },
        outputs: { navigate: { state: "linkedOwner" } },
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-knowledge", "Knowledge", manifest);
  panel.content.html = `<div id="app"><Projection slot="list"></Projection><Projection slot="detail"></Projection></div>`;
  panel.content.messages = { en: { "knowledge.status": "Status", "knowledge.filterAll": "All" } };
  const use = panelUse("use-knowledge", "knowledge-test", panel.id, "/applications/app-test/knowledge");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const entries = [
    {
      primaryKey: "k-1", label: "<img src=x onerror=alert(1)> Order rule", subtitle: "…Order must have customer…",
      fields: { status: "Approved", body: "Order must have customer", owner: "order_fn" },
      tones: { status: "success" as const },
      tags: { tags: ["Business", "Core"] },
      references: { owner: { className: FUNCTION, primaryKey: "fn-order", label: "order_fn" } },
      statusValue: "approved",
    },
    {
      primaryKey: "k-2", label: "Pending Order rule", subtitle: "Draft order rule",
      fields: { status: "Pending", body: "Draft order rule", owner: "draft_fn" },
      tones: { status: "warning" as const },
      tags: { tags: ["Draft"] },
      statusValue: "pending",
    },
  ];
  registerPlatformObjectAdapter({
    objectType: KNOWLEDGE,
    query: async (q) => {
      const search = (q.search ?? "").trim().toLowerCase();
      const matched = search ? entries.filter((e) => e.label.toLowerCase().includes(search)) : entries;
      const status = q.filters?.status ?? "all";
      const visible = status === "all" ? matched : matched.filter((e) => e.statusValue === status);
      const rangeOf = (text: string) => {
        if (!search) return [];
        const index = text.toLowerCase().indexOf(search);
        return index >= 0 ? [{ start: index, end: index + search.length }] : [];
      };
      return {
        items: visible.map(({ statusValue: _s, ...item }) => ({
          ...item,
          highlights: search ? { label: rangeOf(item.label), subtitle: rangeOf(item.subtitle) } : undefined,
        })),
        total: visible.length,
        facets: [{
          key: "status",
          label: "Status",
          options: [
            { value: "all", count: matched.length },
            { value: "pending", label: "Pending", count: matched.filter((e) => e.statusValue === "pending").length },
            { value: "approved", label: "Approved", count: matched.filter((e) => e.statusValue === "approved").length },
          ],
        }],
      };
    },
    read: async (primaryKey) => {
      const found = entries.find((e) => e.primaryKey === primaryKey)!;
      return {
        primaryKey: found.primaryKey,
        label: found.label,
        fields: found.fields,
        tones: found.tones,
        tags: found.tags,
        references: found.references,
        highlights: { body: [{ start: 0, end: 5 }] },
      };
    },
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // Fallback-to-first selects k-1 automatically on initial load.
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedKnowledge).toEqual({
    className: KNOWLEDGE, primaryKey: "k-1",
  }));

  // Facets show counts; tags render.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual(["All 2", "Pending 1", "Approved 1"]);
  expect([...document.querySelectorAll(".sdk-object-list-item-tags .sdk-object-list-tag")].map((t) => t.textContent?.trim()))
    .toContain("Business");

  // Search highlights text safely without injecting HTML.
  const searchInput = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  searchInput.value = "Order";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-list mark").length).toBeGreaterThan(0));
  expect(document.querySelector(".sdk-object-list img")).toBeNull();
  expect(document.querySelector(".sdk-object-list mark")?.textContent).toBe("Order");

  // ObjectSummary renders escaped highlights and clickable reference link.
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary mark")?.textContent).toBe("Order"));
  document.querySelector<HTMLButtonElement>(".sdk-object-summary .sdk-object-ref-link")!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.linkedOwner).toEqual({ className: FUNCTION, primaryKey: "fn-order" });

  // Switching status tab to Pending filters out k-1 -> selection falls back to first visible item k-2.
  tabs[1]!.click();
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedKnowledge).toEqual({
    className: KNOWLEDGE, primaryKey: "k-2",
  }));
});

it("supports server-side pagination, submit-mode filters resetting to page 1, refresh, and row detail action", async () => {
  const projections = {
    "feedback-list": projection("feedback-list", "ObjectList", FEEDBACK, {
      columns: [
        { key: "source", labelKey: "cols.source", kind: "tag" },
        { key: "rating", labelKey: "cols.rating", kind: "tag" },
        { key: "comment", labelKey: "cols.comment" },
      ],
      searchable: true,
      searchMode: "submit",
      refreshable: true,
      showCount: true,
      pageSize: 2,
      toggleable: false,
      rowActionLabel: "Details",
      filters: [
        {
          key: "sourceType", label: "Source", kind: "select",
          options: [{ value: "qa", label: "Q&A" }, { value: "analysis_task", label: "Analysis" }],
        },
        {
          key: "rating", label: "Rating", kind: "select",
          options: [{ value: "like", label: "Like" }, { value: "dislike", label: "Dislike" }],
        },
      ],
    }),
  };
  const manifest = definePanel({
    state: { selectedFeedback: { kind: "object", objectType: FEEDBACK, deepLink: false } },
    slots: { list: { projectionId: "feedback-list", inputs: {}, outputs: { selected: { state: "selectedFeedback" } } } },
    operations: [],
  });
  const panel = panelRecord("panel-feedback", "Feedback", manifest);
  panel.content.messages = {
    en: { "cols.source": "Source", "cols.rating": "Rating", "cols.comment": "Comment" },
  };
  panel.content.html = `<div id="app"><Projection slot="list" @query="lastQuery = $event"></Projection></div>`;
  const use = panelUse("use-feedback", "feedback-test", panel.id, "/applications/app-test/feedback");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const all = [
    { primaryKey: "f-1", label: "f-1", fields: { source: "Q&A", rating: "Like", comment: "Good 1" }, sourceType: "qa", ratingVal: "like" },
    { primaryKey: "f-2", label: "f-2", fields: { source: "Q&A", rating: "Dislike", comment: "Bad 2" }, sourceType: "qa", ratingVal: "dislike" },
    { primaryKey: "f-3", label: "f-3", fields: { source: "Analysis", rating: "Like", comment: "Good 3" }, sourceType: "analysis_task", ratingVal: "like" },
    { primaryKey: "f-4", label: "f-4", fields: { source: "Q&A", rating: "Dislike", comment: "Bad 4" }, sourceType: "qa", ratingVal: "dislike" },
    { primaryKey: "f-5", label: "f-5", fields: { source: "Analysis", rating: "Dislike", comment: "Bad 5" }, sourceType: "analysis_task", ratingVal: "dislike" },
  ];
  const calls: unknown[] = [];
  registerPlatformObjectAdapter({
    objectType: FEEDBACK,
    query: async (q) => {
      calls.push(q);
      let filtered = all;
      if (q.filters?.sourceType) filtered = filtered.filter((r) => r.sourceType === q.filters!.sourceType);
      if (q.filters?.rating) filtered = filtered.filter((r) => r.ratingVal === q.filters!.rating);
      if (q.search) filtered = filtered.filter((r) => r.fields.comment.toLowerCase().includes(q.search!.toLowerCase()));
      const offset = q.page?.offset ?? 0;
      const limit = q.page?.limit ?? filtered.length;
      return {
        items: filtered.slice(offset, offset + limit).map(({ primaryKey, label, fields }) => ({ primaryKey, label, fields })),
        total: filtered.length,
      };
    },
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const lastQuery = ref<unknown>(null);
  const mounted = await mountPanel({ setup: () => ({ lastQuery }) });

  // Initial load: offset 0, limit 2, total 5.
  await vi.waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBe(2));
  expect(calls).toEqual([{ page: { offset: 0, limit: 2 } }]);
  expect(document.querySelector(".sdk-object-list-count")?.textContent).toContain("5");

  // Go to page 2 -> offset 2, limit 2.
  document.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(calls.length).toBe(2));
  expect(calls[1]).toEqual({ page: { offset: 2, limit: 2 } });

  // Submit mode: changing dropdown & typing search does NOT trigger a query yet.
  const [sourceSelect, ratingSelect] = document.querySelectorAll<HTMLSelectElement>("select");
  sourceSelect!.value = "qa";
  sourceSelect!.dispatchEvent(new Event("change", { bubbles: true }));
  ratingSelect!.value = "dislike";
  ratingSelect!.dispatchEvent(new Event("change", { bubbles: true }));
  const searchInput = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  searchInput.value = "Bad";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(calls.length).toBe(2);

  // Clicking Query resets to page 1 (offset 0) and sends search + filters.
  document.querySelector<HTMLButtonElement>(".sdk-object-list-query")!.click();
  await vi.waitFor(() => expect(lastQuery.value).toEqual({
    search: "Bad", filters: { sourceType: "qa", rating: "dislike" }, page: { offset: 0, limit: 2 },
  }));
  expect(calls[2]).toEqual(lastQuery.value);

  // Clicking Refresh re-runs the same query.
  document.querySelector<HTMLButtonElement>(".sdk-object-list-refresh")!.click();
  await vi.waitFor(() => expect(calls.length).toBe(4));
  expect(calls[3]).toEqual(calls[2]);

  // Row detail action selects f-2 without toggling off on second click.
  const detailButton = document.querySelector<HTMLButtonElement>(".sdk-object-list-row-action")!;
  detailButton.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedFeedback).toEqual({ className: FEEDBACK, primaryKey: "f-2" });
  detailButton.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedFeedback).toEqual({ className: FEEDBACK, primaryKey: "f-2" });
});

it("fails visibly when query features are enabled on a list-only adapter", async () => {
  const projections = {
    "legacy-list": projection("legacy-list", "ObjectList", LEGACY, { searchable: true }),
  };
  const manifest = definePanel({
    state: {},
    slots: { list: { projectionId: "legacy-list", inputs: {} } },
    operations: [],
  });
  const panel = panelRecord("panel-legacy", "Legacy", manifest);
  panel.content.html = `<div id="app"><Projection slot="list"></Projection></div>`;
  const use = panelUse("use-legacy", "legacy-test", panel.id, "/applications/app-test/legacy");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  registerPlatformObjectAdapter({
    objectType: LEGACY,
    list: async () => [{ primaryKey: "1", label: "One", fields: {} }],
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  await mountPanel({});

  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("has no query"));
});

it("resolves column labelKey/emptyKey via panel.t, falls back to owner fieldLabels on ObjectList and ObjectSummary, and resolves state operation labelKey", async () => {
  const projections = {
    "labeled-list": projection("labeled-list", "ObjectList", FEEDBACK, {
      columns: [
        { key: "source", kind: "tag" },
        { key: "comment", labelKey: "cols.notes", emptyKey: "cols.noNotes" },
        { key: "rawCode" },
      ],
    }),
    "labeled-summary": projection("labeled-summary", "ObjectSummary", FEEDBACK, {
      fields: ["source", "rawCode"],
    }, { item: { kind: "object", objectType: FEEDBACK } }),
  };
  const manifest = definePanel({
    state: {
      selectedFeedback: { kind: "object", objectType: FEEDBACK, deepLink: true },
    },
    slots: {
      list: { projectionId: "labeled-list", inputs: {}, outputs: { selected: { state: "selectedFeedback" } } },
      summary: { projectionId: "labeled-summary", inputs: { item: { state: "selectedFeedback" } } },
    },
    operations: [
      { id: "clearSelection", labelKey: "ops.clear", kind: "state", sets: { selectedFeedback: null } },
    ],
  });
  const panel = panelRecord("panel-labels", "Labels", manifest);
  panel.content.messages = {
    en: { "cols.notes": "Reviewer notes", "cols.noNotes": "No notes", "ops.clear": "Clear selection" },
  };
  panel.content.html = `
    <div id="app">
      <Projection slot="list"></Projection>
      <Projection slot="summary"></Projection>
    </div>`;
  const use = panelUse("use-labels", "labels-test", panel.id, "/applications/app-test/labels");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const record = {
    primaryKey: "fb-1",
    label: "Feedback 1",
    fields: { source: "Q&A", comment: "", rawCode: "E-100" },
    fieldLabels: { source: "Feedback source" },
    tones: { source: "info" as const },
  };
  registerPlatformObjectAdapter({
    objectType: FEEDBACK,
    query: async () => ({
      items: [record],
      total: 1,
      fieldLabels: { source: "Feedback source", comment: "Owner comment" },
    }),
    read: async () => record,
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  await vi.waitFor(() => expect(document.querySelectorAll("thead th").length).toBe(3));
  const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
  // source omits labelKey -> uses owner fieldLabels; comment has labelKey -> panel.t wins over owner; rawCode falls back to key.
  expect(headers).toEqual(["Feedback source", "Reviewer notes", "rawCode"]);
  // emptyKey resolves through panel.t when cell value is empty.
  const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent?.trim());
  expect(cells).toEqual(["Q&A", "No notes", "E-100"]);
  // State operation labelKey resolves through panel.t.
  expect(mounted.context.instance.operations.value.find((op) => op.id === "clearSelection")?.label).toBe("Clear selection");

  // Select row -> ObjectSummary displays owner fieldLabels for "source" and falls back to raw key for "rawCode".
  document.querySelector<HTMLTableRowElement>("tbody tr")!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-summary dt").length).toBe(2));
  const summaryLabels = [...document.querySelectorAll(".sdk-object-summary dt")].map((dt) => dt.textContent?.trim());
  expect(summaryLabels).toEqual(["Feedback source", "rawCode"]);
});
