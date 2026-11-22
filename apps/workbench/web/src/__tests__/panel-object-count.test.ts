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
    commands: {},
  };
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-count-test",
    url: () => "/count",
    label: () => "Count",
    recordDraftCreated: async () => {},
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

it("sums numeric, string, array, and json-wrapped fields across rows and supports multi-item single read", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "ontology-summary-counts",
    name: "Ontology summary counts",
    componentId: "@ontomato/sdk:ObjectCount",
    inputs: {},
    outputs: {},
    config: {
      items: [
        { labelKey: "stats.objectTypes" },
        { labelKey: "stats.properties", sumField: "properties" },
        { label: "Weights", sumField: "weight" },
      ],
    },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
  };
  const { container, reads } = mountCount(
    projection,
    () =>
      ready([
        {
          primaryKey: "Person",
          label: "Person",
          fields: {
            properties: { kind: "json", value: [{ key: "id" }, { key: "name" }, { key: "email" }] },
            weight: 10,
          },
        },
        {
          primaryKey: "Order",
          label: "Order",
          fields: {
            properties: ["id", "total"],
            weight: "25",
          },
        },
        {
          primaryKey: "Asset",
          label: "Asset",
          fields: {
            properties: { kind: "json", value: 4 },
            weight: { kind: "json", value: "5" },
          },
        },
        {
          primaryKey: "Empty",
          label: "Empty",
          fields: {
            properties: { kind: "json", value: null },
            weight: "not-a-number",
          },
        },
      ]),
    {
      messages: {
        en: {
          "stats.objectTypes": "Object types",
          "stats.properties": "Properties",
        },
      },
    },
  );

  await vi.waitFor(() => {
    const el = container.querySelector(".sdk-object-count");
    expect(el?.getAttribute("data-state")).toBe("ready");
    const items = [...container.querySelectorAll(".sdk-object-count-item")].map((node) => ({
      value: node.querySelector(".sdk-object-count-value")?.textContent?.trim(),
      label: node.querySelector(".sdk-object-count-label")?.textContent?.trim(),
    }));
    expect(items).toEqual([
      { value: "4", label: "Object types" },
      { value: "9", label: "Properties" },
      { value: "40", label: "Weights" },
    ]);
    expect(container.querySelectorAll(".sdk-object-count-sep")).toHaveLength(2);
  });
  // All three metrics come from the single datum read without issuing duplicate requests.
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
