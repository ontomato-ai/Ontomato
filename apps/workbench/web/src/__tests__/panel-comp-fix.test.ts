import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { APPLICATION, PRODUCT_PANEL, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type DirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { useListRowSlot } from "../../../../../packages/apps-sdk/src/panel/slot-context";
import type { PanelFieldValue } from "../../../../../packages/apps-sdk/src/panel/state";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Regression tests for the four official SDK component generality fixes:
 * 1. Scoped counts (`total` strictly owner-reported, `loadedCount`, `filteredCount` only for complete lists).
 * 2. Removed `ObjectHeader.outputFields`/`fields`; owner-declared named typed read outputs published on any member
 *    reading that datum, plus `OperationButton.hideWhenUnavailable`.
 * 3. No raw `row` record in `ObjectList` slots (`#item-leading`, `#cell-*`, `#actions`, `#row-detail`), `row-action`
 *    events, or public `useListRowSlot()`.
 * 4. Cross-type `rowType` selection on `ObjectList` (e.g. `platform:Application.usedPanels` -> `platform:ProductPanel`)
 *    with native `state.selected` + `fallbackToFirst` across parent switches and zero `selectedKey`/`firstItem`.
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

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

function mountTestPanel(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  members: string[];
  initial?: Record<string, PanelFieldValue>;
  messages?: Record<string, Record<string, string>>;
  memberSlots?: (instance: DirectPanelInstance) => Record<string, Record<string, (props: Record<string, unknown>) => unknown>>;
  memberListeners?: Record<string, Record<string, (...args: unknown[]) => void>>;
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
}) {
  const localeRef = ref("en");
  const instance = createDirectPanelInstance(options.manifest, {
    pageKey: "comp-fix-test",
    url: () => "/comp-fix",
    label: () => "CompFix",
    initial: options.initial,
    text: createPanelText(options.messages ?? {}, localeRef, "en"),
    ...noOperations,
    readProjection: async (id) => options.projections[id]!,
    read: async (request) => options.answer(request),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages: { en: publicEn },
  });
  const slotsByMember = options.memberSlots?.(instance) ?? {};
  const app = createApp({
    render: () =>
      h(
        "div",
        options.members.map((member) => {
          const listeners = options.memberListeners?.[member] ?? {};
          return h(PanelMember, { instance, member, ...listeners }, slotsByMember[member]);
        }),
      ),
  });
  app.use(i18n).use(ElementPlus).mount(container);
  cleanup = () => {
    app.unmount();
    container.remove();
  };
  return { instance, container };
}

