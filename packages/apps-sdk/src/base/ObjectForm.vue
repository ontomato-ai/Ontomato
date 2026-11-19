<script setup lang="ts">
import { computed, onMounted, provide, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElForm } from "element-plus/es/components/form/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { slotState, usePanelContext, useProjectionForm, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import { adapterPart, PlatformObjectRefusal, selectedKey } from "../panel/platform-objects";
import { changedPaths, fieldAt, movedPath, valueAt, withValueAt } from "../panel/form-values";
import { formControlsKey, rowControlKey, rowControlsOf } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";

/**
 * One object's form, exactly as its owner describes it: the owner's fields at their JSON Pointer paths, its values in
 * the owner's own shape (nested objects, arrays, `false` and `null` as they are), its read-only rules and its defaults
 * for a new object. When a field the owner marks `refreshOnChange` changes, the owner is asked again and its answer
 * replaces the fields and the values.
 *
 * The form edits the object the panel has selected, or — when nothing is and the projection's display says it
 * `creates` — a new one, saved through the owner's own create; the panel then selects the object the owner created.
 * A field another projection draws (a reference chosen from its own catalogue, a data scope on a graph) is edited there,
 * through this form's field port, and is this form's value, dirty state and draft all the same.
 *
 * A draft an agent wrote reaches the form whose owner names the draft's operation for its target; the owner checks the
 * whole draft (one it refuses is refused whole, with the fields and the reasons) and the form shows it, the changed
 * fields marked and nothing written, until the reader saves or discards.
 */
const props = withDefaults(
  defineProps<{
    /** The slot input whose panel state names the object this form edits; the slot's first input by default. */
    inputName?: string;
    /** Whether, with nothing selected, the form creates a new object of the bound type. */
    creates?: boolean;
  }>(),
  { inputName: undefined, creates: false },
);

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = slot.projection.binding.id;
const forms = adapterPart(objectType, "forms");

const state = computed(() => slotState(panel.manifest, slot.slot, props.inputName));
const key = computed(() => selectedKey(panel.instance.state.values.value[state.value]));
const target = computed<PanelFormTarget | null>(() => {
  if (key.value) return { kind: "object", objectType, primaryKey: key.value };
  return props.creates ? { kind: "draft" } : null;
});
const targetKey = (value: PanelFormTarget | null) => (value === null ? "" : value.kind === "object" ? value.primaryKey : "draft");

/** The owner's description now: its fields, which follow the values the form holds. */
const description = shallowRef<PanelFormDescription | null>(null);
/** The owner's reading when the form opened: what discard returns to and the revision a save is sent with. */
const opened = shallowRef<PanelFormDescription | null>(null);
const values = shallowRef<PanelFormValues>({});
const changed = shallowRef<ReadonlySet<string>>(new Set());
const errors = shallowRef<Readonly<Record<string, string>>>({});
/** Fields holding text that is not a value of the owner's (JSON that does not parse), by absolute path. */
const invalid = shallowRef<Readonly<Record<string, string>>>({});
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<Error | null>(null);
/** The owner's refusal of the last save, shown with the form the reader still holds; its fields' messages on the fields. */
const refusal = shallowRef<Error | null>(null);

const fields = computed(() => description.value?.fields ?? []);
/**
 * The fields this form draws itself; a reference is drawn by the projection that edits it, an avatar by the page that
 * shows it, a hidden one by none.
 */
const drawn = computed(() => fields.value.filter((field) => !["reference", "avatar", "hidden"].includes(field.control.kind)));
/** Changed values, or text a reader typed that is no value yet (JSON that does not parse): either is unsaved. */
const dirty = computed(() => opened.value !== null
  && (JSON.stringify(values.value) !== JSON.stringify(opened.value.values) || Object.keys(invalid.value).length > 0));
const canSettle = computed(() => dirty.value || panel.instance.draft.value?.slot === slot.slot);

/** A draft this form took, for the target it addresses, shown once the form is on that target. */
let held: { target: string; baseline: PanelFormDescription; checked: PanelFormDescription; changed: ReadonlySet<string> } | null = null;
/** The target the form was last read for, so one change of target is one read. */
let loaded: string | null = null;

function adopt(baseline: PanelFormDescription, shown: PanelFormDescription = baseline, marked: ReadonlySet<string> = new Set()) {
  opened.value = baseline;
  description.value = shown;
  values.value = shown.values;
  changed.value = marked;
  refusal.value = null;
  errors.value = {};
  invalid.value = {};
  failure.value = null;
  loading.value = false;
}

