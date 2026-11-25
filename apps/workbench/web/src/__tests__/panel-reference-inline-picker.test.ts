import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import * as panelProjection from "@ontomato/contracts/panel-projection";
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
    memberSlots?: (instance: ReturnType<typeof createDirectPanelInstance>) => Record<string, Record<string, () => ReturnType<typeof h>[]>>;
  } = {},
) {
  const localeRef = ref(options.locale ?? "en");
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "inline-picker-test",
    url: () => "/picker",
    label: () => "Picker",
    initial: options.initial as never,
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
  const resolvedSlots = options.memberSlots?.(instance);
  const app = createApp({
    render: () => memberKeys.map((member) => h(PanelMember, { instance, member }, resolvedSlots?.[member])),
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
      model: { target: { projectionId: pickerProjection.id }, inputs: {} },
    },
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
        save: { method: "PUT", path: "/agents/:id", bodySchema: {} },
      });
    },
    {
      initial: { agent: { className: AGENT_DEFINITION, primaryKey: "a-1" } },
      members: ["form"],
      memberSlots: (instance) => ({ form: { "field-model": () => [h(PanelMember, { instance, member: "model" })] } }),
    },
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

it.each([1, 21])("initially displays the owner's label for option %i", async (index) => {
  const picker: DirectProjection = {
    ...meta,
    id: "user-picker",
    name: "User picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: USER } },
    config: {},
    data: {
      options: { source: { type: { kind: "PlatformObjectType", id: USER } }, read: "options", params: {} },
      selected: { source: { type: { kind: "PlatformObjectType", id: USER } }, read: "resolve", params: {} },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      user: { type: { kind: "object", objectType: USER }, personal: false, deepLink: false, external: false },
    },
    members: {
      picker: { target: { projectionId: picker.id }, outputs: { selected: { state: "user" } } },
    },
  };
  const users = Array.from({ length: 21 }, (_, i) => ({
    primaryKey: `u-${i + 1}`,
    value: `u-${i + 1}`,
    label: `User ${i + 1}`,
  }));
  const selected = users[index - 1]!;
  const { container, reads } = mountPanel(
    manifest,
    { [picker.id]: picker },
    (request) => {
      if (request.dataName === "options") return ready({ options: users.slice(0, 20) });
      if (request.dataName === "selected") {
        const values = request.runtimeParams?.values as string[];
        return ready({
          options: users.filter((user) => values.includes(user.value)).map((user) =>
            user === users[0] ? { ...user, label: "Different resolved label" } : user,
          ),
        });
      }
      return { status: "empty" };
    },
    { initial: { user: { className: USER, primaryKey: selected.primaryKey } } },
  );

  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker .el-select__selected-item:not(.is-hidden)")?.textContent?.trim()).toBe(selected.label);
  });
  if (index === 1) expect(reads.some((request) => request.dataName === "selected")).toBe(false);
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

