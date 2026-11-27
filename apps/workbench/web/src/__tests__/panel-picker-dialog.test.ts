import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { USER } from "@ontomato/contracts/panel-client-requests";
import { PERMISSION_POLICY } from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import PickerDialog from "../../../../../packages/apps-sdk/src/base/PickerDialog.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

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

async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function makeManifest(projectionId = "member-picker"): DirectPanelManifest {
  return {
    state: {
      pickerOpen: { type: { kind: "scalar", type: "boolean" }, default: false, deepLink: false, personal: false, external: false },
      selectedIds: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, default: [], deepLink: false, personal: false, external: false },
    },
    members: {
      picker: {
        target: { projectionId },
        inputs: {
          open: { state: "pickerOpen" },
          selected: { state: "selectedIds" },
        },
        outputs: {
          open: { state: "pickerOpen" },
          selected: { state: "selectedIds" },
        },
      },
    },
  };
}

function makeOptionsProjection(config: Record<string, RuntimeJsonValue> = {}): DirectProjection {
  return {
    ...meta,
    id: "member-picker",
    name: "Member picker",
    componentId: "@ontomato/sdk:PickerDialog",
    inputs: {
      open: { kind: "scalar", type: "boolean" },
      selected: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    outputs: {
      open: { kind: "scalar", type: "boolean" },
      selected: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    config,
    data: {
      options: {
        source: { type: { kind: "PlatformObjectType", id: USER } },
        read: "options",
        params: {},
      },
    },
  };
}

function makeRowsProjection(config: Record<string, RuntimeJsonValue> = {}): DirectProjection {
  return {
    ...meta,
    id: "rows-picker",
    name: "Rows picker",
    componentId: "@ontomato/sdk:PickerDialog",
    inputs: {
      open: { kind: "scalar", type: "boolean" },
      selected: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    outputs: {
      open: { kind: "scalar", type: "boolean" },
      selected: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    config,
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: USER } },
        read: "query",
        params: {},
      },
    },
  };
}

function mountPanel(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    locale?: string;
    messages?: Record<string, Record<string, string>>;
    onConfirm?: (keys: string[]) => void;
    onCancel?: () => void;
    extraSlot?: (scope: { selected: readonly string[]; count: number; changed: boolean }) => ReturnType<typeof h>;
  } = {},
) {
  const localeRef = ref(options.locale ?? "en");
  const reads: Extract<PanelMemberReadRequest, { dataName: string }>[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "picker-dialog-test",
    url: () => "/picker",
    label: () => "Picker",
    initial: options.initial as never,
    text: createPanelText(options.messages ?? {}, localeRef, "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      if ("dataName" in request && request.dataName) {
        reads.push(request);
      }
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
  const slots = options.extraSlot
    ? { extra: (scope: { selected: readonly string[]; count: number; changed: boolean }) => [options.extraSlot!(scope)] }
    : undefined;
  const app = createApp({
    render: () =>
      h(
        PanelMember,
        {
          instance,
          member: "picker",
          onConfirm: options.onConfirm,
          onCancel: options.onCancel,
        },
        slots,
      ),
  });
  app.use(i18n).use(ElementPlus).mount(container);
  cleanup = () => {
    app.unmount();
    container.remove();
  };
  return { container, reads, instance };
}

function getSearchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input[data-picker-search], [data-picker-search] input");
  if (!input) throw new Error("Picker search input not found");
  return input;
}

