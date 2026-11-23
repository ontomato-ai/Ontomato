import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FEEDBACK_RECORD, OBJECT_TYPE, ONTOLOGY_TYPE } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Official SDK ObjectCount component:
 * - Single metric from `panelRecordList` (`rows.length`), `panelRecordQuery` (prefers `total`), and `panelOntologyObjects`.
 * - `sumField` across numbers, numeric strings, arrays, and `{ kind: "json", value: ... }` field wrappers.
 * - Multi-metric `items` evaluated against a single datum read (1 request for multiple stats).
 * - Localized labels via `labelKey` (panel.t / i18n), `labels` map, and `label` fallback.
 * - Lightweight visual states: loading (`…`), empty (`0`), forbidden / error / awaiting (`—` + title).
 */

const meta = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

let cleanup: (() => void) | null = null;

function resetMount() {
  cleanup?.();
  cleanup = null;
}

function mountCount(
  projection: DirectProjection,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    locale?: string;
    messages?: Record<string, Record<string, string>>;
  } = {},
) {
  const localeRef = ref(options.locale ?? "en");
  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      count: { target: { projectionId: projection.id } },
    },
  };
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-count-test",
    url: () => "/count",
    label: () => "Count",
    text: createPanelText(options.messages ?? {}, localeRef, "en"),
    ...noOperations,
    readProjection: async () => projection,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const i18n = createI18n({
    legacy: false,
    locale: localeRef.value,
    fallbackLocale: "en",
    messages: {
      en: publicEn,
      "zh-CN": publicEn,
    },
  });
  const app = createApp({ render: () => h(PanelMember, { instance, member: "count" }) });
  app.use(i18n).use(ElementPlus).mount(container);
  cleanup = () => {
    app.unmount();
    container.remove();
  };
  return { container, reads, instance, localeRef, i18n };
}

afterEach(() => {
  resetMount();
  document.body.innerHTML = "";
});

it("counts panelRecordList rows with panel.t labelKey and falls back to labels map by locale", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "object-type-count",
    name: "Object type count",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { labelKey: "stats.types" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
  };
  const { container, reads } = mountCount(
    projection,
    () =>
      ready([
        { primaryKey: "Person", label: "Person", fields: {} },
        { primaryKey: "Order", label: "Order", fields: {} },
        { primaryKey: "Asset", label: "Asset", fields: {} },
      ]),
    { messages: { en: { "stats.types": "Object types" } } },
  );

  await vi.waitFor(() => {
    const el = container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("ready");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("3");
    expect(el?.querySelector(".sdk-object-count-label")?.textContent?.trim()).toBe("Object types");
  });
  expect(reads).toHaveLength(1);
});

it("prefers query total over page rows length when sumField is omitted", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "task-query-count",
    name: "Task count",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { labels: { "zh-CN": "条反馈", en: "feedback items" } },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } }, read: "query", params: {} } },
  };
  const { container } = mountCount(
    projection,
    () =>
      ready({
        rows: [
          { primaryKey: "f-1", label: "One", fields: {} },
          { primaryKey: "f-2", label: "Two", fields: {} },
        ],
        total: 42,
      }),
    { locale: "zh-CN" },
  );

  await vi.waitFor(() => {
    const el = container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("ready");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("42");
    expect(el?.querySelector(".sdk-object-count-label")?.textContent?.trim()).toBe("条反馈");
  });
});

it("shows an unknown dash for panelRecordQuery when the owner omits total (never falls back to loaded rows)", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "task-query-no-total",
    name: "Task count unknown total",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { label: "Tasks" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } }, read: "query", params: {} } },
  };
  const { container, reads } = mountCount(
    projection,
    () =>
      ready({
        rows: [
          { primaryKey: "f-1", label: "One", fields: { weight: 10 } },
          { primaryKey: "f-2", label: "Two", fields: { weight: 20 } },
        ],
      }),
  );

  await vi.waitFor(() => {
    const el = container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("ready");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("—");
    expect(el?.querySelector(".sdk-object-count-label")?.textContent?.trim()).toBe("Tasks");
  });
  expect(reads).toHaveLength(1);
});

it("reads panelOntologyObjects total and handles owner-level forbidden status", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "ontology-objects-count",
    name: "Ontology objects count",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { label: "Objects" },
    data: {
      objects: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "objects",
        params: { type: { literal: "Person" } },
      },
    },
  };
  const { container } = mountCount(projection, () =>
    ready({
      status: "ok",
      type: "Person",
      layer: "fact",
      items: [{ node: { className: "Person", primaryKey: "p-1" }, label: "Alice" }],
      total: 128,
      page: 1,
      pageSize: 20,
    }),
  );

  await vi.waitFor(() => {
    const el = container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("ready");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("128");
  });
  resetMount();

  // Owner-level refused status inside panelOntologyObjects payload
  const forbidden = mountCount(projection, () =>
    ready({
      status: "refused",
      reason: "Ontology read denied",
      type: "Person",
      layer: "fact",
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    }),
  );
  await vi.waitFor(() => {
    const el = forbidden.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("forbidden");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("—");
    expect(el?.getAttribute("title")).toBe("Ontology read denied");
  });
});