function load(next: PanelFormTarget | null) {
  const nextKey = targetKey(next);
  loaded = nextKey;
  if (next === null) {
    description.value = opened.value = null;
    values.value = {};
    loading.value = false;
    return;
  }
  if (held?.target === nextKey) {
    adopt(held.baseline, held.checked, held.changed);
    return;
  }
  loading.value = true;
  void forms.describe({ target: next, changedField: null }).then(
    (answer) => { if (loaded === nextKey && held?.target !== nextKey) adopt(answer); },
    (reason: unknown) => { if (loaded === nextKey) fail(reason); },
  );
}

function fail(reason: unknown) {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
  loading.value = false;
}

onMounted(() => load(target.value));
let pendingRefresh = false;
/** The latest read of the same object again; an older one that comes back after it is not applied. */
let rereading = 0;
watch(target, (next) => {
  pendingRefresh = false;
  if (targetKey(next) !== loaded) load(next);
});
function refreshWhenClean() {
  if (!pendingRefresh || canSettle.value || saving.value) return;
  pendingRefresh = false;
  reread();
}

/**
 * Reads the object the form shows again, in place: the fields, the focus and the caret stay where they are while the
 * read is on its way, and its answer replaces the values only if the form is still clean when it comes back. A reader
 * who changed anything meanwhile keeps their edit; the read waits, pending, until the form is saved or discarded.
 */
