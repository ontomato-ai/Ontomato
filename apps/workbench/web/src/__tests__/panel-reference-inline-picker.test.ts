import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  AGENT_DEFINITION,
  MODEL_OPTION,
  OBJECT_TYPE,
  USER,
} from "@ontomato/contracts/panel-client-requests";
import {
  createDirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Official SDK ReferencePicker component:
 * - Form field mode (with `formField`) remains 100% backward compatible: attaches `ReferenceChoice` to `ObjectForm`
 *   and renders nothing at the picker's own mount point.
 * - Standalone inline mode (without `formField`):
 *   - `data.rows` (`panelRecordList` / `panelRecordQuery`): renders compact inline `<el-select>`, filters locally
 *     with 0 extra requests while typing, writes `{ className, primaryKey }` / `null` via `selected`, and reflects
 *     controlled state changes.
 *   - `data.options` (`panelOptionList`, optional `data.selected`): supports remote search when `keyword` is declared,
 *     resolves held / unavailable options via `selected`, and maps null-valued choices to `null`.
 *   - `forbidden` / `error` data states disable the select and surface a readable tooltip (`title`).
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

function mountPanel(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    locale?: string;
    messages?: Record<string, Record<string, string>>;
    members?: readonly string[];
  } = {},
) {
  const localeRef = ref(options.locale ?? "en");
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "inline-picker-test",
    url: () => "/picker",
    label: () => "Picker",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, localeRef, "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const i18n = createI18n({
    legacy: false,
    locale: localeRef.value,
    fallbackLocale: "en",
    messages: { en: publicEn, "zh-CN": publicEn },
  });
  const app = createApp({
    render: () => memberKeys.map((member) => h(PanelMember, { instance, member })),
  });
  app.use(i18n).use(ElementPlus).mount(container);
  cleanup = () => {
    app.unmount();
    container.remove();
  };
  return { container, reads, instance };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

it("keeps form field mode intact when formField is declared and renders nothing at its own site", async () => {
  const formProjection: DirectProjection = {
    ...meta,
    id: "agent-form",
    name: "Agent form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      agent: { kind: "object", objectType: AGENT_DEFINITION },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: "agent" } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } },
    },
  };
  const pickerProjection: DirectProjection = {
    ...meta,
    id: "model-picker",
    name: "Model picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: {},
    config: {},
    data: {
      options: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "options", params: {} },
      selected: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "resolve", params: {} },
    },
    operations: {},
  };
  const manifest: DirectPanelManifest = {
    state: {
      agent: { type: { kind: "object", objectType: AGENT_DEFINITION }, personal: false, deepLink: false, external: false },
    },
    members: {
      form: { target: { projectionId: formProjection.id }, inputs: { agent: { state: "agent" } } },
      model: { target: { projectionId: pickerProjection.id }, inputs: {}, formField: { slot: "form", path: "/model" } },
    },
    commands: {},
  };

  const fields = [
    {
      path: "/model",
      label: "Model",
      required: false,
      readOnly: false,
      valueSchema: {},
      control: { kind: "reference", objectType: MODEL_OPTION, multiple: false },
    },
  ];
  const gpt = { primaryKey: "openai/gpt", value: "openai/gpt", label: "GPT" };

  const { container } = mountPanel(
    manifest,
    { [formProjection.id]: formProjection, [pickerProjection.id]: pickerProjection },
    (request) => {
      if ("operations" in request) {
        return ready({
          save: {
            kind: "form.save",
            handlerRef: `${AGENT_DEFINITION}.save`,
            label: "Save",
            effect: "write",
            target: { source: "input", input: "agent" },
            inputSchema: {},
            resultSchema: {},
            batch: false,
          },
        });
      }
      if (request.dataName === "options") return ready({ options: [gpt] });
      if (request.dataName === "selected") return ready({ options: [gpt] });
      return ready({
        fields,
        values: { model: "openai/gpt" },
        errors: [],
        revision: 1,
        save: { method: "PUT", path: "/agents/:id", bodySchema: {}, draftOperation: "agent.update" },
      });
    },
    { initial: { agent: { className: AGENT_DEFINITION, primaryKey: "a-1" } } },
  );

  await vi.waitFor(() => {
    expect(container.querySelector('[data-field="/model"] .el-select__selected-item:not(.is-hidden)')?.textContent?.trim()).toBe("GPT");
  });
  // Must not mount an inline picker wrapper when attached to a formField.
  expect(container.querySelector(".sdk-inline-reference-picker")).toBeNull();
});