describe("official component generality fixes (Items 1-4)", () => {
  it("Item 1: distinguishes owner total, loadedCount, and complete-list filteredCount without faking query totals", async () => {
    const pagedQueryProjection: DirectProjection = {
      ...meta,
      id: "apps-paged",
      name: "Paged Apps",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: { columns: [{ key: "label", labelKey: "col.name" }] },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} } },
    };
    const completeListProjection: DirectProjection = {
      ...meta,
      id: "rels-list",
      name: "Relations",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { search: { kind: "scalar", type: "string" } },
      outputs: {},
      config: { searchable: false, columns: [{ key: "label", labelKey: "col.name" }] },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: { search: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false } },
      members: {
        paged: { target: { projectionId: "apps-paged" } },
        complete: { target: { projectionId: "rels-list" }, inputs: { search: { state: "search" } } },
      },
    };

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "apps-paged": pagedQueryProjection, "rels-list": completeListProjection },
      members: ["paged", "complete"],
      messages: { en: { "col.name": "Name" } },
      answer(request) {
        if (request.memberPath.at(-1)?.member === "paged") {
          // Owner omits total: must NEVER substitute rows.length (2) as total or filteredCount.
          return ready({
            rows: [
              { primaryKey: "a-1", label: "CRM", fields: {} },
              { primaryKey: "a-2", label: "ERP", fields: {} },
            ],
            nextCursor: "page-2",
          });
        }
        return ready([
          { primaryKey: "r-1", label: "Owns", fields: {} },
          { primaryKey: "r-2", label: "DependsOn", fields: {} },
          { primaryKey: "r-3", label: "Contains", fields: {} },
        ]);
      },
    });

    await vi.waitFor(() => {
      expect(instance.outputs.paged?.loadedCount).toBe(2);
      expect(instance.outputs.complete?.filteredCount).toBe(3);
    });
    expect(instance.outputs.paged?.total ?? null).toBeNull();
    expect(instance.outputs.paged?.filteredCount ?? null).toBeNull();
    expect(instance.outputs.paged?.firstItem).toBeUndefined();
    expect(container.querySelector(".sdk-object-list-page-total")).toBeNull();

    // Complete list reports total=3, loadedCount=3, filteredCount=1 after local search.
    expect(instance.outputs.complete?.total).toBe(3);
    expect(instance.outputs.complete?.loadedCount).toBe(3);
    instance.state.set("search", "Owns");
    await vi.waitFor(() => expect(instance.outputs.complete?.filteredCount).toBe(1));
    expect(instance.outputs.complete?.total).toBe(3);
    expect(instance.outputs.complete?.loadedCount).toBe(3);
  });

  it("Item 2: removes ObjectHeader fields bag, publishes owner-declared typed read outputs on any member, and hides unavailable OperationButton", async () => {
    const headerProjection: DirectProjection = {
      ...meta,
      id: "app-header",
      name: "App Header",
      componentId: "@ontomato/sdk:ObjectHeader",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { subtitle: "", outputFields: ["secretField"] },
      data: { record: { source: { object: { input: "target" } }, read: "record", params: {} } },
    };
    const summaryProjection: DirectProjection = {
      ...meta,
      id: "app-summary",
      name: "App Summary",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { fields: ["id"] },
      data: { record: { source: { object: { input: "target" } }, read: "record", params: {} } },
    };
    const deleteBtnProjection: DirectProjection = {
      ...meta,
      id: "app-delete",
      name: "Delete App",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { operation: "delete", hideWhenUnavailable: true, type: "danger" },
      data: {},
      operations: { delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "target" } } },
    };
    const manifest: DirectPanelManifest = {
      state: { selected: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false } },
      members: {
        header: { target: { projectionId: "app-header" }, inputs: { target: { state: "selected" } } },
        summary: { target: { projectionId: "app-summary" }, inputs: { target: { state: "selected" } } },
        deleteApp: { target: { projectionId: "app-delete" }, inputs: { target: { state: "selected" } } },
      },
    };

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "app-header": headerProjection, "app-summary": summaryProjection, "app-delete": deleteBtnProjection },
      members: ["header", "summary", "deleteApp"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        if (request.operations) {
          return ready({
            delete: {
              kind: "action",
              handlerRef: "applications.delete",
              label: "Delete",
              effect: "write",
              target: { source: "input", input: "application" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
              unavailable: { reason: "Read-only" },
            },
          });
        }
        return ready({
          primaryKey: "app-1",
          className: APPLICATION,
          label: "Ontology",
          fields: { id: "app-1", secretField: "should-not-leak" },
          outputs: {
            canMaintain: false,
            canEditEntries: false,
            canGrant: true,
            domainShared: true,
            openPath: "/ontology/graph",
            undeclaredBackdoor: "must-be-ignored",
          },
        });
      },
    });

    await vi.waitFor(() => {
      expect(instance.outputs.header?.canGrant).toBe(true);
      expect(instance.outputs.summary?.openPath).toBe("/ontology/graph");
    });
    // ObjectHeader no longer exposes `fields` bag even if legacy `outputFields` is present in config.
    expect(instance.outputs.header?.fields).toBeUndefined();
    // Undeclared keys in record.outputs are never published.
    expect(instance.outputs.header?.undeclaredBackdoor).toBeUndefined();
    // Declared typed outputs are published identically on ObjectSummary (no ObjectHeader required).
    expect(instance.outputs.summary?.canMaintain).toBe(false);
    expect(instance.outputs.summary?.domainShared).toBe(true);
    // OperationButton with hideWhenUnavailable hides itself when owner reports unavailable.
    expect(container.querySelector(".sdk-operation-button")).toBeNull();
  });

  it("Item 3: keeps raw row out of ObjectList slots, row-action events, and useListRowSlot()", async () => {
    let observedLeadingArgs: unknown[] | null = null;
    let observedActionsScope: Record<string, unknown> | null = null;
    let observedSlotContextKeys: string[] = [];
    const rowActionPayloads: Record<string, unknown>[] = [];

    const ContextProbe = defineComponent({
      setup() {
        const ctx = useListRowSlot();
        observedSlotContextKeys = ctx ? Object.keys(ctx) : [];
        return () => h("span", { class: "probe-ref" }, ctx?.ref.value.primaryKey ?? "");
      },
    });

    const listProjection: DirectProjection = {
      ...meta,
      id: "compact-rels",
      name: "Relations",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        layout: "list",
        rowActions: {
          items: [{ kind: "local", id: "inspect", labelKey: "act.inspect" }],
        },
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {},
      members: { list: { target: { projectionId: "compact-rels" } } },
    };

    const { container } = mountTestPanel({
      manifest,
      projections: { "compact-rels": listProjection },
      members: ["list"],
      messages: { en: { "act.inspect": "Inspect" } },
      memberListeners: {
        list: {
          onRowAction: (payload: unknown) => rowActionPayloads.push(payload as Record<string, unknown>),
        },
      },
      memberSlots: () => ({
        list: {
          "item-leading": (...args: unknown[]) => {
            observedLeadingArgs = args;
            return h("span", { class: "lead-dot" }, "•");
          },
          actions: (scope: Record<string, unknown>) => {
            observedActionsScope = scope;
            return [h(ContextProbe)];
          },
        },
      }),
      answer: () => ready([{ primaryKey: "rel-1", label: "HasPart", fields: { secret: "hidden" } }]),
    });

    await vi.waitFor(() => expect(container.querySelector(".probe-ref")?.textContent).toBe("rel-1"));
    // #item-leading receives only { ref, index, icon } without raw business row payload.
    expect(observedLeadingArgs).toEqual([
      { ref: { className: RELATIONSHIP, primaryKey: "rel-1" }, index: 0, icon: null },
    ]);
    expect("row" in (observedLeadingArgs![0] as Record<string, unknown>)).toBe(false);
    // #actions receives ref/index/operations/runOperation without raw row.
    expect(observedActionsScope).not.toBeNull();
    expect("row" in observedActionsScope!).toBe(false);
    expect(observedActionsScope!.ref).toEqual({ className: RELATIONSHIP, primaryKey: "rel-1" });
    // Public useListRowSlot() exposes no `row` property.
    expect(observedSlotContextKeys).not.toContain("row");
    expect(observedSlotContextKeys).toContain("ref");

    // Verify local row-action event emits strictly { id, ref, index } without row.
    cleanup?.();
    const { container: c2 } = mountTestPanel({
      manifest,
      projections: { "compact-rels": listProjection },
      members: ["list"],
      messages: { en: { "act.inspect": "Inspect" } },
      memberListeners: {
        list: {
          onRowAction: (payload: unknown) => rowActionPayloads.push(payload as Record<string, unknown>),
        },
      },
      answer: () => ready([{ primaryKey: "rel-1", label: "HasPart", fields: { secret: "hidden" } }]),
    });
    await vi.waitFor(() => expect(c2.querySelector(".sdk-object-list-row-actions button")).not.toBeNull());
    c2.querySelector<HTMLButtonElement>(".sdk-object-list-row-actions button")!.click();
    expect(rowActionPayloads).toEqual([
      { id: "inspect", ref: { className: RELATIONSHIP, primaryKey: "rel-1" }, index: 0 },
    ]);
    expect("row" in rowActionPayloads[0]!).toBe(false);
  });

  it("Item 4: binds cross-type ObjectList selection to ProductPanel via read rowType with fallbackToFirst across parent switches", async () => {
    const usedPanelsProjection: DirectProjection = {
      ...meta,
      id: "used-panels",
      name: "Used Panels",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: { selected: { kind: "object", objectType: PRODUCT_PANEL } },
      config: { layout: "list", fallbackToFirst: true },
      data: { rows: { source: { object: { input: "target" } }, read: "usedPanels", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {
        selected: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false },
        inspectedPanel: { type: { kind: "object", objectType: PRODUCT_PANEL }, personal: false, deepLink: true, external: false },
      },
      members: {
        usedPanelsList: {
          target: { projectionId: "used-panels" },
          inputs: { target: { state: "selected" } },
          outputs: { selected: { state: "inspectedPanel" } },
        },
      },
    };

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "used-panels": usedPanelsProjection },
      members: ["usedPanelsList"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-a" } },
      answer(request) {
        const appId = (request.inputs.target as { primaryKey: string }).primaryKey;
        if (appId === "app-a") {
          // Intentionally omit `className` on row records to prove ObjectList resolves it from read `rowType`.
          return ready([
            { primaryKey: "panel-a1", label: "Graph Panel", fields: {} },
            { primaryKey: "panel-a2", label: "Detail Panel", fields: {} },
          ]);
        }
        return ready([{ primaryKey: "panel-b1", label: "Analytics Panel", fields: {} }]);
      },
    });

    // fallbackToFirst automatically writes full { className: "platform:ProductPanel", primaryKey } ref!
    await vi.waitFor(() => {
      expect(instance.state.values.value.inspectedPanel).toEqual({
        className: PRODUCT_PANEL,
        primaryKey: "panel-a1",
      });
    });
    expect(instance.outputs.usedPanelsList?.selectedLabel).toBe("Graph Panel");
    expect(container.querySelector(".sdk-object-list-item-btn.chosen")?.textContent).toContain("Graph Panel");

    // Clicking first item (human click on Panel A), then agent switches inspectedPanel to Panel B:
    // BOTH left highlight and right-pane label (`selectedLabel` and `activeLabel`) switch cleanly to Panel B!
    const buttons = container.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn");
    buttons[0]!.click();
    await vi.waitFor(() => {
      expect(instance.outputs.usedPanelsList?.selectedLabel).toBe("Graph Panel");
      expect(instance.outputs.usedPanelsList?.activeLabel).toBe("Graph Panel");
    });

    // Agent externally updates `inspectedPanel` to Panel B (no human click).
    instance.state.set("inspectedPanel", { className: PRODUCT_PANEL, primaryKey: "panel-a2" });
    await vi.waitFor(() => {
      expect(instance.outputs.usedPanelsList?.selectedLabel).toBe("Detail Panel");
      expect(instance.outputs.usedPanelsList?.activeLabel).toBe("Detail Panel");
    });
    expect(buttons[0]!.classList.contains("chosen")).toBe(false);
    expect(buttons[1]!.classList.contains("chosen")).toBe(true);
    expect(buttons[1]!.getAttribute("aria-selected")).toBe("true");

    // Switching parent Application clears inspectedPanel and triggers fallbackToFirst for the new parent's rows.
    instance.state.setState({
      selected: { className: APPLICATION, primaryKey: "app-b" },
      inspectedPanel: null,
    });
    await vi.waitFor(() => {
      expect(instance.state.values.value.inspectedPanel).toEqual({
        className: PRODUCT_PANEL,
        primaryKey: "panel-b1",
      });
    });
    expect(instance.outputs.usedPanelsList?.selectedLabel).toBe("Analytics Panel");
    expect(instance.outputs.usedPanelsList?.activeLabel).toBe("Analytics Panel");
  });

  it("Supplement 2: disables private row selection when neither state.selected nor @choose is wired while keeping inline row actions and reference links clickable", async () => {
    const rowActionsFired: unknown[] = [];
    const navigated: unknown[] = [];

    const readonlyTableProjection: DirectProjection = {
      ...meta,
      id: "entries-table",
      name: "Entries",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        layout: "table",
        columns: [
          { key: "label", labelKey: "col.name" },
          { key: "panel", labelKey: "col.panel", kind: "reference" },
        ],
        rowActions: {
          items: [{ kind: "local", id: "edit", labelKey: "act.edit" }],
        },
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {},
      members: { entries: { target: { projectionId: "entries-table" } } },
    };

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "entries-table": readonlyTableProjection },
      members: ["entries"],
      messages: { en: { "col.name": "Name", "col.panel": "Panel", "act.edit": "Edit" } },
      memberListeners: {
        entries: {
          onRowAction: (payload: unknown) => rowActionsFired.push(payload),
          onNavigate: (refVal: unknown) => navigated.push(refVal),
        },
      },
      answer: () =>
        ready([
          {
            primaryKey: "entry-1",
            label: "Home",
            fields: {
              panel: { kind: "reference", className: PRODUCT_PANEL, primaryKey: "p-1", label: "Home Panel" },
            },
          },
        ]),
    });

    await vi.waitFor(() => expect(container.querySelectorAll("tbody tr")).toHaveLength(1));
    const tr = container.querySelector<HTMLTableRowElement>("tbody tr")!;
    expect(tr.classList.contains("is-non-selectable")).toBe(true);
    expect(tr.getAttribute("tabindex")).toBeNull();
    expect(tr.getAttribute("aria-selected")).toBeNull();

    // Clicking the table row must NOT highlight it or write private selected state.
    tr.click();
    expect(tr.classList.contains("chosen")).toBe(false);
    expect(instance.outputs.entries?.selectedLabel ?? null).toBeNull();
    expect(instance.ownParams("entries").selected).toBeUndefined();

    // Reference links and inline row action buttons inside the non-selectable row still work normally.
    container.querySelector<HTMLButtonElement>(".sdk-object-ref-link")!.click();
    expect(navigated).toEqual([{ className: PRODUCT_PANEL, primaryKey: "p-1", label: "Home Panel" }]);

    container.querySelector<HTMLButtonElement>(".sdk-object-list-row-actions button")!.click();
    expect(rowActionsFired).toEqual([{ id: "edit", ref: { className: RELATIONSHIP, primaryKey: "entry-1" }, index: 0 }]);
  });

  it("OperationButton fail-closes on operations error: hides when hideWhenUnavailable=true, stays non-clickable when false, and renders no header buttons", async () => {
    const deleteHiddenProjection: DirectProjection = {
      ...meta,
      id: "app-delete-hidden",
      name: "Delete App (Hidden)",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { operation: "delete", hideWhenUnavailable: true, type: "danger" },
      data: {},
      operations: { delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "target" } } },
    };
    const deleteVisibleProjection: DirectProjection = {
      ...meta,
      id: "app-delete-visible",
      name: "Delete App (Visible)",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { operation: "delete", hideWhenUnavailable: false, type: "danger" },
      data: {},
      operations: { delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "target" } } },
    };
    const headerProjection: DirectProjection = {
      ...meta,
      id: "app-header-ops",
      name: "App Header",
      componentId: "@ontomato/sdk:ObjectHeader",
      inputs: { target: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      config: { fallbackTitle: "App" },
      data: { record: { source: { object: { input: "target" } }, read: "record", params: {} } },
      operations: { delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "target" } } },
    };
    const manifest: DirectPanelManifest = {
      state: { selected: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false } },
      members: {
        header: { target: { projectionId: "app-header-ops" }, inputs: { target: { state: "selected" } } },
        deleteHidden: { target: { projectionId: "app-delete-hidden" }, inputs: { target: { state: "selected" } } },
        deleteVisible: { target: { projectionId: "app-delete-visible" }, inputs: { target: { state: "selected" } } },
      },
    };

    const { container } = mountTestPanel({
      manifest,
      projections: {
        "app-header-ops": headerProjection,
        "app-delete-hidden": deleteHiddenProjection,
        "app-delete-visible": deleteVisibleProjection,
      },
      members: ["header", "deleteHidden", "deleteVisible"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        if (request.operations) {
          return { status: "error", message: "Availability read failed" };
        }
        return ready({
          primaryKey: "app-1",
          className: APPLICATION,
          label: "Ontology",
          fields: { id: "app-1" },
        });
      },
    });

    // Wait for the visible (hideWhenUnavailable=false) button member to settle into its error DataState.
    await vi.waitFor(() => {
      const rendered = container.querySelectorAll(".sdk-operation-button");
      expect(rendered).toHaveLength(1);
      expect(rendered[0]!.textContent).toContain("Availability read failed");
    });

    // Only the hideWhenUnavailable=false instance renders (in error DataState with no clickable button);
    // hideWhenUnavailable=true hides completely, and ObjectHeader renders no inline or overflow operation buttons.
    const renderedButtons = container.querySelectorAll(".sdk-operation-button");
    expect(renderedButtons).toHaveLength(1);
    expect(renderedButtons[0]!.querySelector("button")).toBeNull();
    expect(container.querySelector(".sdk-object-header-actions")).toBeNull();
    expect(container.querySelector(".sdk-object-header-more")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);

    // When the owner read is ready and admits the operation as available, hideWhenUnavailable=true renders the enabled button.
    cleanup?.();
    const { container: readyContainer } = mountTestPanel({
      manifest: {
        state: { selected: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false } },
        members: { deleteHidden: { target: { projectionId: "app-delete-hidden" }, inputs: { target: { state: "selected" } } } },
      },
      projections: { "app-delete-hidden": deleteHiddenProjection },
      members: ["deleteHidden"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-1" } },
      answer() {
        return ready({
          delete: {
            kind: "action",
            handlerRef: "applications.delete",
            label: "Delete",
            effect: "write",
            target: { source: "input", input: "target" },
            inputSchema: {},
            resultSchema: {},
            batch: false,
          },
        });
      },
    });
    await vi.waitFor(() => {
      const btn = readyContainer.querySelector<HTMLButtonElement>(".sdk-operation-button button");
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
    });
  });

  it("treats fixed literal inputs.selected as read-only highlight without listbox role or throwing on click", async () => {
    const listProjection: DirectProjection = {
      ...meta,
      id: "rels-select-list",
      name: "Relationships",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { selected: { kind: "object", objectType: RELATIONSHIP } },
      outputs: {},
      config: { layout: "list", fallbackToFirst: true },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const literalRef = { className: RELATIONSHIP, primaryKey: "rel-2" };
    const literalManifest: DirectPanelManifest = {
      state: {},
      members: {
        rels: {
          target: { projectionId: "rels-select-list" },
          inputs: { selected: { literal: literalRef } },
        },
      },
    };
    const rows = [
      { primaryKey: "rel-1", label: "First Relation", fields: {} },
      { primaryKey: "rel-2", label: "Second Relation", fields: {} },
    ];

    const { instance, container } = mountTestPanel({
      manifest: literalManifest,
      projections: { "rels-select-list": listProjection },
      members: ["rels"],
      answer: () => ready(rows),
    });
    await vi.waitFor(() => expect(container.querySelectorAll(".sdk-object-list-row")).toHaveLength(2));
    const ul = container.querySelector<HTMLUListElement>("ul.sdk-object-list-items")!;
    expect(ul.getAttribute("role")).toBeNull();
    const listItems = container.querySelectorAll<HTMLLIElement>(".sdk-object-list-row");
    const itemEls = container.querySelectorAll<HTMLElement>(".sdk-object-list-item-btn");
    expect(itemEls).toHaveLength(2);
    expect(itemEls[0]!.tagName).toBe("DIV");
    expect(itemEls[0]!.getAttribute("role")).toBeNull();
    expect(itemEls[0]!.classList.contains("is-non-selectable")).toBe(true);
    expect(itemEls[0]!.classList.contains("chosen")).toBe(false);
    expect(listItems[1]!.classList.contains("chosen")).toBe(true);
    expect(itemEls[1]!.classList.contains("chosen")).toBe(true);
    expect(instance.outputs.rels?.selectedLabel).toBe("Second Relation");

    expect(() => {
      itemEls[0]!.click();
      itemEls[1]!.click();
    }).not.toThrow();
    expect(listItems[1]!.classList.contains("chosen")).toBe(true);
    expect(instance.ownParams("rels").selected).toBeUndefined();
  });

  it("keeps state-backed inputs.selected selectable and updates public state on click", async () => {
    const listProjection: DirectProjection = {
      ...meta,
      id: "rels-select-list",
      name: "Relationships",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { selected: { kind: "object", objectType: RELATIONSHIP } },
      outputs: {},
      config: { layout: "list", fallbackToFirst: true },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {
        selectedRel: {
          type: { kind: "object", objectType: RELATIONSHIP },
          personal: false,
          deepLink: false,
          external: false,
          default: null,
        },
      },
      members: {
        rels: {
          target: { projectionId: "rels-select-list" },
          inputs: { selected: { state: "selectedRel" } },
        },
      },
    };
    const rows = [
      { primaryKey: "rel-1", label: "First Relation", fields: {} },
      { primaryKey: "rel-2", label: "Second Relation", fields: {} },
    ];

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "rels-select-list": listProjection },
      members: ["rels"],
      answer: () => ready(rows),
    });
    await vi.waitFor(() =>
      expect(instance.state.values.value.selectedRel).toEqual({
        className: RELATIONSHIP,
        primaryKey: "rel-1",
      }),
    );
    expect(container.querySelector<HTMLUListElement>("ul.sdk-object-list-items")!.getAttribute("role")).toBe("listbox");
    const buttons = container.querySelectorAll<HTMLButtonElement>("button.sdk-object-list-item-btn[role='option']");
    expect(buttons).toHaveLength(2);
    buttons[1]!.click();
    await vi.waitFor(() =>
      expect(instance.state.values.value.selectedRel).toEqual({
        className: RELATIONSHIP,
        primaryKey: "rel-2",
      }),
    );
  });

  it("keeps outputs.selected selectable and updates public state on click", async () => {
    const outputListProjection: DirectProjection = {
      ...meta,
      id: "rels-output-list",
      name: "Relationships",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: RELATIONSHIP } },
      config: { layout: "list" },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
    };
    const manifest: DirectPanelManifest = {
      state: {
        selectedRel: {
          type: { kind: "object", objectType: RELATIONSHIP },
          personal: false,
          deepLink: false,
          external: false,
          default: null,
        },
      },
      members: {
        rels: {
          target: { projectionId: "rels-output-list" },
          outputs: { selected: { state: "selectedRel" } },
        },
      },
    };
    const rows = [
      { primaryKey: "rel-1", label: "First Relation", fields: {} },
      { primaryKey: "rel-2", label: "Second Relation", fields: {} },
    ];

    const { instance, container } = mountTestPanel({
      manifest,
      projections: { "rels-output-list": outputListProjection },
      members: ["rels"],
      answer: () => ready(rows),
    });
    await vi.waitFor(() =>
      expect(container.querySelectorAll("button.sdk-object-list-item-btn[role='option']")).toHaveLength(2),
    );
    expect(container.querySelector("ul.sdk-object-list-items")?.getAttribute("role")).toBe("listbox");
    container.querySelectorAll<HTMLButtonElement>("button.sdk-object-list-item-btn[role='option']")[1]!.click();
    await vi.waitFor(() =>
      expect(instance.state.values.value.selectedRel).toEqual({
        className: RELATIONSHIP,
        primaryKey: "rel-2",
      }),
    );
  });

  it("keeps fixed literal inputs.selected safe with @choose and avoids writing fixed literal search/checked inputs", async () => {
    const chosenEvents: unknown[] = [];
    const cardsProjection: DirectProjection = {
      ...meta,
      id: "apps-cards",
      name: "Apps Cards",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        selected: { kind: "object", objectType: APPLICATION },
        checked: { kind: "list", items: { kind: "object", objectType: APPLICATION } },
        q: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: { layout: "cards" },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: APPLICATION } },
          read: "query",
          params: { search: { input: "q" } },
        },
      },
    };
    const fixedRef = { className: APPLICATION, primaryKey: "app-1" };
    const manifest: DirectPanelManifest = {
      state: {},
      members: {
        apps: {
          target: { projectionId: "apps-cards" },
          inputs: {
            selected: { literal: fixedRef },
            checked: { literal: [fixedRef] },
            q: { literal: "fixed-term" },
          },
        },
      },
    };
    let toggleCheckFn: (() => void) | null = null;
    const { container } = mountTestPanel({
      manifest,
      projections: { "apps-cards": cardsProjection },
      members: ["apps"],
      memberListeners: {
        apps: {
          onChoose: (val: unknown) => chosenEvents.push(val),
        },
      },
      memberSlots: () => ({
        apps: {
          card: (slotProps: Record<string, unknown>) => {
            toggleCheckFn = slotProps.toggleCheck as () => void;
            return h("span", { class: "custom-card-label" }, String(slotProps.checked));
          },
        },
      }),
      answer: () => ready({ rows: [{ primaryKey: "app-1", label: "First App", fields: {} }], total: 1 }),
    });

    await vi.waitFor(() => expect(container.querySelectorAll(".sdk-object-list-card")).toHaveLength(1));
    // Mapped fixed literal search input must not render an editable search box.
    expect(container.querySelector("input[type='search']")).toBeNull();
    // Clicking card with @choose + fixed literal selected emits choose without calling selectedParam.set().
    expect(() => container.querySelector<HTMLElement>(".sdk-object-list-card")!.click()).not.toThrow();
    expect(chosenEvents).toEqual([fixedRef]);
    // Calling toggleCheck from card slot with fixed literal checked does not throw.
    expect(() => toggleCheckFn?.()).not.toThrow();
  });
});
