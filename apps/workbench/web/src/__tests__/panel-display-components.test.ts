import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Component } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { METRIC_VIEW, OBJECT_TYPE, ONTOLOGY_TYPE, RELATIONSHIP } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import TypedValue from "../../../../../packages/apps-sdk/src/base/TypedValue.vue";
import RecordTemplate from "../../../../../packages/apps-sdk/src/base/RecordTemplate.vue";
import InfoBanner from "../../../../../packages/apps-sdk/src/base/InfoBanner.vue";
import ObjectRefCard from "../../../../../packages/apps-sdk/src/base/ObjectRefCard.vue";
import MetricCard from "../../../../../packages/apps-sdk/src/base/MetricCard.vue";
import { noOperations } from "./panel-frame";

/*
 * Official SDK general display components (TypedValue, RecordTemplate, InfoBanner, ObjectRefCard, MetricCard):
 * - Projection-bound rendering from `panelRecord`, `metricOutput` (`result` table), `panelRecordList`/`panelRecordQuery`,
 *   and `panelOntologyObjects` without duplicating reads or computing business logic.
 * - Standalone / slot rendering with direct props, localized copy, reference navigation, and loading/empty/forbidden/error states.
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

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});

function mountStandalone(
  component: Component,
  props: Record<string, unknown>,
  options: {
    locale?: string;
    slots?: Record<string, () => unknown>;
  } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const i18n = createI18n({
    legacy: false,
    locale: options.locale ?? "en",
    fallbackLocale: "en",
    messages: { en: publicEn, "zh-CN": publicEn },
  });
  const app = createApp(defineComponent({
    render: () => h(component, props, options.slots),
  }));
  app.use(i18n).use(ElementPlus).mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  return { container, i18n };
}

function mountProjection(
  projection: DirectProjection,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    locale?: string;
    messages?: Record<string, Record<string, string>>;
    manifest?: DirectPanelManifest;
    initial?: Record<string, unknown>;
  } = {},
) {
  const localeRef = ref(options.locale ?? "en");
  const manifest: DirectPanelManifest = options.manifest ?? {
    state: {},
    members: {
      view: { target: { projectionId: projection.id } },
    },
  };
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "display-component-test",
    url: () => "/display",
    label: () => "Display",
    initial: options.initial as never,
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
    messages: { en: publicEn, "zh-CN": publicEn },
  });
  const app = createApp({ render: () => h(PanelMember, { instance, member: "view" }) });
  app.use(i18n).use(ElementPlus).mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  return { container, reads, instance, localeRef, i18n };
}

describe("TypedValue", () => {
  it("formats scalar, numeric, date/datetime, localized, boolean, tag, list, json, and clickable reference values standalone", async () => {
    const navigated: unknown[] = [];

    const num = mountStandalone(TypedValue, {
      value: 12345.678,
      kind: "number",
      unit: "ms",
      numberFormat: { maximumFractionDigits: 1 },
    });
    expect(num.container.textContent?.replace(/\s+/g, " ").trim()).toBe("12,345.7 ms");
    expect(num.container.querySelector(".sdk-typed-value")?.classList.contains("is-numeric")).toBe(true);

    const bool = mountStandalone(TypedValue, { value: true });
    expect(bool.container.textContent?.trim()).toBe("Yes");
    expect(bool.container.querySelector(".sdk-typed-value")?.getAttribute("data-kind")).toBe("boolean");

    const localized = mountStandalone(
      TypedValue,
      { value: { kind: "localized", values: { en: "Customer Order", "zh-CN": "客户订单" } } },
      { locale: "zh-CN" },
    );
    expect(localized.container.textContent?.trim()).toBe("客户订单");

    const date = mountStandalone(TypedValue, { value: "2026-11-23T08:30:00.000Z", kind: "date" });
    expect(date.container.textContent?.trim()).toMatch(/2026/);
    expect(date.container.querySelector(".sdk-typed-value")?.getAttribute("title")).toBeTruthy();

    const tag = mountStandalone(TypedValue, { value: "Published", kind: "tag", tone: "success" });
    expect(tag.container.querySelector(".sdk-typed-value-tag")?.getAttribute("data-tone")).toBe("success");
    expect(tag.container.textContent?.trim()).toBe("Published");

    const refView = mountStandalone(TypedValue, {
      value: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Order", label: "Order" },
      field: "sourceObjectType",
      onNavigate: (r: unknown, f: unknown) => navigated.push([r, f]),
    });
    refView.container.querySelector<HTMLButtonElement>("button.sdk-typed-value-link")!.click();
    expect(navigated).toEqual([[{ className: OBJECT_TYPE, primaryKey: "Order", label: "Order" }, "sourceObjectType"]]);

    const refList = mountStandalone(TypedValue, {
      value: [
        { kind: "reference", className: OBJECT_TYPE, primaryKey: "Customer", label: "Customer" },
        { kind: "reference", className: OBJECT_TYPE, primaryKey: "Invoice", label: "Invoice" },
      ],
      listStyle: "tags",
      onNavigate: (r: unknown) => navigated.push(r),
    });
    const listButtons = [...refList.container.querySelectorAll<HTMLButtonElement>("button.sdk-typed-value-tag.is-link")];
    expect(listButtons.map((b) => b.textContent?.trim())).toEqual(["Customer", "Invoice"]);
    listButtons[1]!.click();
    expect(navigated.at(-1)).toEqual({ className: OBJECT_TYPE, primaryKey: "Invoice", label: "Invoice" });

    const jsonVal = mountStandalone(TypedValue, { value: { kind: "json", value: { retries: 3 } } });
    expect(jsonVal.container.querySelector("code.sdk-typed-value-code")?.textContent).toBe('{"retries":3}');
  });

  it("reads a typed field from a bound panelRecord and writes declared navigate output on reference click", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "rel-source-val",
      name: "Source ref",
      componentId: "@ontomato/sdk:TypedValue",
      inputs: { rel: { kind: "object", objectType: RELATIONSHIP } },
      outputs: { navigate: { kind: "object", objectType: OBJECT_TYPE } },
      config: { field: "sourceObjectType" },
      data: { record: { source: { object: { input: "rel" } }, read: "record", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {
        rel: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: false, external: false },
        picked: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
      },
      members: {
        view: {
          target: { projectionId: projection.id },
          inputs: { rel: { state: "rel" } },
          outputs: { navigate: { state: "picked" } },
        },
      },
    };
    const { container, instance } = mountProjection(
      projection,
      () =>
        ready({
          primaryKey: "has_order",
          label: "Has order",
          fields: {
            sourceObjectType: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Customer", label: "Customer" },
          },
        }),
      { manifest, initial: { rel: { className: RELATIONSHIP, primaryKey: "has_order" } } },
    );

    await vi.waitFor(() => {
      expect(container.querySelector("button.sdk-typed-value-link")?.textContent?.trim()).toBe("Customer");
    });
    container.querySelector<HTMLButtonElement>("button.sdk-typed-value-link")!.click();
    await nextTick();
    expect(instance.state.values.value.picked).toEqual({ className: OBJECT_TYPE, primaryKey: "Customer" });
  });

  it("extracts a scalar / first-row column directly from a MetricView result (metricOutput)", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "metric-scalar-val",
      name: "Metric scalar",
      componentId: "@ontomato/sdk:TypedValue",
      inputs: {},
      outputs: {},
      config: { unit: "orders", numberFormat: { maximumFractionDigits: 0 } },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-orders" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container } = mountProjection(projection, () =>
      ready({
        columns: [{ key: "order_count", label: "Order count", type: "integer" }],
        rows: [{ order_count: 1420 }],
        truncation: null,
      }),
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".sdk-typed-value")?.getAttribute("data-state")).toBe("ready");
    });
    expect(container.querySelector(".sdk-typed-value")?.getAttribute("data-kind")).toBe("number");
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("1,420 orders");
  });

  it("renders empty placeholder when a MetricView result returns zero rows", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "metric-empty-val",
      name: "Empty metric",
      componentId: "@ontomato/sdk:TypedValue",
      inputs: {},
      outputs: {},
      config: { field: "avg_latency", emptyText: "N/A" },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-latency" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container } = mountProjection(projection, () =>
      ready({
        columns: [{ key: "avg_latency", label: "Avg latency", type: "double" }],
        rows: [],
        truncation: null,
      }),
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".sdk-typed-value")?.getAttribute("data-state")).toBe("empty");
    });
    expect(container.textContent?.trim()).toBe("N/A");
  });
});

describe("RecordTemplate", () => {
  it("interpolates record fields into a fixed sentence with clickable references, tones, and escaped braces", async () => {
    const navigated: unknown[] = [];
    const { container } = mountStandalone(RecordTemplate, {
      template: "{source} → {target} ({{cardinality}}: {cardinality}, {status})",
      record: {
        primaryKey: "rel-1",
        label: "Owns",
        fields: {
          source: { kind: "reference", className: OBJECT_TYPE, primaryKey: "User", label: "User" },
          target: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Order", label: "Order" },
          cardinality: "1:N",
          status: "Active",
        },
        tones: { status: "success" },
      },
      onNavigate: (r: unknown, f: unknown) => navigated.push([r, f]),
    });

    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("User → Order ({cardinality}: 1:N, Active)");
    expect(container.querySelector(".sdk-typed-value-tag")?.getAttribute("data-tone")).toBe("success");
    const links = [...container.querySelectorAll<HTMLButtonElement>("button.sdk-typed-value-link")];
    expect(links.map((b) => b.textContent?.trim())).toEqual(["User", "Order"]);
    links[0]!.click();
    expect(navigated).toEqual([[{ className: OBJECT_TYPE, primaryKey: "User", label: "User" }, "source"]]);
  });

  it("fills MetricView result cells into a localized fixed sentence via templateKey without computation", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "metric-sentence",
      name: "Metric summary sentence",
      componentId: "@ontomato/sdk:RecordTemplate",
      inputs: {},
      outputs: {},
      config: {
        templateKey: "summary.line",
        fieldFormats: {
          total_people: { kind: "number", numberFormat: { maximumFractionDigits: 0 } },
          pending_review: { kind: "number", numberFormat: { maximumFractionDigits: 0 } },
        },
      },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-people" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container } = mountProjection(
      projection,
      () =>
        ready({
          columns: [
            { key: "total_people", label: "Total", type: "integer" },
            { key: "pending_review", label: "Pending", type: "integer" },
          ],
          rows: [{ total_people: 12, pending_review: 3 }],
          truncation: null,
        }),
      {
        locale: "zh-CN",
        messages: {
          en: { "summary.line": "{total_people} people total, {pending_review} pending review" },
          "zh-CN": { "summary.line": "共 {total_people} 人，其中 {pending_review} 人待审" },
        },
      },
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".sdk-record-template")?.getAttribute("data-state")).toBe("ready");
    });
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("共 12 人，其中 3 人待审");
  });

  it("never evaluates arithmetic expressions or conditional branches inside placeholders", () => {
    const { container } = mountStandalone(RecordTemplate, {
      template: "Direct: {total}, Expr: {total - pending}, Branch: {pending > 0 ? 'warn' : 'ok'}",
      values: { total: 12, pending: 3 },
      emptyPlaceholder: "—",
    });

    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("Direct: 12, Expr: —, Branch: —");
  });
});

describe("InfoBanner", () => {
  it("renders static tones with semantic ARIA roles and supports bound metric result fixed template", async () => {
    const warn = mountStandalone(InfoBanner, {
      tone: "warning",
      title: "Read-only type",
      text: "System object types cannot be edited directly.",
    });
    const aside = warn.container.querySelector("aside.sdk-info-banner")!;
    expect(aside.getAttribute("data-tone")).toBe("warning");
    expect(aside.getAttribute("role")).toBe("alert");
    expect(warn.container.textContent).toContain("Read-only type");
    expect(warn.container.textContent).toContain("System object types cannot be edited directly.");

    const boundProjection: DirectProjection = {
      ...meta,
      id: "metric-banner",
      name: "Metric notice",
      componentId: "@ontomato/sdk:InfoBanner",
      inputs: {},
      outputs: {},
      config: {
        tone: "info",
        titleKey: "banner.title",
        template: "{pending} pending reviews across {domains} domains",
      },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-pending" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container } = mountProjection(
      boundProjection,
      () =>
        ready({
          columns: [
            { key: "pending", label: "Pending", type: "integer" },
            { key: "domains", label: "Domains", type: "integer" },
          ],
          rows: [{ pending: 12, domains: 3 }],
          truncation: null,
        }),
      { messages: { en: { "banner.title": "Review queue" } } },
    );

    await vi.waitFor(() => {
      expect(container.querySelector("aside.sdk-info-banner")?.getAttribute("data-state")).toBe("ready");
    });
    expect(container.querySelector("aside.sdk-info-banner")?.getAttribute("role")).toBe("status");
    expect(container.textContent).toContain("Review queue");
    expect(container.textContent?.replace(/\s+/g, " ")).toContain("12 pending reviews across 3 domains");
  });

  it("hides itself when hideWhenEmpty is enabled and the bound metric returns no rows", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "empty-banner",
      name: "Optional banner",
      componentId: "@ontomato/sdk:InfoBanner",
      inputs: {},
      outputs: {},
      config: { field: "warning_note", hideWhenEmpty: true },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-note" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container } = mountProjection(projection, () =>
      ready({ columns: [{ key: "warning_note", label: "Note", type: "string" }], rows: [], truncation: null }),
    );
    await vi.waitFor(() => {
      expect(container.querySelector("aside.sdk-info-banner")).toBeNull();
    });
  });
});

describe("ObjectRefCard", () => {
  it("renders a clickable Source/Target reference card from a Relationship record and emits navigate + panel output", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "rel-source-card",
      name: "Source object card",
      componentId: "@ontomato/sdk:ObjectRefCard",
      inputs: { rel: { kind: "object", objectType: RELATIONSHIP } },
      outputs: { navigate: { kind: "object", objectType: OBJECT_TYPE } },
      config: {
        field: "sourceObjectType",
        captionKey: "rel.source",
        badgeField: "sourceCardinality",
      },
      data: { record: { source: { object: { input: "rel" } }, read: "record", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {
        rel: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: false, external: false },
        navTarget: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
      },
      members: {
        view: {
          target: { projectionId: projection.id },
          inputs: { rel: { state: "rel" } },
          outputs: { navigate: { state: "navTarget" } },
        },
      },
    };
    const { container, instance } = mountProjection(
      projection,
      () =>
        ready({
          primaryKey: "customer_orders",
          label: "Customer Orders",
          fields: {
            sourceObjectType: { kind: "reference", className: OBJECT_TYPE, primaryKey: "customer_entity", label: "Customer" },
            sourceCardinality: "1",
          },
          tones: { sourceCardinality: "info" },
        }),
      {
        manifest,
        initial: { rel: { className: RELATIONSHIP, primaryKey: "customer_orders" } },
        messages: { en: { "rel.source": "Source" } },
      },
    );

    await vi.waitFor(() => {
      expect(container.querySelector("button.sdk-object-ref-card")).not.toBeNull();
    });
    expect(container.querySelector(".sdk-object-ref-card-caption")?.textContent?.trim()).toBe("Source");
    expect(container.querySelector(".sdk-object-ref-card-title")?.textContent?.trim()).toBe("Customer");
    expect(container.querySelector(".sdk-object-ref-card-subtitle")?.textContent?.trim()).toBe("customer_entity");
    expect(container.querySelector(".sdk-object-ref-card-badge")?.textContent?.trim()).toBe("1");

    container.querySelector<HTMLButtonElement>("button.sdk-object-ref-card")!.click();
    await nextTick();
    expect(instance.state.values.value.navTarget).toEqual({
      className: OBJECT_TYPE,
      primaryKey: "customer_entity",
    });
  });

  it("supports standalone non-interactive cards and known platform icon keys", () => {
    const { container } = mountStandalone(ObjectRefCard, {
      reference: { className: OBJECT_TYPE, primaryKey: "Product", label: "Product" },
      caption: "Target",
      icon: "ontology",
      clickable: false,
    });
    expect(container.querySelector("button.sdk-object-ref-card")).toBeNull();
    expect(container.querySelector("div.sdk-object-ref-card")).not.toBeNull();
    expect(container.querySelector(".sdk-object-ref-card-leading svg")).not.toBeNull();
    expect(container.querySelector(".sdk-object-ref-card-title")?.textContent?.trim()).toBe("Product");
  });
});

describe("MetricCard", () => {
  it("evaluates multiple KPI cards from one MetricView result read without duplicating requests and surfaces truncation", async () => {
    const projection: DirectProjection = {
      ...meta,
      id: "kpi-metric-cards",
      name: "Sales KPIs",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: {
        columns: 2,
        items: [
          { field: "total_orders", unit: "orders", tone: "info" },
          { field: "fulfillment_rate", labelKey: "kpi.rate", numberFormat: { style: "percent", maximumFractionDigits: 1 }, tone: "success" },
        ],
      },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-kpis" } } },
          read: "result",
          params: {},
        },
      },
    };
    const { container, reads } = mountProjection(
      projection,
      () =>
        ready({
          columns: [
            { key: "total_orders", label: "Total orders", type: "integer" },
            { key: "fulfillment_rate", label: "Fulfillment", type: "double" },
          ],
          rows: [{ total_orders: 2480, fulfillment_rate: 0.964 }],
          truncation: { truncated: true, rowLimit: 1000, truncationHint: "Showing first 1,000 rows" },
        }),
      { messages: { en: { "kpi.rate": "Fulfillment rate" } } },
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".sdk-metric-card-group")?.getAttribute("data-state")).toBe("ready");
    });
    expect(reads).toHaveLength(1);
    const cards = [...container.querySelectorAll(".sdk-metric-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector(".sdk-metric-card-label")?.textContent?.trim()).toBe("Total orders");
    expect(cards[0]!.querySelector(".sdk-metric-card-value")?.textContent?.trim()).toBe("2,480");
    expect(cards[0]!.querySelector(".sdk-metric-card-unit")?.textContent?.trim()).toBe("orders");
    expect(cards[0]!.querySelector(".sdk-metric-card-truncation")?.getAttribute("title")).toBe("Showing first 1,000 rows");
    expect(cards[1]!.querySelector(".sdk-metric-card-label")?.textContent?.trim()).toBe("Fulfillment rate");
    expect(cards[1]!.querySelector(".sdk-metric-card-value")?.textContent?.trim()).toBe("96.4%");
    expect(cards[1]!.getAttribute("data-tone")).toBe("success");
  });

  it("counts and sums across panelRecordList and panelOntologyObjects in one read, and handles forbidden state", async () => {
    const listProjection: DirectProjection = {
      ...meta,
      id: "ontology-stats",
      name: "Ontology stats",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: {
        variant: "inline",
        items: [
          { label: "Object types" },
          { label: "Properties", sumField: "attributes" },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
    };
    const { container, reads } = mountProjection(listProjection, () =>
      ready([
        { primaryKey: "Person", label: "Person", fields: { attributes: ["id", "name", "email"] } },
        { primaryKey: "Order", label: "Order", fields: { attributes: ["id", "total"] } },
      ]),
    );
    await vi.waitFor(() => {
      expect(container.querySelector(".sdk-metric-card-group")?.getAttribute("data-state")).toBe("ready");
    });
    expect(reads).toHaveLength(1);
    expect(container.querySelector(".sdk-metric-card-group")?.classList.contains("is-inline")).toBe(true);
    const values = [...container.querySelectorAll(".sdk-metric-card-value")].map((el) => el.textContent?.trim());
    expect(values).toEqual(["2", "5"]);

    const forbiddenProjection: DirectProjection = {
      ...meta,
      id: "objects-forbidden",
      name: "Forbidden count",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: { label: "Objects" },
      data: {
        objects: {
          source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
          read: "objects",
          params: { type: { literal: "Order" } },
        },
      },
    };
    const denied = mountProjection(forbiddenProjection, () => ({ status: "forbidden" }));
    await vi.waitFor(() => {
      expect(denied.container.querySelector(".sdk-metric-card-group")?.getAttribute("data-state")).toBe("forbidden");
    });
    expect(denied.container.querySelector(".sdk-metric-card-value")?.textContent?.trim()).toBe("—");

    const standalone = mountStandalone(MetricCard, {
      label: "Active policies",
      value: 17,
      unit: "rules",
      description: "Enforced across workspace",
      tone: "info",
    });
    expect(standalone.container.querySelector(".sdk-metric-card-value")?.textContent?.trim()).toBe("17");
    expect(standalone.container.querySelector(".sdk-metric-card-unit")?.textContent?.trim()).toBe("rules");
    expect(standalone.container.querySelector(".sdk-metric-card-description")?.textContent?.trim()).toBe("Enforced across workspace");
  });
});

describe("valueMap pure presentation mapping (Standard 3.1 #4)", () => {
  it("maps exact scalar values in TypedValue to localized labels, tones, and platform icons, with exact fallback", async () => {
    const valueMap = {
      APPROVED: {
        labels: { en: "Approved", "zh-CN": "已通过" },
        tone: "success" as const,
        icon: "check-circle",
      },
      REJECTED: {
        labelKey: "status.rejected",
        tone: "danger" as const,
        icon: "x-circle",
      },
      true: {
        label: "Enabled",
        icon: "eye",
      },
      ONLY_TONE: {
        tone: "warning" as const,
        icon: "unknown-nonexistent-icon",
      },
    };

    const approved = mountStandalone(TypedValue, { value: "APPROVED", valueMap }, { locale: "zh-CN" });
    const tag = approved.container.querySelector(".sdk-typed-value-tag")!;
    expect(tag).not.toBeNull();
    expect(tag.getAttribute("data-tone")).toBe("success");
    expect(tag.textContent?.trim()).toBe("已通过");
    expect(tag.querySelector("svg.sdk-typed-value-icon")?.getAttribute("data-icon")).toBe("check-circle");

    const rejectedProj: DirectProjection = {
      ...meta,
      id: "status-rejected",
      name: "Review status",
      componentId: "@ontomato/sdk:TypedValue",
      inputs: {},
      outputs: {},
      config: { field: "decision", valueMap },
      data: {
        record: {
          source: { object: { literal: { className: OBJECT_TYPE, primaryKey: "rev-1" } } },
          read: "record",
          params: {},
        },
      },
    };
    const rejected = mountProjection(
      rejectedProj,
      () => ready({ primaryKey: "rev-1", label: "Review 1", fields: { decision: "REJECTED" } }),
      { locale: "zh-CN", messages: { "zh-CN": { "status.rejected": "已驳回" } } },
    );
    await vi.waitFor(() => {
      expect(rejected.container.querySelector(".sdk-typed-value")?.getAttribute("data-state")).toBe("ready");
    });
    const rejTag = rejected.container.querySelector(".sdk-typed-value-tag")!;
    expect(rejTag.getAttribute("data-tone")).toBe("danger");
    expect(rejTag.textContent?.trim()).toBe("已驳回");
    expect(rejTag.querySelector("svg.sdk-typed-value-icon")?.getAttribute("data-icon")).toBe("x-circle");

    // Boolean key without tone renders inline text + icon (not forced into a tag)
    const enabled = mountStandalone(TypedValue, { value: true, valueMap });
    expect(enabled.container.querySelector(".sdk-typed-value-tag")).toBeNull();
    expect(enabled.container.querySelector(".sdk-typed-value-text")?.textContent?.trim()).toBe("Enabled");
    expect(enabled.container.querySelector("svg.sdk-typed-value-icon")?.getAttribute("data-icon")).toBe("eye");

    // Entry with tone only keeps original text and ignores unknown icon names
    const toneOnly = mountStandalone(TypedValue, { value: "ONLY_TONE", valueMap });
    const toneTag = toneOnly.container.querySelector(".sdk-typed-value-tag")!;
    expect(toneTag.getAttribute("data-tone")).toBe("warning");
    expect(toneTag.textContent?.trim()).toBe("ONLY_TONE");
    expect(toneTag.querySelector(".sdk-typed-value-icon")).toBeNull();

    // Unmatched value falls back as-is
    const unmatched = mountStandalone(TypedValue, { value: "PENDING", valueMap });
    expect(unmatched.container.querySelector(".sdk-typed-value-tag")).toBeNull();
    expect(unmatched.container.textContent?.trim()).toBe("PENDING");
  });

  it("never evaluates numeric ranges, thresholds, or expressions in valueMap keys", () => {
    const thresholdMap = {
      "> 3": { label: "Abnormal", tone: "danger" as const, icon: "alert-triangle" },
      ">= 10": { label: "Critical", tone: "danger" as const },
      "count > 0": { label: "Positive", tone: "warning" as const },
      "5": { label: "Exactly five", tone: "info" as const },
    };

    const twelve = mountStandalone(TypedValue, { value: 12, valueMap: thresholdMap });
    expect(twelve.container.querySelector(".sdk-typed-value-tag")).toBeNull();
    expect(twelve.container.textContent?.trim()).toBe("12");

    const five = mountStandalone(TypedValue, { value: 5, valueMap: thresholdMap });
    expect(five.container.querySelector(".sdk-typed-value-tag")?.getAttribute("data-tone")).toBe("info");
    expect(five.container.textContent?.trim()).toBe("Exactly five");
  });

  it("propagates fieldFormats.valueMap inside RecordTemplate and maps InfoBanner tone/icon/label from metric or record", async () => {
    const templateRes = mountStandalone(
      RecordTemplate,
      {
        template: "审核结论：{decision}",
        values: { decision: "APPROVED" },
        fieldFormats: {
          decision: {
            valueMap: {
              APPROVED: { label: "已通过", tone: "success", icon: "check-circle" },
            },
          },
        },
      },
      { locale: "zh-CN" },
    );
    expect(templateRes.container.textContent?.replace(/\s+/g, " ").trim()).toBe("审核结论：已通过");
    expect(templateRes.container.querySelector(".sdk-typed-value-tag")?.getAttribute("data-tone")).toBe("success");
    expect(templateRes.container.querySelector("svg.sdk-typed-value-icon")?.getAttribute("data-icon")).toBe("check-circle");

    const bannerProj: DirectProjection = {
      ...meta,
      id: "review-banner",
      name: "Review banner",
      componentId: "@ontomato/sdk:InfoBanner",
      inputs: {},
      outputs: {},
      config: {
        field: "decision",
        valueMap: {
          REJECTED: {
            labels: { en: "Rejected by reviewer", "zh-CN": "审核已驳回" },
            tone: "danger",
            icon: "x-circle",
          },
        },
      },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-decision" } } },
          read: "result",
          params: {},
        },
      },
    };
    const banner = mountProjection(
      bannerProj,
      () =>
        ready({
          columns: [{ key: "decision", label: "Decision", type: "string" }],
          rows: [{ decision: "REJECTED" }],
          truncation: null,
        }),
      { locale: "zh-CN" },
    );
    await vi.waitFor(() => {
      expect(banner.container.querySelector("aside.sdk-info-banner")?.getAttribute("data-state")).toBe("ready");
    });
    const aside = banner.container.querySelector("aside.sdk-info-banner")!;
    expect(aside.getAttribute("data-tone")).toBe("danger");
    expect(aside.getAttribute("role")).toBe("alert");
    expect(aside.querySelector(".sdk-info-banner-icon")?.getAttribute("data-icon")).toBe("x-circle");
    expect(aside.textContent).toContain("审核已驳回");

    const toneMapBannerProj: DirectProjection = {
      ...meta,
      id: "severity-banner",
      name: "Severity banner",
      componentId: "@ontomato/sdk:InfoBanner",
      inputs: {},
      outputs: {},
      config: {
        toneField: "level",
        toneMap: { WARN: "warning", OK: "success" },
        template: "{count} items flagged",
      },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-sev" } } },
          read: "result",
          params: {},
        },
      },
    };
    const sevBanner = mountProjection(toneMapBannerProj, () =>
      ready({
        columns: [
          { key: "level", label: "Level", type: "string" },
          { key: "count", label: "Count", type: "integer" },
        ],
        rows: [{ level: "WARN", count: 4 }],
        truncation: null,
      }),
    );
    await vi.waitFor(() => {
      expect(sevBanner.container.querySelector("aside.sdk-info-banner")?.getAttribute("data-state")).toBe("ready");
    });
    expect(sevBanner.container.querySelector("aside.sdk-info-banner")?.getAttribute("data-tone")).toBe("warning");
    expect(sevBanner.container.textContent?.replace(/\s+/g, " ")).toContain("4 items flagged");
  });

  it("applies column.valueMap in ObjectList table cells with tone, platform icon, localized label, and raw fallback", async () => {
    const listProjection: DirectProjection = {
      ...meta,
      id: "review-table",
      name: "Review list",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        layout: "table",
        columns: [
          { key: "label", labelKey: "col.name" },
          {
            key: "reviewResult",
            labelKey: "col.result",
            valueMap: {
              APPROVED: { labels: { en: "Approved", "zh-CN": "已通过" }, tone: "success", icon: "check-circle" },
              REJECTED: { labels: { en: "Rejected", "zh-CN": "已驳回" }, tone: "danger", icon: "x-circle" },
            },
          },
        ],
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
    };
    const { container } = mountProjection(
      listProjection,
      () =>
        ready([
          { primaryKey: "r1", label: "Case A", fields: { reviewResult: "APPROVED" } },
          { primaryKey: "r2", label: "Case B", fields: { reviewResult: "REJECTED" } },
          { primaryKey: "r3", label: "Case C", fields: { reviewResult: "PENDING" } },
        ]),
      { locale: "zh-CN", messages: { "zh-CN": { "col.name": "名称", "col.result": "审核结果" } } },
    );
    await vi.waitFor(() => {
      expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    });
    const rows = [...container.querySelectorAll("tbody tr")];
    const r1Tag = rows[0]!.querySelector(".sdk-object-list-tag")!;
    expect(r1Tag.getAttribute("data-tone")).toBe("success");
    expect(r1Tag.textContent?.trim()).toBe("已通过");
    expect(r1Tag.querySelector("svg.sdk-object-list-tag-icon")?.getAttribute("data-icon")).toBe("check-circle");

    const r2Tag = rows[1]!.querySelector(".sdk-object-list-tag")!;
    expect(r2Tag.getAttribute("data-tone")).toBe("danger");
    expect(r2Tag.textContent?.trim()).toBe("已驳回");
    expect(r2Tag.querySelector("svg.sdk-object-list-tag-icon")?.getAttribute("data-icon")).toBe("x-circle");

    expect(rows[2]!.querySelector(".sdk-object-list-tag")).toBeNull();
    expect(rows[2]!.textContent).toContain("PENDING");
  });
});