it("inline rows mode selects, clears, echoes controlled state, and filters locally with 0 extra requests", async () => {
  const startPicker: DirectProjection = {
    ...meta,
    id: "path-start-picker",
    name: "Path start",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: OBJECT_TYPE } },
    config: { placeholderKey: "path.startPlaceholder", clearable: true },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      startType: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    },
    members: {
      start: {
        target: { projectionId: startPicker.id },
        inputs: { selected: { state: "startType" } },
        outputs: { selected: { state: "startType" } },
      },
    },
    commands: {},
  };

  const rows = [
    { primaryKey: "Person", label: "Person", subtitle: "Human actor", fields: {} },
    { primaryKey: "Order", label: "Order", subtitle: "Sales order", fields: {} },
    { primaryKey: "Warehouse", label: "Warehouse", subtitle: "Storage site", fields: {} },
  ];

  const { container, reads, instance } = mountPanel(
    manifest,
    { [startPicker.id]: startPicker },
    () => ready(rows),
    {
      initial: { startType: { className: OBJECT_TYPE, primaryKey: "Person" } },
      messages: { en: { "path.startPlaceholder": "Start object type" } },
    },
  );

  // Controlled echo of initial state.
  await vi.waitFor(() => {
    const picker = container.querySelector(".sdk-inline-reference-picker");
    expect(picker?.getAttribute("data-state")).toBe("ready");
    expect(picker?.querySelector(".el-select__selected-item:not(.is-hidden)")?.textContent?.trim()).toBe("Person");
  });
  expect(reads).toHaveLength(1);

  // Open dropdown and type into filter input: must filter locally with 0 extra read requests.
  const wrapper = container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper")!;
  wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = await vi.waitFor(() => {
    const el = container.querySelector<HTMLInputElement>(".sdk-inline-reference-picker input.el-select__input");
    if (!el) throw new Error("Filter input not found");
    return el;
  });
  input.value = "Ware";
  input.dispatchEvent(new Event("input", { bubbles: true }));

  await vi.waitFor(() => {
    const visibleItems = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .filter((el) => el.style.display !== "none");
    expect(visibleItems.map((el) => el.querySelector(".sdk-reference-option-label")?.textContent?.trim())).toEqual(["Warehouse"]);
  });
  // Strictly zero new requests while typing in rows mode.
  expect(reads).toHaveLength(1);

  // Click filtered option -> writes { className, primaryKey } to panel state.
  const warehouseOption = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
    .find((el) => el.textContent?.includes("Warehouse"))!;
  warehouseOption.click();

  await vi.waitFor(() => {
    expect(instance.state.values.value.startType).toEqual({ className: OBJECT_TYPE, primaryKey: "Warehouse" });
  });

  // External state update echoes back into the select.
  instance.state.set("startType", { className: OBJECT_TYPE, primaryKey: "Order" });
  await nextTick();
  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker .el-select__placeholder")?.textContent?.trim()).toBe("Order");
  });

  // Clear selection via state/clear icon -> resets to null.
  wrapper.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await nextTick();
  const clearIcon = container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__clear");
  expect(clearIcon).not.toBeNull();
  clearIcon!.click();

  await vi.waitFor(() => {
    expect(instance.state.values.value.startType).toBeNull();
  });
});