function setSearchValue(value: string) {
  const input = getSearchInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function getOptionRow(key: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-picker-option="${key}"]`);
  if (!row) throw new Error(`Option row '${key}' not found`);
  return row;
}

function getConfirmButton(): HTMLButtonElement {
  const btn = document.querySelector<HTMLButtonElement>("[data-picker-confirm]");
  if (!btn) throw new Error("Confirm button not found");
  return btn;
}

function getCancelButton(): HTMLButtonElement {
  const btn = document.querySelector<HTMLButtonElement>("[data-picker-cancel]");
  if (!btn) throw new Error("Cancel button not found");
  return btn;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

describe("PickerDialog", () => {
  it("pre-checks selected items, lists unavailable items with inline disabledReason (no tooltip), disables confirm when unchanged, and emits primary keys on confirm", async () => {
    const confirmed = vi.fn();
    const { reads, instance } = mountPanel(
      makeManifest(),
      {
        "member-picker": makeOptionsProjection({
          titleKey: "picker.title",
          confirmLabelKey: "picker.confirm",
        }),
      },
      () =>
        ready({
          options: [
            { primaryKey: "u-1", value: "u-1", label: "Alice", description: "Engineering" },
            { primaryKey: "u-2", value: "u-2", label: "Bob", description: "Analytics" },
            {
              primaryKey: "u-3",
              value: "u-3",
              label: "Carol",
              description: "Security",
              unavailable: { reason: "Already assigned to this role" },
            },
          ],
          total: 3,
        }),
      {
        locale: "zh-CN",
        initial: { pickerOpen: false, selectedIds: ["u-1"] },
        messages: {
          "zh-CN": {
            "picker.title": "添加成员",
            "picker.confirm": "添加 ({count})",
          },
        },
        onConfirm: confirmed,
      },
    );

    await settle();
    // Closed on mount -> no owner read fired yet.
    expect(reads).toHaveLength(0);

    // Open through public panel state (same path an agent uses via present).
    instance.state.set("pickerOpen", true);
    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(document.querySelector('[data-picker-option="u-1"]')).not.toBeNull();
    });
    expect(document.querySelector(".el-dialog__title")?.textContent?.trim()).toBe("添加成员");

    const row1 = getOptionRow("u-1");
    const row2 = getOptionRow("u-2");
    const row3 = getOptionRow("u-3");

    // Pre-checked u-1.
    expect(row1.getAttribute("aria-selected")).toBe("true");
    expect(row2.getAttribute("aria-selected")).toBe("false");

    // Unavailable row: listed, disabled checkbox, inline reason in secondary description, no hover tooltip.
    expect(row3.getAttribute("aria-disabled")).toBe("true");
    expect(row3.getAttribute("title")).toBeNull();
    const row3Checkbox = row3.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(row3Checkbox?.disabled).toBe(true);
    expect(row3.querySelector(".sdk-picker-dialog-option-description")?.textContent?.trim()).toBe(
      "Security · Already assigned to this role",
    );

    // Footer left shows "已选 1 项"; confirm shows "添加 (1)" and is disabled because selection matches open snapshot.
    expect(document.querySelector("[data-picker-selected-count]")?.textContent?.trim()).toBe("已选 1 项");
    const confirmBtn = getConfirmButton();
    expect(confirmBtn.textContent?.trim()).toBe("添加 (1)");
    expect(confirmBtn.disabled).toBe(true);

    // Clicking disabled row does nothing.
    row3.click();
    await settle(2);
    expect(row3.getAttribute("aria-selected")).toBe("false");
    expect(confirmBtn.disabled).toBe(true);

    // Clicking u-2 selects it and enables Confirm.
    row2.click();
    await settle(2);
    expect(row2.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-picker-selected-count]")?.textContent?.trim()).toBe("已选 2 项");
    expect(confirmBtn.textContent?.trim()).toBe("添加 (2)");
    expect(confirmBtn.disabled).toBe(false);

    // Unchecking u-2 returns to the exact opening set -> Confirm disables again.
    row2.click();
    await settle(2);
    expect(confirmBtn.disabled).toBe(true);

    // Re-check u-2 via checkbox input itself (must toggle once, not twice).
    const row2Checkbox = row2.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    row2Checkbox.click();
    await settle(2);
    expect(row2.getAttribute("aria-selected")).toBe("true");
    expect(confirmBtn.disabled).toBe(false);

    // Confirm writes public panel state `selected`, closes `open`, and emits primary key array.
    confirmBtn.click();
    await settle();
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith(["u-1", "u-2"]);
    expect(instance.state.values.value.selectedIds).toEqual(["u-1", "u-2"]);
    expect(instance.state.values.value.pickerOpen).toBe(false);
  });

  it("reloads candidates when a state-bound read parameter changes while the dialog is open", async () => {
    const manifest = makeManifest();
    manifest.state.objectPickerField = {
      type: { kind: "scalar", type: "string" }, default: "actionGrants", deepLink: false, personal: false, external: false,
    };
    manifest.members.picker!.inputs!.field = { state: "objectPickerField" };
    const projection = makeOptionsProjection();
    projection.inputs.field = { kind: "scalar", type: "string" };
    projection.data.options = {
      source: { object: { literal: { className: PERMISSION_POLICY, primaryKey: "policy-1" } } },
      read: "objectGrantCandidates",
      params: {},
    };
    const { reads, instance } = mountPanel(
      manifest,
      { "member-picker": projection },
      (request) => {
        const field = "inputs" in request ? request.inputs.field : undefined;
        const action = field !== "triggerGrants";
        return ready({
          options: [{
            primaryKey: action ? "action-1" : "trigger-1",
            value: action ? "action-1" : "trigger-1",
            label: action ? "Approve expense" : "e2e scheduled governance",
          }],
          total: 1,
        });
      },
      { initial: { pickerOpen: true, selectedIds: [], objectPickerField: "actionGrants" } },
    );

    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(document.querySelector('[data-picker-option="action-1"]')).not.toBeNull();
    });
    expect(reads[0]!.inputs.field).toBe("actionGrants");

    instance.state.set("objectPickerField", "triggerGrants");

    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
      expect(document.querySelector('[data-picker-option="trigger-1"]')).not.toBeNull();
    });
    expect(reads[1]!.inputs.field).toBe("triggerGrants");
    expect(document.querySelector('[data-picker-option="action-1"]')).toBeNull();
  });

  it("filters locally without extra owner requests when the owner returns a complete list", async () => {
    const { reads } = mountPanel(
      makeManifest(),
      { "member-picker": makeOptionsProjection() },
      () =>
        ready({
          options: [
            { primaryKey: "u-1", value: "u-1", label: "Alice Chen", description: "Platform" },
            { primaryKey: "u-2", value: "u-2", label: "Bob Lin", description: "Billing" },
            { primaryKey: "u-3", value: "u-3", label: "Cara Wu", description: "Platform" },
          ],
          total: 3,
        }),
      { initial: { pickerOpen: true, selectedIds: ["u-1"] } },
    );

    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(document.querySelector('[data-picker-option="u-1"]')).not.toBeNull();
    });
    expect(document.querySelector("[data-picker-truncated]")).toBeNull();

    setSearchValue("bob");
    await settle(2);
    // Complete list -> strictly local filter, zero extra requests.
    expect(reads).toHaveLength(1);
    expect(document.querySelectorAll("[data-picker-option]")).toHaveLength(1);
    expect(getOptionRow("u-2").textContent).toContain("Bob Lin");

    // Selecting Bob while Alice is filtered out keeps Alice selected too.
    getOptionRow("u-2").click();
    await settle(2);
    expect(document.querySelector("[data-picker-selected-count]")?.textContent?.trim()).toBe("2 selected");
    expect(getConfirmButton().textContent?.trim()).toBe("Confirm (2)");

    // Non-matching query shows no-match empty state.
    setSearchValue("nobody-matches");
    await settle(2);
    expect(reads).toHaveLength(1);
    expect(document.querySelector("[data-picker-state='empty']")).not.toBeNull();
  });

  it("delegates search as keyword to the owner and shows the narrow-results notice when options are truncated", async () => {
    const { reads } = mountPanel(
      makeManifest(),
      { "member-picker": makeOptionsProjection() },
      (request) => {
        const runtime = "runtimeParams" in request ? request.runtimeParams : undefined;
        const keyword = typeof runtime?.keyword === "string" ? runtime.keyword : "";
        if (!keyword) {
          return ready({
            options: [
              { primaryKey: "u-1", value: "u-1", label: "Alice" },
              { primaryKey: "u-2", value: "u-2", label: "Bob" },
            ],
            total: 120,
          });
        }
        return ready({
          options: [{ primaryKey: "u-99", value: "u-99", label: "Zoe Zhang", description: "Matched remotely" }],
          total: 1,
        });
      },
      { locale: "zh-CN", initial: { pickerOpen: true, selectedIds: [] } },
    );

    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(document.querySelector("[data-picker-truncated]")).not.toBeNull();
    });
    const notice = document.querySelector("[data-picker-truncated]");
    expect(notice?.textContent).toContain("请搜索缩小范围");

    setSearchValue("zoe");
    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
      expect(document.querySelector('[data-picker-option="u-99"]')).not.toBeNull();
    });
    expect(reads[1]!.runtimeParams?.keyword).toBe("zoe");
    expect(document.querySelectorAll("[data-picker-option]")).toHaveLength(1);
    expect(getOptionRow("u-99").textContent).toContain("Zoe Zhang");
    // Narrowed answer has total === 1 === loaded -> truncation notice clears.
    expect(document.querySelector("[data-picker-truncated]")).toBeNull();

    // Clearing the search re-reads the unfiltered list from the owner.
    setSearchValue("");
    await vi.waitFor(() => {
      expect(reads).toHaveLength(3);
      expect(document.querySelector("[data-picker-truncated]")).not.toBeNull();
    });
    expect(reads[2]!.runtimeParams?.keyword).toBeUndefined();
  });

  it("delegates search on truncated panelRecordQuery rows using the read's search parameter", async () => {
    const { reads } = mountPanel(
      makeManifest("rows-picker"),
      { "rows-picker": makeRowsProjection() },
      (request) => {
        const runtime = "runtimeParams" in request ? request.runtimeParams : undefined;
        const search = typeof runtime?.search === "string" ? runtime.search : "";
        if (!search) {
          return ready({
            rows: [
              { primaryKey: "u-1", label: "Alice", subtitle: "alice@example.com", fields: {} },
            ],
            hasMore: true,
          });
        }
        return ready({
          rows: [
            { primaryKey: "u-42", label: "David", subtitle: "david@example.com", fields: {} },
          ],
          hasMore: false,
          total: 1,
        });
      },
      { initial: { pickerOpen: true, selectedIds: [] } },
    );

    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(document.querySelector("[data-picker-truncated]")).not.toBeNull();
    });
    expect(document.querySelector("[data-picker-truncated]")?.textContent).toContain("Search to narrow results");

    setSearchValue("david");
    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
      expect(document.querySelector('[data-picker-option="u-42"]')).not.toBeNull();
    });
    expect(reads[1]!.runtimeParams?.search).toBe("david");
    expect(getOptionRow("u-42").textContent).toContain("David");
  });

  it("supports keyboard navigation (ArrowDown/ArrowUp/Home/End/Space/Enter/Ctrl+Enter) and cancel without mutating selected", async () => {
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    const { instance } = mountPanel(
      makeManifest(),
      { "member-picker": makeOptionsProjection() },
      () =>
        ready({
          options: [
            { primaryKey: "u-1", value: "u-1", label: "Alice" },
            { primaryKey: "u-2", value: "u-2", label: "Bob", unavailable: { reason: "Locked" } },
            { primaryKey: "u-3", value: "u-3", label: "Carol" },
          ],
          total: 3,
        }),
      {
        initial: { pickerOpen: true, selectedIds: [] },
        onConfirm: confirmed,
        onCancel: cancelled,
      },
    );

    await vi.waitFor(() => {
      expect(document.querySelector('[data-picker-option="u-1"]')).not.toBeNull();
    });

    // ArrowDown from search input focuses first row.
    const searchInput = getSearchInput();
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle(2);
    const row1 = getOptionRow("u-1");
    const row2 = getOptionRow("u-2");
    const row3 = getOptionRow("u-3");
    expect(document.activeElement).toBe(row1);

    // Space toggles first row.
    row1.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await settle(2);
    expect(row1.getAttribute("aria-selected")).toBe("true");

    // ArrowDown focuses disabled row2; Space must NOT toggle it.
    row1.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle(2);
    expect(document.activeElement).toBe(row2);
    row2.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await settle(2);
    expect(row2.getAttribute("aria-selected")).toBe("false");

    // End focuses last row (row3), Enter toggles it.
    row2.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await settle(2);
    expect(document.activeElement).toBe(row3);
    row3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle(2);
    expect(row3.getAttribute("aria-selected")).toBe("true");

    // Cancel closes without mutating selected or emitting confirm.
    getCancelButton().click();
    await settle();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
    expect(instance.state.values.value.pickerOpen).toBe(false);
    expect(instance.state.values.value.selectedIds).toEqual([]);

    // Re-open, toggle via Space, confirm via Ctrl+Enter.
    instance.state.set("pickerOpen", true);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-picker-option="u-3"]')).not.toBeNull();
    });
    const reopenedRow3 = getOptionRow("u-3");
    reopenedRow3.focus();
    reopenedRow3.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await settle(2);
    reopenedRow3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await settle();
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith(["u-3"]);
    expect(instance.state.values.value.selectedIds).toEqual(["u-3"]);
  });

  it("renders the #extra slot with live selection scope and retries failed owner reads", async () => {
    let attempts = 0;
    mountPanel(
      makeManifest(),
      { "member-picker": makeOptionsProjection() },
      () => {
        attempts += 1;
        if (attempts === 1) return { status: "error", message: "Backend temporarily unavailable" };
        return ready({
          options: [{ primaryKey: "u-1", value: "u-1", label: "Alice" }],
          total: 1,
        });
      },
      {
        initial: { pickerOpen: true, selectedIds: [] },
        extraSlot: ({ count, changed }) =>
          h("div", { class: "custom-extra" }, `Extra count=${count} changed=${changed}`),
      },
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-picker-state='error']")).not.toBeNull();
    });
    expect(document.querySelector("[data-picker-extra]")?.textContent?.trim()).toBe("Extra count=0 changed=false");
    expect(document.querySelector("[data-picker-state='error']")?.textContent).toContain("Backend temporarily unavailable");

    document.querySelector<HTMLButtonElement>("[data-picker-state='error'] button")?.click();
    await vi.waitFor(() => {
      expect(attempts).toBe(2);
      expect(document.querySelector('[data-picker-option="u-1"]')).not.toBeNull();
    });
    getOptionRow("u-1").click();
    await settle(2);
    expect(document.querySelector("[data-picker-extra]")?.textContent?.trim()).toBe("Extra count=1 changed=true");
  });

  it("accepts explicit PanelFormOption[] directly when no owner datum is bound", async () => {
    const confirmed = vi.fn();
    const open = ref(true);
    const options: PanelFormOption[] = [
      { value: "skill-a", label: "SQL Analyst", description: "Runs SQL queries", disabled: false, disabledReason: null },
      { value: "skill-b", label: "Legacy Export", description: "Deprecated", disabled: true, disabledReason: "Incompatible with this agent" },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      messages: { en: publicEn },
    });
    const app = createApp({
      render: () =>
        h(PickerDialog, {
          open: open.value,
          selected: [],
          options,
          title: "Add skills",
          confirmLabel: "Add ({count})",
          "onUpdate:open": (v: boolean) => { open.value = v; },
          onConfirm: confirmed,
        }),
    });
    app.use(i18n).use(ElementPlus).mount(container);
    cleanup = () => {
      app.unmount();
      container.remove();
    };

    await settle();
    expect(getOptionRow("skill-b").querySelector(".sdk-picker-dialog-option-description")?.textContent?.trim()).toBe(
      "Deprecated · Incompatible with this agent",
    );
    getOptionRow("skill-a").click();
    await settle(2);
    expect(getConfirmButton().textContent?.trim()).toBe("Add (1)");
    getConfirmButton().click();
    await settle();
    expect(confirmed).toHaveBeenCalledWith(["skill-a"]);
    expect(open.value).toBe(false);
  });

  it("provides localized UI strings across all 8 platform locales", async () => {
    const locales = ["en", "zh-CN", "zh-TW", "ja", "ar", "fr", "de", "it"] as const;
    for (const loc of locales) {
      mountPanel(
        makeManifest(),
        { "member-picker": makeOptionsProjection() },
        () =>
          ready({
            options: [{ primaryKey: "u-1", value: "u-1", label: "Alice" }],
            total: 10,
          }),
        { locale: loc, initial: { pickerOpen: true, selectedIds: ["u-1"] } },
      );
      await vi.waitFor(() => {
        expect(document.querySelector('[data-picker-option="u-1"]')).not.toBeNull();
      });
      const title = document.querySelector(".el-dialog__title")?.textContent?.trim() ?? "";
      const selectedCount = document.querySelector("[data-picker-selected-count]")?.textContent?.trim() ?? "";
      const confirmLabel = getConfirmButton().textContent?.trim() ?? "";
      const truncated = document.querySelector("[data-picker-truncated]")?.textContent?.trim() ?? "";
      for (const text of [title, selectedCount, confirmLabel, truncated]) {
        expect(text.length, `${loc}: empty text`).toBeGreaterThan(0);
        expect(text, `${loc}: raw key leak`).not.toContain("picker");
      }
      expect(selectedCount, loc).toContain("1");
      expect(confirmLabel, loc).toContain("1");
      cleanup?.();
      cleanup = null;
      document.body.innerHTML = "";
    }
  });
});