it("renders loading (…), empty (0), forbidden (—), and error (—) states without breaking layout", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "count-states",
    name: "Count states",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { label: "Items" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
  };

  // Loading -> empty
  let resolveFirst!: (value: ProductPanelReadResponse) => void;
  const pending = new Promise<ProductPanelReadResponse>((resolve) => {
    resolveFirst = resolve;
  });
  const first = mountCount(projection, () => pending);
  await vi.waitFor(() => {
    const el = first.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("loading");
    expect(el?.getAttribute("aria-busy")).toBe("true");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("…");
  });
  resolveFirst({ status: "empty" });
  await vi.waitFor(() => {
    const el = first.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("empty");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("0");
  });
  resetMount();

  // Forbidden
  const second = mountCount(projection, () => ({ status: "forbidden" }));
  await vi.waitFor(() => {
    const el = second.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("forbidden");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("—");
    expect(el?.getAttribute("title")).toBeTruthy();
  });
  resetMount();

  // Error
  const third = mountCount(projection, () => ({ status: "error", message: "Backend unavailable" }));
  await vi.waitFor(() => {
    const el = third.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("error");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("—");
    expect(el?.getAttribute("title")).toBe("Backend unavailable");
  });
  await nextTick();
});

it("publishes read-only output total across list, paged query, empty, forbidden, error, and unmount", async () => {
  const queryProjection: DirectProjection = {
    ...meta,
    id: "output-query-count",
    name: "Query count output",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { label: "Tasks" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } }, read: "query", params: {} } },
  };

  let resolveQuery!: (value: ProductPanelReadResponse) => void;
  const pendingQuery = new Promise<ProductPanelReadResponse>((resolve) => {
    resolveQuery = resolve;
  });
  const first = mountCount(queryProjection, () => pendingQuery);
  await vi.waitFor(() => {
    expect(first.container.querySelector(".sdk-object-count")?.getAttribute("data-state")).toBe("loading");
  });
  expect(first.instance.outputs.count?.total ?? null).toBeNull();

  resolveQuery(ready({ total: 42, rows: [{ primaryKey: "f-1", label: "One", fields: {} }] }));
  await vi.waitFor(() => {
    expect(first.instance.outputs.count?.total).toBe(42);
  });

  // Unmounting clears the read-only member output back to null.
  resetMount();
  expect(first.instance.outputs.count?.total ?? null).toBeNull();

  // Paged query without owner total keeps total output strictly null (never falls back to page rows.length).
  const omittedTotal = mountCount(queryProjection, () =>
    ready({ rows: [{ primaryKey: "f-1", label: "One", fields: {} }, { primaryKey: "f-2", label: "Two", fields: {} }] }),
  );
  await vi.waitFor(() => {
    expect(omittedTotal.container.querySelector(".sdk-object-count")?.getAttribute("data-state")).toBe("ready");
  });
  expect(omittedTotal.instance.outputs.count?.total ?? null).toBeNull();
  resetMount();

  // Paged query receiving top-level empty (without owner total) publishes null and shows "—", never inventing 0.
  const emptyQueryRun = mountCount(queryProjection, () => ({ status: "empty" }));
  await vi.waitFor(() => {
    const el = emptyQueryRun.container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("empty");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("—");
  });
  expect(emptyQueryRun.instance.outputs.count?.total ?? null).toBeNull();
  resetMount();

  // Paged query with explicit owner total: 0 publishes 0.
  const zeroQueryRun = mountCount(queryProjection, () => ready({ rows: [], total: 0 }));
  await vi.waitFor(() => {
    expect(zeroQueryRun.instance.outputs.count?.total).toBe(0);
    expect(zeroQueryRun.container.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("0");
  });
  resetMount();

  // Complete unpaged list receiving empty still publishes 0.
  const listProjection: DirectProjection = {
    ...meta,
    id: "output-list-count",
    name: "List count output",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { label: "Types" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
  };
  const emptyListRun = mountCount(listProjection, () => ({ status: "empty" }));
  await vi.waitFor(() => {
    expect(emptyListRun.instance.outputs.count?.total).toBe(0);
    expect(emptyListRun.container.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("0");
  });
  resetMount();

  const forbiddenRun = mountCount(queryProjection, () => ({ status: "forbidden" }));
  await vi.waitFor(() => {
    expect(forbiddenRun.container.querySelector(".sdk-object-count")?.getAttribute("data-state")).toBe("forbidden");
  });
  expect(forbiddenRun.instance.outputs.count?.total ?? null).toBeNull();
});

it("renders bare numeral in badge appearance and omits DOM nodes while unavailable", async () => {
  const badgeProjection: DirectProjection = {
    ...meta,
    id: "badge-count",
    name: "Badge count",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: { appearance: "badge" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: FEEDBACK_RECORD } }, read: "query", params: { size: { literal: 1 } } } },
  };

  let resolveRead!: (value: ProductPanelReadResponse) => void;
  const pending = new Promise<ProductPanelReadResponse>((resolve) => {
    resolveRead = resolve;
  });
  const loadingToReady = mountCount(badgeProjection, () => pending);
  await vi.waitFor(() => {
    expect(loadingToReady.reads).toHaveLength(1);
  });
  // Loading: zero placeholder DOM node rendered in badge appearance.
  expect(loadingToReady.container.querySelector(".sdk-object-count")).toBeNull();
  expect(loadingToReady.instance.outputs.count?.total ?? null).toBeNull();

  resolveRead(ready({ total: 19, rows: [{ primaryKey: "f-1", label: "One", fields: {} }] }));
  await vi.waitFor(() => {
    const el = loadingToReady.container.querySelector(".sdk-object-count");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("sdk-object-count-badge")).toBe(true);
    expect(el?.getAttribute("data-appearance")).toBe("badge");
    expect(el?.textContent?.trim()).toBe("19");
    expect(el?.querySelector("strong")).toBeNull();
  });
  expect(loadingToReady.instance.outputs.count?.total).toBe(19);
  resetMount();

  // Forbidden, error, omitted total, and paged empty without owner total render zero DOM nodes in badge appearance.
  for (const response of [
    { status: "forbidden" } as ProductPanelReadResponse,
    { status: "error", message: "boom" } as ProductPanelReadResponse,
    ready({ rows: [{ primaryKey: "f-1", label: "One", fields: {} }] }),
    { status: "empty" } as ProductPanelReadResponse,
  ]) {
    const run = mountCount(badgeProjection, () => response);
    await vi.waitFor(() => expect(run.reads).toHaveLength(1));
    await nextTick();
    await nextTick();
    expect(run.container.querySelector(".sdk-object-count")).toBeNull();
    expect(run.instance.outputs.count?.total ?? null).toBeNull();
    resetMount();
  }

  // Paged query with explicit total: 0 renders compact "0" and publishes 0.
  const zeroBadge = mountCount(badgeProjection, () => ready({ rows: [], total: 0 }));
  await vi.waitFor(() => {
    const el = zeroBadge.container.querySelector(".sdk-object-count-badge");
    expect(el?.textContent?.trim()).toBe("0");
  });
  expect(zeroBadge.instance.outputs.count?.total).toBe(0);
  resetMount();

  // Complete unpaged list empty still renders compact "0" and publishes 0.
  const listBadgeProjection: DirectProjection = {
    ...badgeProjection,
    id: "list-badge-count",
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
  };
  const emptyListBadge = mountCount(listBadgeProjection, () => ({ status: "empty" }));
  await vi.waitFor(() => {
    const el = emptyListBadge.container.querySelector(".sdk-object-count-badge");
    expect(el?.textContent?.trim()).toBe("0");
  });
  expect(emptyListBadge.instance.outputs.count?.total).toBe(0);
  resetMount();

  // Default appearance with omitWhenUnavailable: true hides while loading, then shows full count strip.
  const silentDefaultProjection: DirectProjection = {
    ...badgeProjection,
    id: "silent-default-count",
    config: { label: "Tasks", omitWhenUnavailable: true },
  };
  let resolveSilent!: (value: ProductPanelReadResponse) => void;
  const silentPending = new Promise<ProductPanelReadResponse>((resolve) => {
    resolveSilent = resolve;
  });
  const silentDefault = mountCount(silentDefaultProjection, () => silentPending);
  await vi.waitFor(() => expect(silentDefault.reads).toHaveLength(1));
  expect(silentDefault.container.querySelector(".sdk-object-count")).toBeNull();
  resolveSilent(ready({ total: 7, rows: [] }));
  await vi.waitFor(() => {
    const el = silentDefault.container.querySelector(".sdk-object-count");
    expect(el?.querySelector(".sdk-object-count-value")?.textContent?.trim()).toBe("7");
    expect(el?.querySelector(".sdk-object-count-label")?.textContent?.trim()).toBe("Tasks");
  });
});
