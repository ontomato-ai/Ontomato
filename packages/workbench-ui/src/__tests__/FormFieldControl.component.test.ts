import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { ElOption } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import FormFieldControl from "../../../apps-sdk/src/base/FormFieldControl.vue";
import { formControlsKey, type FormControls } from "../../../apps-sdk/src/base/form-controls";
import { withValueAt, withoutValueAt } from "../../../apps-sdk/src/panel/form-values";
import { t, workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

const open = { value: 1, label: "Read", description: "Inspect reports", disabled: false, disabledReason: null };
const locked = { ...open, value: 2, label: "Write", disabled: true, disabledReason: "Managed centrally" };
const audit = { ...open, value: "audit-trail", label: "Audit", description: "Inspect events", badge: "GET" };

function draw(control: PanelFormField["control"], initial: RuntimeJsonValue) {
  const values = ref<PanelFormValues>({ field: initial });
  const field = { path: "/field", label: "Field", required: false, readOnly: false, valueSchema: {}, control };
  const controls: FormControls = {
    formSlot: "form", values, prunedValues: values, errors: ref({}), changed: ref(new Set()),
    busy: ref(false), layout: ref("stacked"), hasDefaults: ref(false), sharedReadOnlyReasons: ref(new Set()),
    isTopLevel: () => true, hasInvalid: () => false, invalidText: () => undefined,
    set: (path, next) => { values.value = withValueAt(values.value, path, next); },
    remove: (path) => { values.value = withoutValueAt(values.value, path); },
    reorder: () => { throw new Error("Unexpected reorder"); },
    invalid: () => { throw new Error("Unexpected invalid text"); },
    resolveFieldSlot: () => undefined,
  };
  const wrapper = mount(FormFieldControl, {
    props: { field, path: field.path },
    attachTo: document.body,
    global: { plugins: [workbenchI18n()], provide: { [formControlsKey as symbol]: controls } },
  });
  return { wrapper, values };
}

const button = (wrapper: VueWrapper, label: string) => wrapper.findAll("button").find(item => item.text() === label)!;
const removeButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("button[aria-label]").find(item => item.attributes("aria-label") === t("platform.formRemoveChoice", { label }))!;

describe("owner form choice controls", () => {
  it("searches checklist metadata, scopes bulk edits to matches, and retains unavailable choices through presets", async () => {
    const { wrapper, values } = draw({
      kind: "select", multiple: true, presentation: "checklist", options: [open, locked, audit],
      presets: [{ label: "Reader preset", values: [1, 2] }],
    }, [1, 2, "legacy"]);
    expect(wrapper.text()).toContain(locked.disabledReason);
    const search = wrapper.get("input[type=text]");
    for (const query of ["Audit", "events", "GET", "audit-trail"]) {
      await search.setValue(query);
      expect(wrapper.findAll("input[type=checkbox]")).toHaveLength(1);
      expect(wrapper.get("input[type=checkbox]").element.closest("label")?.textContent).toContain(audit.label);
    }
    await button(wrapper, t("platform.formSelectFiltered")).trigger("click");
    expect(values.value.field).toEqual([1, 2, "legacy", audit.value]);
    await button(wrapper, t("platform.formClearFiltered")).trigger("click");
    expect(values.value.field).toEqual([1, 2, "legacy"]);
    await removeButton(wrapper, "legacy").trigger("click");
    await search.setValue("");
    const blockedChoice = wrapper.findAll("label").find(label => label.text().includes(locked.label))!;
    await blockedChoice.get("input").setValue(false);
    expect(values.value.field).toEqual([1]);
    expect(blockedChoice.get("input").element.disabled).toBe(true);
    await button(wrapper, "Reader preset").trigger("click");
    expect(values.value.field).toEqual([1]);
  });

  it("shows nested groups open and toggles only each group's available leaves", async () => {
    const { wrapper, values } = draw({
      kind: "select", multiple: true, presentation: "tree",
      options: [
        { ...open, groupPath: ["API", "Reports"] }, { ...locked, groupPath: ["API", "Reports"] },
        { ...audit, groupPath: ["API"] },
      ],
      presets: [{ label: "Audit preset", values: [audit.value] }],
    }, [1, 2, 99]);
    const parent = wrapper.get<HTMLInputElement>('input[aria-label="API"]');
    expect(wrapper.findAll("details").map(item => item.element.open)).toEqual([true, true]);
    expect(parent.element.indeterminate).toBe(true);
    await parent.setValue(true);
    expect(values.value.field).toEqual([1, 2, 99, audit.value]);
    expect(parent.element.indeterminate).toBe(false);
    await parent.setValue(false);
    expect(values.value.field).toEqual([2, 99]);
    await button(wrapper, "Audit preset").trigger("click");
    expect(values.value.field).toEqual([2, 99, audit.value]);
    await removeButton(wrapper, "99").trigger("click");
    expect(values.value.field).toEqual([2, audit.value]);
  });

  it.each(["checklist", "tree"] as const)("admits a custom %s choice only when creation is enabled", async (presentation) => {
    const control = { kind: "select" as const, presentation, multiple: true, options: [open, { ...locked, value: "locked" }] };
    const closed = draw(control, []);
    const label = t("platform.formCreateOption");
    expect(closed.wrapper.findAll("input").some(input => input.attributes("aria-label") === label)).toBe(false);
    const { wrapper, values } = draw({ ...control, allowCreate: true }, []);
    const field = wrapper.get(`input[aria-label="${label}"]`);
    await field.setValue("locked");
    expect(button(wrapper, t("platform.formAdd")).element.disabled).toBe(true);
    await field.setValue("custom");
    await button(wrapper, t("platform.formAdd")).trigger("click");
    expect(values.value.field).toEqual(["custom"]);
  });

  it.each(["obsolete", 99, { id: "obsolete" }])("preserves an unavailable dropdown choice %j when adding one, and removes it explicitly", async (held) => {
    const option = typeof held === "object" ? { ...open, value: { id: "active" } } : open;
    const { wrapper, values } = draw({ kind: "select", multiple: true, options: [option] }, [held]);
    const label = typeof held === "object" ? JSON.stringify(held) : String(held);
    expect(wrapper.text()).toContain(t("platform.formOptionNoLonger"));
    await wrapper.getComponent(ElOption).trigger("click");
    expect(values.value.field).toEqual([held, option.value]);
    await removeButton(wrapper, label).trigger("click");
    expect(values.value.field).toEqual([option.value]);
  });

  it("clears an unavailable scalar single selection on request", async () => {
    const { wrapper, values } = draw({ kind: "select", options: [open] }, "obsolete");
    await removeButton(wrapper, "obsolete").trigger("click");
    expect(values.value).not.toHaveProperty("field");
  });

  it("sets one matrix row or all editable rows while preserving disabled and historical rows", async () => {
    const row = { key: "reports", label: "Reports", badge: "API", description: "Report access", disabled: false, disabledReason: null };
    const { wrapper, values } = draw({
      kind: "choice-matrix", options: [open, locked, audit],
      rows: [row, { ...row, key: "other", label: "Other" }, { ...row, key: "managed", label: "Managed", disabled: true, disabledReason: "Managed row" }],
    }, { managed: 2, retired: 1 });
    expect(wrapper.get("fieldset[disabled]").text()).toContain("Managed row");
    expect(button(wrapper, t("platform.formMatrixSetAll", { label: locked.label })).element.disabled).toBe(true);
    await wrapper.get("fieldset").get('input[type=radio]').setValue(true);
    expect(values.value.field).toEqual({ reports: 1, managed: 2, retired: 1 });
    await button(wrapper, t("platform.formMatrixSetAll", { label: audit.label })).trigger("click");
    expect(values.value.field).toEqual({ reports: audit.value, other: audit.value, managed: 2, retired: 1 });
    await removeButton(wrapper, "retired: 1").trigger("click");
    expect(values.value.field).toEqual({ reports: audit.value, other: audit.value, managed: 2 });
  });
});

describe("owner form text variables", () => {
  it.each([false, true])("replaces the focused selection, restores the caret and appends when unfocused (multiline=%s)", async (multiline) => {
    const token = "{{actor}}";
    const { wrapper, values } = draw({
      kind: "text", multiline, variables: [
        { label: "Context", items: [{ label: "Actor", value: token, badge: "Single" }] },
        { label: "Inputs", emptyHint: "Add an input first", items: [] },
      ],
    }, "say NAME now");
    const editor = wrapper.get<HTMLInputElement | HTMLTextAreaElement>(multiline ? "textarea" : "input");
    const insert = wrapper.get<HTMLButtonElement>("fieldset button");
    expect(wrapper.text()).toContain("Add an input first");
    expect(insert.get("code").text()).toBe(token);
    editor.element.focus();
    editor.element.setSelectionRange(4, 8);
    await insert.trigger("mousedown");
    await insert.trigger("click");
    await nextTick();
    expect(values.value.field).toBe(`say ${token} now`);
    expect(document.activeElement).toBe(editor.element);
    expect(editor.element.selectionStart).toBe(4 + token.length);
    expect(editor.element.selectionEnd).toBe(4 + token.length);
    editor.element.blur();
    await insert.trigger("click");
    expect(values.value.field).toBe(`say ${token} now${token}`);
    await wrapper.setProps({ disabled: true });
    expect(insert.element.disabled).toBe(true);
  });
});