it("inline paged rows mode resolves a selection outside page 1 and forwards search to the owner", async () => {
  const teacherPicker: DirectProjection = {
    ...meta,
    id: "teacher-picker",
    name: "Teacher picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { selected: { kind: "object", objectType: "Teacher" } },
    outputs: { selected: { kind: "object", objectType: "Teacher" } },
    config: { placeholder: "Pick teacher", clearable: true },
    data: {
      rows: { source: { type: { kind: "ObjectType", id: "Teacher" } }, read: "query", params: {} },
      selected: { source: { object: { input: "selected" } }, read: "record", params: {} },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      teacher: { type: { kind: "object", objectType: "Teacher" }, personal: false, deepLink: false, external: false },
    },
    members: {
      teacherPicker: {
        target: { projectionId: teacherPicker.id },
        inputs: { selected: { state: "teacher" } },
        outputs: { selected: { state: "teacher" } },
      },
    },
  };

  const allTeachers = Array.from({ length: 25 }, (_, i) => ({
    primaryKey: `t-${i + 1}`,
    className: "Teacher",
    label: `Teacher ${i + 1}`,
    subtitle: `Dept ${(i % 3) + 1}`,
    fields: {},
  }));

  const { container, reads, instance } = mountPanel(
    manifest,
    { [teacherPicker.id]: teacherPicker },
    (request) => {
      if (request.dataName === "selected") {
        const selected = request.inputs.selected as { primaryKey: string };
        return ready(allTeachers.find((row) => row.primaryKey === selected.primaryKey));
      }
      const search = String((request.runtimeParams as Record<string, unknown> | undefined)?.search ?? "").trim();
      const matched = search
        ? allTeachers.filter((row) => row.label.toLowerCase().includes(search.toLowerCase()))
        : allTeachers;
      return ready({ rows: matched.slice(0, 20), total: matched.length });
    },
    { initial: { teacher: { className: "Teacher", primaryKey: "t-21" } } },
  );

  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker .el-select__selected-item:not(.is-hidden)")?.textContent?.trim()).toBe("Teacher 21");
  });
  instance.state.set("teacher", null);

  // Open dropdown and type "Teacher 21" -> must forward `search` to the owner's paged query read.
  const wrapper = container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper")!;
  wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = await vi.waitFor(() => {
    const el = container.querySelector<HTMLInputElement>(".sdk-inline-reference-picker input.el-select__input");
    if (!el) throw new Error("Filter input not found");
    return el;
  });
  input.value = "Teacher 21";
  input.dispatchEvent(new Event("input", { bubbles: true }));

  await vi.waitFor(() => {
    const searchRead = reads.find(
      (r) => "dataName" in r && r.dataName === "rows" && (r.runtimeParams as Record<string, unknown> | undefined)?.search === "Teacher 21",
    );
    expect(searchRead).toBeTruthy();
  });

  // Teacher 21 returned by owner appears in dropdown and can be selected.
  const teacher21Option = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((el) => el.textContent?.includes("Teacher 21"));
    if (!found) throw new Error("Teacher 21 option not found");
    return found;
  });
  teacher21Option.click();

  await vi.waitFor(() => {
    expect(instance.state.values.value.teacher).toEqual({ className: "Teacher", primaryKey: "t-21" });
    expect(container.querySelector(".sdk-inline-reference-picker .el-select__selected-item:not(.is-hidden)")?.textContent?.trim()).toBe("Teacher 21");
  });
});

it("groups inline rows by a generic record field (groupBy) preserving owner order and local filtering", async () => {
  const groupedProjection: DirectProjection = {
    ...meta,
    id: "grouped-object-picker",
    name: "Grouped object picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: OBJECT_TYPE } },
    config: { placeholder: "Pick subject", groupBy: "department" },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      subject: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    },
    members: {
      picker: {
        target: { projectionId: groupedProjection.id },
        outputs: { selected: { state: "subject" } },
      },
    },
  };

  const { container, reads, instance } = mountPanel(manifest, { [groupedProjection.id]: groupedProjection }, () =>
    ready([
      { className: OBJECT_TYPE, primaryKey: "t-1", label: "Alice", fields: { department: "Mathematics" } },
      { className: OBJECT_TYPE, primaryKey: "t-2", label: "Bob", fields: { department: "Physics" } },
      { className: OBJECT_TYPE, primaryKey: "t-3", label: "Carol", fields: { department: "Mathematics" } },
    ]),
  );

  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker")?.getAttribute("data-state")).toBe("ready");
  });
  expect(reads).toHaveLength(1);

  const wrapper = container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper")!;
  wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await vi.waitFor(() => {
    const groupTitles = [...document.querySelectorAll<HTMLElement>(".el-select-group__title")].map((el) =>
      el.textContent?.trim(),
    );
    expect(groupTitles).toEqual(["Mathematics", "Physics"]);
  });

  const groups = [...document.querySelectorAll<HTMLElement>(".el-select-group__wrap")];
  expect(groups[0]?.textContent).toContain("Alice");
  expect(groups[0]?.textContent).toContain("Carol");
  expect(groups[1]?.textContent).toContain("Bob");

  // Local filter narrows visible groups and items without issuing extra reads.
  const input = container.querySelector<HTMLInputElement>(".sdk-inline-reference-picker input.el-select__input")!;
  input.value = "Bob";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => {
    const visibleTitles = [...document.querySelectorAll<HTMLElement>(".el-select-group__title")].map((el) =>
      el.textContent?.trim(),
    );
    expect(visibleTitles).toEqual(["Physics"]);
  });
  expect(reads).toHaveLength(1);

  const bobItem = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((el) =>
    el.textContent?.includes("Bob"),
  )!;
  bobItem.click();
  await vi.waitFor(() => {
    expect(instance.state.values.value.subject).toEqual({ className: OBJECT_TYPE, primaryKey: "t-2" });
  });
});