function reread() {
  const current = target.value;
  const currentKey = targetKey(current);
  if (current === null || held?.target === currentKey) return load(current);
  const reading = ++rereading;
  void forms.describe({ target: current, changedField: null }).then(
    (answer) => {
      if (loaded !== currentKey || reading !== rereading || held?.target === currentKey) return;
      if (canSettle.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      adopt(answer);
    },
    (reason: unknown) => { if (loaded === currentKey && reading === rereading) fail(reason); },
  );
}
useProjectionObjectRefresh((id) => id === key.value, () => {
  pendingRefresh = true;
  refreshWhenClean();
});
watch([canSettle, saving], refreshWhenClean);

/** One field changed: the form holds the value; a field the owner's form depends on has the owner asked again. */
function set(path: string, value: RuntimeJsonValue) {
  values.value = withValueAt(values.value, path, value);
  const field = fieldAt(fields.value, path);
  if (!field?.refreshOnChange) return;
  const asked = target.value!;
  const askedKey = targetKey(asked);
  // The owner changes the fields for these edits; the opened reading, its revision and the discard baseline stay.
  void forms.describe({ target: asked, values: values.value, changedField: path }).then((answer) => {
    if (loaded !== askedKey) return;
    description.value = answer;
    values.value = answer.values;
  }, fail);
}

/**
 * Rearranges the rows of an array field, `order[next] = previous`: the values, and the messages and marks inside each
 * row, which follow the row to its new index (one inside a removed row goes with it).
 */
function reorder(path: string, order: readonly number[]) {
  const rows = valueAt(values.value, path) as RuntimeJsonValue[];
  const moved = (byPath: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(byPath).flatMap(([at, message]) => {
    const next = movedPath(at, path, order);
    return next === null ? [] : [[next, message]];
  }));
  errors.value = moved(errors.value);
  invalid.value = moved(invalid.value);
  changed.value = new Set([...changed.value].flatMap((at) => movedPath(at, path, order) ?? []));
  set(path, order.map((index) => rows[index]!));
}

function markInvalid(path: string, message: string | null) {
  const { [path]: _, ...rest } = invalid.value;
  invalid.value = message === null ? rest : { ...rest, [path]: message };
}

provide(formControlsKey, {
  values,
  errors: computed(() => ({ ...errors.value, ...invalid.value })),
  changed,
  busy: saving,
  set,
  reorder,
  invalid: markInvalid,
  rowControl(path, itemPath) {
    const declared = Object.values(panel.manifest.slots).some(({ formField }) =>
      formField?.slot === slot.slot && formField.path === path && formField.itemPath === itemPath);
    if (!declared) return undefined;
    return rowControlsOf(panel.instance).get(rowControlKey(slot.slot, path, itemPath)) ?? null;
  },
});

useProjectionForm({
  handle: { fields, values, errors, changed, busy: saving, set },
  async receive(draft) {
    const create = draft.target.id === undefined;
    // A create draft for a form that creates nothing is refused as such, before any owner is asked about it — unless an
    // earlier save already created its object, which it then addresses.
    if (create && !props.creates && !draft.created) throw new Error("This panel's form does not create objects");
    // The target whose owner form names the draft's operation: the create target of a form that creates, otherwise the
    // object the draft (or its earlier save) addresses.
    const named: PanelFormTarget = create && props.creates
      ? { kind: "draft" }
      : { kind: "object", objectType, primaryKey: draft.target.id ?? draft.created!.id };
    const namedForm = await forms.describe({ target: named, changedField: null });
    if (namedForm.save.draftOperation !== draft.operation) return null;
    // A create draft saved once addresses the object it created from then on.
    const into: PanelFormTarget = draft.created ? { kind: "object", objectType, primaryKey: draft.created.id } : named;
    const baseline = targetKey(into) === targetKey(named) ? namedForm : await forms.describe({ target: into, changedField: null });
    const checked = await forms.describe({ target: into, values: draft.form as PanelFormValues, changedField: null });
    const marked = changedPaths(checked.fields, baseline.values, checked.values);
    held = marked.size ? { target: targetKey(into), baseline, checked, changed: marked } : null;
    const selected = into.kind === "object" ? { className: objectType, primaryKey: into.primaryKey } : null;
    if (targetKey(target.value) === targetKey(into)) load(into);
    else panel.instance.state.set(state.value, selected);
    return marked;
  },
  submit: () => write(),
  dirty: () => dirty.value,
  discard,
});

function discard() {
  held = null;
  adopt(opened.value!);
  void panel.instance.settleDraft(slot.slot).catch(showRefusal);
}

async function saveFromForm() {
  try {
    await panel.instance.forms.submit(slot.slot);
  } catch (reason) {
    // The operation also rejects for programmatic callers. The reader sees the same refusal in the form.
    showRefusal(reason);
  }
}

function showRefusal(reason: unknown) {
  refusal.value = reason instanceof Error ? reason : new Error(String(reason));
  errors.value = reason instanceof PlatformObjectRefusal ? reason.fields : {};
}

/**
 * Writes the form through its owner — the selected object's update, or the create — with the revision it was read at
 * where the owner has one. An owner that refuses has its reason shown beside the form and its field messages on the
 * fields it named; nothing is retried, and the reader's form stays as they left it. A create selects the object the
 * owner created; every projection showing the saved object reads it again, this form included, at its new revision.
 */
async function write(): Promise<unknown> {
  const into = target.value;
  if (!into) throw new Error("This form edits one object, and none is selected");
  if (Object.keys(invalid.value).length) throw new Error(t("platform.formFixInvalid"));
  saving.value = true;
  refusal.value = null;
  errors.value = {};
  try {
    const revision = opened.value!.revision;
    const saved = await forms.save(into, { values: values.value, ...(revision === undefined ? {} : { revision }) });
    held = null;
    opened.value = { ...description.value!, values: values.value };
    changed.value = new Set();
    if (into.kind === "draft") panel.instance.state.set(state.value, { className: objectType, primaryKey: saved.primaryKey });
    panel.instance.objectChanged({ objectType, primaryKey: saved.primaryKey });
    // A received draft ends with its save; a create draft first records the object it created. The save stands either
    // way: a record that fails is shown with the form, on the object the owner created.
    await panel.instance.settleDraft(slot.slot, into.kind === "draft" ? saved.primaryKey : undefined);
    return saved;
  } catch (reason) {
    showRefusal(reason);
    throw reason;
  } finally {
    saving.value = false;
  }
}

/** The fields a received draft changed, by the owner's labels, in the form's order — those other slots draw included. */
const changedLabels = computed(() => fields.value.filter((field) => changed.value.has(field.path)).map((field) => field.label).join(", "));
</script>

<template>
  <div class="sdk-owner-form">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="4" animated></el-skeleton>
    <el-empty v-else-if="!description" :image-size="48"></el-empty>
    <!-- The panel frame is sandboxed without allow-forms, so the browser drops a native form submission before any
         submit handler runs: the reader's save is the button's own click. -->
    <el-form v-else label-position="top">
      <form-field-control v-for="field in drawn" :key="field.path" :field="field" :path="field.path"></form-field-control>
      <p v-if="changed.size" class="sdk-owner-form-changed" role="status">
        {{ t("platform.panelDraftChanged", { fields: changedLabels }) }}
      </p>
      <p v-if="refusal" class="sdk-owner-form-refusal" role="alert">{{ refusal.message }}</p>
      <div class="sdk-owner-form-actions">
        <el-button :disabled="saving || !canSettle" @click="discard">{{ t("platform.discard") }}</el-button>
        <el-button type="primary" :disabled="!canSettle" :loading="saving" @click="saveFromForm">{{ t("platform.save") }}</el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.sdk-owner-form-actions {
  display: flex;
  justify-content: flex-end;
  margin-block-start: 12px;
}
.sdk-owner-form-changed {
  color: var(--el-color-primary);
  font-size: var(--text-xs);
  margin: 4px 0 0;
}
.sdk-owner-form-refusal {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