it("inline options mode supports remote search, resolves held unavailable items, and handles null choices", async () => {
  const userPicker: DirectProjection = {
    ...meta,
    id: "owner-picker",
    name: "Owner picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: USER } },
    config: { placeholder: "Select owner" },
    data: {
      options: {
        source: { type: { kind: "PlatformObjectType", id: USER } },
        read: "options",
        params: {},
      },
      selected: {
        source: { type: { kind: "PlatformObjectType", id: USER } },
        read: "resolve",
        params: {},
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      owner: { type: { kind: "object", objectType: USER }, personal: false, deepLink: false, external: false },
    },
    members: {
      ownerPicker: {
        target: { projectionId: userPicker.id },
        inputs: { selected: { state: "owner" } },
        outputs: { selected: { state: "owner" } },
      },
    },
    commands: {},
  };

  const alice = { primaryKey: "u-alice", value: "u-alice", label: "Alice Chen" };
  const bob = { primaryKey: "u-bob", value: "u-bob", label: "Bob Lin" };
  const departed = {
    primaryKey: "u-legacy",
    value: "u-legacy",
    label: "Legacy User",
    unavailable: { reason: "Account deactivated" },
  };
  const clearOption = { primaryKey: "@none", value: null, label: "Unassigned" };

  const { container, reads, instance } = mountPanel(
    manifest,
    { [userPicker.id]: userPicker },
    (request) => {
      if ("dataName" in request && request.dataName === "selected") {
        return ready({ options: [departed] });
      }
      if ("dataName" in request && request.dataName === "options") {
        const keyword = String((request.runtimeParams as Record<string, unknown> | undefined)?.keyword ?? "");
        const all = [clearOption, alice, bob];
        const filtered = keyword ? all.filter((o) => o.label.toLowerCase().includes(keyword.toLowerCase())) : all;
        return ready({ options: filtered });
      }
      return { status: "empty" };
    },
    { initial: { owner: { className: USER, primaryKey: "u-legacy" } } },
  );

  // Held unavailable user is resolved via `selected` datum and shown as current label.
  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker .el-select__selected-item:not(.is-hidden)")?.textContent?.trim()).toBe("Legacy User");
  });

  // Open dropdown: unavailable item stays listed and disabled, alongside offered choices.
  const wrapper = container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper")!;
  wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => {
    const items = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")];
    const legacyEl = items.find((el) => el.textContent?.includes("Legacy User"));
    expect(legacyEl).toBeTruthy();
    expect(legacyEl?.classList.contains("is-disabled")).toBe(true);
    expect(legacyEl?.getAttribute("title")).toBe("Account deactivated");
  });

  // Remote search sends keyword to options read.
  const input = container.querySelector<HTMLInputElement>(".sdk-inline-reference-picker input.el-select__input")!;
  input.value = "Bob";
  input.dispatchEvent(new Event("input", { bubbles: true }));

  await vi.waitFor(() => {
    const keywordRead = reads.find(
      (r) => "dataName" in r && r.dataName === "options" && (r.runtimeParams as Record<string, unknown> | undefined)?.keyword === "Bob",
    );
    expect(keywordRead).toBeTruthy();
  });

  // Choosing Bob updates panel state.
  const bobEl = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((el) => el.textContent?.includes("Bob Lin"));
    if (!found) throw new Error("Bob not found");
    return found;
  });
  bobEl.click();

  await vi.waitFor(() => {
    expect(instance.state.values.value.owner).toEqual({ className: USER, primaryKey: "u-bob" });
  });

  // Choosing owner's null option clears panel state to null.
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const unassignedEl = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((el) => el.textContent?.includes("Unassigned"));
    if (!found) throw new Error("Unassigned not found");
    return found;
  });
  unassignedEl.click();

  await vi.waitFor(() => {
    expect(instance.state.values.value.owner).toBeNull();
  });
});

it("disables inline picker with readable tooltip when rows or options data is forbidden or errors", async () => {
  const rowsProjection: DirectProjection = {
    ...meta,
    id: "forbidden-rows-picker",
    name: "Forbidden rows picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: OBJECT_TYPE } },
    config: { placeholder: "Pick type" },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
    },
  };
  const rowsManifest: DirectPanelManifest = {
    state: {
      picked: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    },
    members: {
      picker: {
        target: { projectionId: rowsProjection.id },
        outputs: { selected: { state: "picked" } },
      },
    },
    commands: {},
  };

  // Rows forbidden
  const first = mountPanel(rowsManifest, { [rowsProjection.id]: rowsProjection }, () => ({ status: "forbidden" }));
  await vi.waitFor(() => {
    const root = first.container.querySelector(".sdk-inline-reference-picker");
    expect(root?.getAttribute("data-state")).toBe("forbidden");
    expect(root?.getAttribute("title")).toBeTruthy();
    expect(root?.querySelector(".el-select__wrapper")?.classList.contains("is-disabled")).toBe(true);
  });
  cleanup?.();
  cleanup = null;

  // Options error
  const optionsProjection: DirectProjection = {
    ...meta,
    id: "error-options-picker",
    name: "Error options picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: MODEL_OPTION } },
    config: { placeholder: "Pick model" },
    data: {
      options: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "options", params: {} },
    },
  };
  const optionsManifest: DirectPanelManifest = {
    state: {
      picked: { type: { kind: "object", objectType: MODEL_OPTION }, personal: false, deepLink: false, external: false },
    },
    members: {
      picker: {
        target: { projectionId: optionsProjection.id },
        outputs: { selected: { state: "picked" } },
      },
    },
    commands: {},
  };

  const second = mountPanel(
    optionsManifest,
    { [optionsProjection.id]: optionsProjection },
    () => ({ status: "error", message: "Option catalogue offline" }),
  );
  await vi.waitFor(() => {
    const root = second.container.querySelector(".sdk-inline-reference-picker");
    expect(root?.getAttribute("data-state")).toBe("error");
    expect(root?.getAttribute("title")).toBe("Option catalogue offline");
    expect(root?.querySelector(".el-select__wrapper")?.classList.contains("is-disabled")).toBe(true);
  });
});
