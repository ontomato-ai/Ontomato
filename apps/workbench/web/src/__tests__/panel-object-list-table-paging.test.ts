import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { BUSINESS_KNOWLEDGE, ONTOLOGY_TYPE } from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
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

type Read = PanelMemberReadRequest;
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

let cleanup: (() => void) | null = null;

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    messages?: Record<string, Record<string, string>>;
  } = {},
) {
  const reads: Read[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-list-table-paging-test",
    url: () => "/panels/object-list-table-paging",
    label: () => "Object list table paging test",
    initial: options.initial as never,
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
    setup: () => () =>
      h(
        "div",
        Object.keys(manifest.members).map((member) => h(PanelMember, { instance, member, key: member })),
      ),
  })
    .use(
      createI18n({
        legacy: false,
        locale: "en",
        messages: { en: publicEn } as never,
      }),
    )
    .use(ElementPlus);
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
  vi.restoreAllMocks();
});

describe("ObjectList table columns, row activation, page-mode sizing, jumper, and stale-data error recovery", () => {
  it("renders row index column, pinned primary link column, and dblclick row activation with dynamicColumns", async () => {
    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      },
      members: {
        list: {
          target: { projectionId: "table-b6" },
          inputs: { selected: { state: "selected" } },
          outputs: { selected: { state: "selected" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "table-b6": {
        ...meta,
        id: "table-b6",
        name: "Table B-6",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: { selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
        config: {
          layout: "table",
          dynamicColumns: true,
          showRowIndex: true,
          pinPrimaryColumn: true,
          rowActivation: "dblclick",
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
    const { instance, element } = mountDirect(manifest, projections, () =>
      ready({
        rows: [
          {
            primaryKey: "k-1",
            className: BUSINESS_KNOWLEDGE,
            label: "Alpha",
            fieldLabels: { name: "Name", owner: "Owner" },
            fields: { name: "Alpha", owner: "Alice" },
          },
          {
            primaryKey: "k-2",
            className: BUSINESS_KNOWLEDGE,
            label: "Beta",
            fieldLabels: { name: "Name", owner: "Owner" },
            fields: { name: "Beta", owner: "Bob" },
          },
        ],
        total: 2,
      }),
    );

    await vi.waitFor(() => expect(element.querySelectorAll("tbody tr[data-row-item='true']")).toHaveLength(2), { timeout: 5000 });

    // Leading 1-based row index header & cells.
    expect(element.querySelector("thead th.sdk-object-list-index-col")?.textContent?.trim()).toBe("#");
    const indexCells = [...element.querySelectorAll("tbody td.sdk-object-list-index-col")].map((td) => td.textContent?.trim());
    expect(indexCells).toEqual(["1", "2"]);

    // First visible column is pinned left and rendered as a clickable primary link.
    const pinnedHeader = element.querySelector("thead th.sdk-object-list-col-pinned-left");
    expect(pinnedHeader?.textContent?.trim()).toBe("Name");
    const primaryLinks = [...element.querySelectorAll<HTMLButtonElement>("tbody td.sdk-object-list-col-pinned-left .sdk-object-list-primary-link")];
    expect(primaryLinks.map((btn) => btn.textContent?.trim())).toEqual(["Alpha", "Beta"]);

    // Single-clicking a row highlights it locally without triggering selection/choose.
    const rows = [...element.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-item='true']")];
    rows[0]!.click();
    await nextTick();
    expect(rows[0]!.dataset.highlighted).toBe("true");
    expect(rows[0]!.classList.contains("highlighted")).toBe(true);
    expect(instance.state.values.value.selected).toBeNull();

    // Clicking the primary column link activates the row immediately.
    primaryLinks[0]!.click();
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });

    // Double-clicking another row activates it immediately.
    rows[1]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-2" });
  });

  it("supports page-mode page-size switching, page-aware row index, range bar, and page jumper", async () => {
    const manifest = definePanel({
      state: {
        type: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        list: {
          target: { projectionId: "paged-objects" },
          inputs: { type: { state: "type" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "paged-objects": {
        ...meta,
        id: "paged-objects",
        name: "Paged ontology objects",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: { type: { kind: "scalar", type: "string" } },
        outputs: {},
        config: {
          layout: "table",
          columns: [{ key: "label", labelKey: "name" }],
          pageSize: 2,
          pageSizes: [2, 5, 10],
          showRowIndex: true,
          showRangeBar: true,
          showPageJumper: true,
        },
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
            read: "instances",
            params: { className: { input: "type" } },
          },
        },
      },
    };

    const allItems = Array.from({ length: 6 }, (_, index) => ({
      className: "Server",
      primaryKey: `srv-${index + 1}`,
      label: `Server ${index + 1}`,
      fields: {},
    }));

    const { element, reads } = mountDirect(
      manifest,
      projections,
      (request) => {
        const page = (request.runtimeParams?.page as { number?: number; size?: number } | undefined) ?? { number: 1, size: 2 };
        const num = page.number ?? 1;
        const size = page.size ?? 2;
        const start = (num - 1) * size;
        return ready({
          rows: allItems.slice(start, start + size),
          total: allItems.length,
        });
      },
      {
        initial: { type: "Server" },
        messages: { en: { name: "Name" } },
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll("tbody tr[data-row-item='true']")).toHaveLength(2));

    // Page 1: range bar shows 1–2 of 6, index cells are 1 and 2, ElSelect page-size control exists (no native <select>).
    expect(element.querySelector('[data-testid="object-list-range-bar"]')?.textContent?.trim()).toBe("Showing 1–2 of 6");
    expect([...element.querySelectorAll("tbody td.sdk-object-list-index-col")].map((td) => td.textContent?.trim())).toEqual(["1", "2"]);
    expect(element.querySelector("select.sdk-object-list-page-size")).toBeNull();
    expect(element.querySelector('[data-testid="object-list-page-size"]')).not.toBeNull();

    // Jump to page 3 via jumper input.
    const jumper = element.querySelector<HTMLInputElement>('[data-testid="object-list-page-jumper-input"]')!;
    expect(jumper).not.toBeNull();
    jumper.value = "3";
    jumper.dispatchEvent(new Event("input", { bubbles: true }));
    jumper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() =>
      expect([...element.querySelectorAll("tbody td.sdk-object-list-index-col")].map((td) => td.textContent?.trim())).toEqual(["5", "6"]),
    );
    expect(element.querySelector('[data-testid="object-list-range-bar"]')?.textContent?.trim()).toBe("Showing 5–6 of 6");

    // Switch page size to 5 via ElSelect dropdown: resets to page 1 and passes { number: 1, size: 5 }.
    const selectTrigger = element.querySelector<HTMLElement>('[data-testid="object-list-page-size"] .el-select__wrapper')!;
    selectTrigger.click();
    await nextTick();
    const option5 = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((el) =>
      el.textContent?.includes("5 / page"),
    );
    expect(option5).toBeTruthy();
    option5!.click();

    await vi.waitFor(() => expect(element.querySelectorAll("tbody tr[data-row-item='true']")).toHaveLength(5));
    expect(reads.at(-1)?.runtimeParams?.page).toEqual({ number: 1, size: 5 });
    expect(element.querySelector('[data-testid="object-list-range-bar"]')?.textContent?.trim()).toBe("Showing 1–5 of 6");
    expect([...element.querySelectorAll(".sdk-object-list-page-num")].map((btn) => btn.textContent?.trim())).toEqual(["1", "2"]);
  });

  it("preserves last valid rows and shows a non-destructive retry banner when a subsequent page read fails", async () => {
    const manifest = definePanel({
      state: {
        type: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        list: {
          target: { projectionId: "stale-error-list" },
          inputs: { type: { state: "type" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "stale-error-list": {
        ...meta,
        id: "stale-error-list",
        name: "Stale error list",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: { type: { kind: "scalar", type: "string" } },
        outputs: {},
        config: {
          layout: "table",
          columns: [{ key: "label", labelKey: "name" }],
          pageSize: 2,
        },
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
            read: "instances",
            params: { className: { input: "type" } },
          },
        },
      },
    };

    let failPage2 = true;
    const { element } = mountDirect(
      manifest,
      projections,
      (request) => {
        const page = (request.runtimeParams?.page as { number?: number } | undefined)?.number ?? 1;
        if (page === 2 && failPage2) {
          return { status: "error", message: "Backend timeout" };
        }
        return ready({
          rows: page === 1
            ? [
                { className: "Server", primaryKey: "s-1", label: "Server 1", fields: {} },
                { className: "Server", primaryKey: "s-2", label: "Server 2", fields: {} },
              ]
            : [
                { className: "Server", primaryKey: "s-3", label: "Server 3", fields: {} },
                { className: "Server", primaryKey: "s-4", label: "Server 4", fields: {} },
              ],
          total: 4,
        });
      },
      {
        initial: { type: "Server" },
        messages: { en: { name: "Name" } },
      },
    );

    await vi.waitFor(() => expect(element.textContent).toContain("Server 1"));

    // Navigate to page 2 which fails: previous page 1 rows remain visible with a top retry banner.
    element.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
    await vi.waitFor(() => expect(element.querySelector('[data-testid="object-list-stale-error"]')).not.toBeNull());

    expect(element.querySelector('[data-testid="object-list-stale-error"]')?.textContent).toContain("Backend timeout");
    expect(element.textContent).toContain("Server 1");
    expect(element.textContent).toContain("Server 2");
    expect(element.querySelectorAll("tbody tr[data-row-item='true']")).toHaveLength(2);

    // Clicking Retry recovers page 2 and dismisses the error notice.
    failPage2 = false;
    element.querySelector<HTMLButtonElement>('[data-testid="object-list-stale-retry"]')!.click();
    await vi.waitFor(() => expect(element.textContent).toContain("Server 3"));
    expect(element.querySelector('[data-testid="object-list-stale-error"]')).toBeNull();
  });
});