it.each([false, true])("obeys a fixed options signature without page when keyword required=%s", async (required) => {
  const declaration = panelProjection.directReadDeclaration;
  const mocked = vi.spyOn(panelProjection, "directReadDeclaration").mockImplementation((projection, data) =>
    data.read === "lookupAccount"
      ? { source: "type", parameterMode: "fixed", params: { keyword: "keyword" }, requiredParams: required ? ["keyword"] : [], result: "panelOptionList" }
      : declaration(projection, data),
  );
  try {
    const picker: DirectProjection = {
      ...meta, id: "accounts", name: "Accounts", componentId: "@ontomato/sdk:ReferencePicker",
      inputs: {}, outputs: { selected: { kind: "object", objectType: USER } }, config: {},
      data: { options: { source: { type: { kind: "PlatformObjectType", id: USER } }, read: "lookupAccount", params: {} } },
    };
    const { container, reads } = mountPanel({
      state: { account: { type: { kind: "object", objectType: USER }, personal: false, deepLink: false, external: false } },
      members: { picker: { target: { projectionId: picker.id }, outputs: { selected: { state: "account" } } } },
    }, { [picker.id]: picker }, () => ready({ options: [{ primaryKey: "alice", value: "alice", label: "Alice" }] }));
    const input = await vi.waitFor(() => {
      const input = container.querySelector<HTMLInputElement>(".sdk-inline-reference-picker input.el-select__input");
      expect(input).not.toBeNull();
      return input!;
    });
    const optionReads = () => reads.filter(read => read.dataName === "options");
    if (required) {
      expect(optionReads()).toEqual([]);
    } else {
      await vi.waitFor(() => expect(optionReads()).toHaveLength(1));
      expect(optionReads()[0]?.runtimeParams?.page).toBeUndefined();
    }
    container.querySelector<HTMLElement>(".el-select__wrapper")!.click();
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(optionReads().at(-1)?.runtimeParams).toEqual({ keyword: "Alice" }));
    if (required) {
      input.value = "   ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => expect(document.querySelector(".el-select-dropdown__item")).toBeNull());
      expect(optionReads()).toHaveLength(1);
    }
  } finally {
    mocked.mockRestore();
  }
});

it("renders right-aligned option secondary count/meta text from metaField and optionMeta", async () => {
  const picker: DirectProjection = {
    ...meta,
    id: "meta-object-picker",
    name: "Meta object picker",
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: OBJECT_TYPE } },
    config: {
      placeholder: "Select type",
      metaField: "instanceCount",
      optionMeta: { Line: "42" },
    },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selectedType: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    },
    members: {
      picker: {
        target: { projectionId: picker.id },
        outputs: { selected: { state: "selectedType" } },
      },
    },
  };

  const { container } = mountPanel(manifest, { [picker.id]: picker }, () =>
    ready([
      { className: OBJECT_TYPE, primaryKey: "Factory", label: "Factory", fields: { instanceCount: 10 } },
      { className: OBJECT_TYPE, primaryKey: "Order", label: "Order", fields: { instanceCount: 1200 } },
      { className: OBJECT_TYPE, primaryKey: "Line", label: "Line", fields: {} },
    ]),
  );

  await vi.waitFor(() => {
    expect(container.querySelector(".sdk-inline-reference-picker")?.getAttribute("data-state")).toBe("ready");
  });

  container.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await vi.waitFor(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")];
    expect(rows).toHaveLength(3);
    const metaByLabel = Object.fromEntries(
      rows.map((row) => [
        row.querySelector(".sdk-reference-option-label")?.textContent?.trim(),
        row.querySelector(".sdk-reference-option-meta")?.textContent?.trim() ?? null,
      ]),
    );
    expect(metaByLabel).toEqual({
      Factory: "10",
      Order: (1200).toLocaleString(),
      Line: "42",
    });
  });
});
