import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
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
    locale?: string;
    i18nMessages?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const activeLocale = options.locale ?? "en";
  const reads: Read[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-list-dynamic-test",
    url: () => "/panels/object-list-dynamic",
    label: () => "Object list dynamic test",
    initial: options.initial as never,
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
    setup: () => () =>
      h(
        "div",
        Object.keys(manifest.members).map((member) => h(PanelMember, { instance, member, key: member })),
      ),
  })
    .use(
      createI18n({
        legacy: false,
        locale: activeLocale,
        messages: (options.i18nMessages ?? { en: publicEn }) as never,
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

describe("ObjectList dynamicColumns, showColumnToggle, and exportable", () => {
  it("keeps default ObjectList compact list behavior unchanged when new flags are omitted", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "default-list" } },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "default-list": {
        ...meta,
        id: "default-list",
        name: "Default list",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {},
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
            read: "list",
            params: {},
          },
        },
      },
    };
    const { element } = mountDirect(manifest, projections, () =>
      ready([
        {
          primaryKey: "k-1",
          label: "First item",
          fieldLabels: { code: "Code", name: "Name" },
          fields: { code: "C-1", name: "First item" },
        },
      ]),
    );
    await vi.waitFor(() => expect(element.textContent).toContain("First item"));

    expect(element.querySelector("table")).toBeNull();
    expect(element.querySelector('[data-testid="object-list-column-toggle"]')).toBeNull();
    expect(element.querySelector('[data-testid="object-list-export-csv"]')).toBeNull();
  });

  it("derives dynamic columns, excludes arrays, uses fieldLabels with fallback, and preserves headers on empty search", async () => {
    const manifest = definePanel({
      state: {
        search: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        list: {
          target: { projectionId: "dyn-list" },
          inputs: { search: { state: "search" } },
          outputs: { search: { state: "search" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "dyn-list": {
        ...meta,
        id: "dyn-list",
        name: "Dynamic table",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: { search: { kind: "scalar", type: "string" } },
        outputs: { search: { kind: "scalar", type: "string" } },
        config: {
          dynamicColumns: true,
        },
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
            read: "query",
            params: { search: { input: "search" } },
          },
        },
      },
    };
    const { instance, element } = mountDirect(manifest, projections, (request) => {
      if (request.inputs.search === "none") {
        return ready({ rows: [], total: 0 });
      }
      return ready({
        rows: [
          {
            primaryKey: "c-1",
            label: "Acme Corp",
            fieldLabels: { code: "Code", name: "Display Name", tags: "Tags" },
            fields: {
              rawNote: "Plain note",
              code: "ACME",
              name: "Acme Corp",
              tags: ["gold", "priority"],
            },
          },
        ],
        total: 1,
      });
    });

    const headers = () => [...element.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    await vi.waitFor(() => expect(headers()).toEqual(["Code", "Display Name", "rawNote"]));
    const cells = [...element.querySelectorAll("tbody tr td")].map((td) => td.textContent?.trim());
    expect(cells).toEqual(["ACME", "Acme Corp", "Plain note"]);

    // Narrowing to 0 rows within the same scope preserves the last derived table headers.
    instance.state.set("search", "none");
    await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-empty-body")).not.toBeNull());
    expect(headers()).toEqual(["Code", "Display Name", "rawNote"]);
  });

  it("toggles column visibility locally, enforces at least one column, and resets when object type changes", async () => {
    const manifest = definePanel({
      state: {
        activeClass: { type: { kind: "scalar", type: "string" }, default: "Customer" },
      },
      members: {
        list: {
          target: { projectionId: "toggle-list" },
          inputs: { className: { state: "activeClass" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "toggle-list": {
        ...meta,
        id: "toggle-list",
        name: "Toggle table",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: { className: { kind: "scalar", type: "string" } },
        outputs: {},
        config: {
          dynamicColumns: true,
          showColumnToggle: true,
        },
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
            read: "list",
            params: { className: { input: "className" } },
          },
        },
      },
    };
    const { instance, element, reads } = mountDirect(manifest, projections, (request) => {
      if (request.inputs.className === "Order") {
        return ready([
          {
            primaryKey: "o-1",
            label: "Order 1",
            fieldLabels: { orderNo: "Order No", amount: "Amount" },
            fields: { orderNo: "ORD-1", amount: "120" },
          },
        ]);
      }
      return ready([
        {
          primaryKey: "c-1",
          label: "Acme",
          fieldLabels: { code: "Code", name: "Name", tier: "Tier" },
          fields: { code: "C1", name: "Acme", tier: "Gold" },
        },
      ]);
    });

    const headers = () => [...element.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    await vi.waitFor(() => expect(headers()).toEqual(["Code", "Name", "Tier"]));
    const readsAfterInit = reads.length;

    const toggleBtn = element.querySelector<HTMLButtonElement>('[data-testid="object-list-column-toggle"]');
    expect(toggleBtn).not.toBeNull();
    toggleBtn!.click();
    await nextTick();

    // Hide "Name" and "Tier" -> only "Code" remains, and its checkbox is disabled.
    const checkboxFor = (key: string) =>
      document.querySelector<HTMLInputElement>(`input[type="checkbox"][data-column-key="${key}"]`)!;
    await vi.waitFor(() => expect(checkboxFor("name")).not.toBeNull());

    const nameBox = checkboxFor("name");
    nameBox.checked = false;
    nameBox.dispatchEvent(new Event("change"));
    await nextTick();
    expect(headers()).toEqual(["Code", "Tier"]);

    const tierBox = checkboxFor("tier");
    tierBox.checked = false;
    tierBox.dispatchEvent(new Event("change"));
    await nextTick();
    expect(headers()).toEqual(["Code"]);

    const codeBox = checkboxFor("code");
    expect(codeBox.disabled).toBe(true);
    expect(document.querySelector(".sdk-object-list-columns-hint")?.textContent).toContain(
      "Keep at least one column visible",
    );

    // Pure presentation: zero extra reads triggered by column visibility toggles.
    expect(reads.length).toBe(readsAfterInit);

    // Reset restores all columns.
    const resetBtn = document.querySelector<HTMLButtonElement>('[data-testid="object-list-columns-reset"]')!;
    resetBtn.click();
    await nextTick();
    expect(headers()).toEqual(["Code", "Name", "Tier"]);

    // Hide "Name", then switch object class -> visibility resets cleanly for the new class.
    checkboxFor("name").checked = false;
    checkboxFor("name").dispatchEvent(new Event("change"));
    await nextTick();
    expect(headers()).toEqual(["Code", "Tier"]);

    instance.state.set("activeClass", "Order");
    await vi.waitFor(() => expect(headers()).toEqual(["Order No", "Amount"]));
    expect(element.querySelector(".sdk-object-list-col-toggle-count")).toBeNull();
  });

  it("exports only current page rows in visible-column order as UTF-8 BOM RFC 4180 CSV and disables when empty", async () => {
    const capturedBlobs: Blob[] = [];
    const capturedDownloads: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
      capturedBlobs.push(obj as Blob);
      return "blob:mock-csv";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownloads.push(this.download);
    });

    const manifest = definePanel({
      state: {
        emptyMode: { type: { kind: "scalar", type: "boolean" }, default: false },
      },
      members: {
        list: {
          target: { projectionId: "export-list" },
          inputs: { emptyMode: { state: "emptyMode" } },
        },
      },
    });
    const projections: Record<string, DirectProjection> = {
      "export-list": {
        ...meta,
        id: "export-list",
        name: "Export table",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: { emptyMode: { kind: "scalar", type: "boolean" } },
        outputs: {},
        config: {
          dynamicColumns: true,
          showColumnToggle: true,
          exportable: true,
          exportFileName: "customers-page",
        },
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
            read: "query",
            params: { emptyMode: { input: "emptyMode" } },
          },
        },
      },
    };
    const { instance, element } = mountDirect(manifest, projections, (request) => {
      if (request.inputs.emptyMode) {
        return ready({ rows: [], total: 0 });
      }
      return ready({
        rows: [
          {
            primaryKey: "c-1",
            label: "Acme",
            fieldLabels: { name: "名称", note: "备注, 说明", tier: "等级" },
            fields: {
              name: "客户 A",
              note: '带引号 "hi"\n第二行',
              tier: "VIP",
            },
          },
          {
            primaryKey: "c-2",
            label: "Beta",
            fields: {
              name: "客户 B",
              note: "普通, 文本",
              tier: "Standard",
            },
          },
        ],
        total: 100,
      });
    });

    await vi.waitFor(() => {
      const btn = element.querySelector<HTMLButtonElement>('[data-testid="object-list-export-csv"]');
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
    });
    const exportBtn = element.querySelector<HTMLButtonElement>('[data-testid="object-list-export-csv"]')!;
    expect(exportBtn.textContent?.trim()).toBe("Export current page (CSV)");

    // Hide "tier" so CSV export must reflect only visible columns ["名称", "备注, 说明"].
    element.querySelector<HTMLButtonElement>('[data-testid="object-list-column-toggle"]')!.click();
    await nextTick();
    const tierBox = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-column-key="tier"]')!;
    tierBox.checked = false;
    tierBox.dispatchEvent(new Event("change"));
    await nextTick();

    exportBtn.click();
    await nextTick();

    expect(capturedDownloads).toEqual(["customers-page.csv"]);
    expect(capturedBlobs).toHaveLength(1);
    const bytes = new Uint8Array(await capturedBlobs[0]!.arrayBuffer());
    // UTF-8 BOM: 0xEF 0xBB 0xBF
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(decoded).toBe(
      '\uFEFF名称,"备注, 说明"\r\n客户 A,"带引号 ""hi""\n第二行"\r\n客户 B,"普通, 文本"',
    );

    // Empty state disables the export button with a readable hint.
    instance.state.set("emptyMode", true);
    await vi.waitFor(() => expect(exportBtn.disabled).toBe(true));
    expect(exportBtn.title).toBe("No rows on the current page to export");
  });
});
