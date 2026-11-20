<script setup lang="ts">
import { projectionElement } from "../panel/projection-element";
import { computed, onMounted, provide, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElForm } from "element-plus/es/components/form/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { slotState, usePanelContext, useProjectionForm, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import { PlatformObjectRefusal, selectedKey } from "../panel/platform-objects";
import { changedPaths, fieldAt, movedPath, valueAt, withValueAt } from "../panel/form-values";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMember } from "../panel/member";
import { editedInput, formSave, memberFormSource, MemberDataUnavailable, type FormSource } from "../panel/member-forms";
import { formControlsKey, rowControlKey, rowControlsOf } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";

/**
 * One object's form, exactly as its owner describes it: the owner's fields at their JSON Pointer paths, its values in
 * the owner's own shape (nested objects, arrays, `false` and `null` as they are), its read-only rules and its defaults
 * for a new object. When a field the owner marks `refreshOnChange` changes, the owner is asked again and its answer
 * replaces the fields and the values.
 *
 * The form edits the object the panel's state holds for it — the input its `form` datum reads its object from — or, when
 * that state is empty and its owner admits the save as a create (the owner creates, and the projection reads its
 * `createForm`), a new one; the panel then holds the object the owner created. The save is the one operation of its
 * projection the owner describes as a form's save, whatever the projection calls it. A header "new" is an event that empties that state.
 * A field another projection draws (a reference chosen from its own catalogue, a data scope on a graph) is edited there,
 * through this form's field port, and is this form's value, dirty state and draft all the same.
 *
 * A draft an agent wrote reaches the form whose owner names the draft's operation for its target; the owner checks the
 * whole draft (one it refuses is refused whole, with the fields and the reasons) and the form shows it, the changed
 * fields marked and nothing written, until the reader saves or discards.
 */
const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = projectionElement(slot.projection).id;
const member = useMember();
// The member's form is read by the instance (through this release's resource module in a frame) and saved through its
// owner's operation, received by the platform's coordinator.
const forms: FormSource = memberFormSource(member, panel.instance);

const editInput = editedInput(member.projection);
/** Whether the projection reads the owner's create form, which a create draft is read in. */
const creates = Object.values(member.projection.data).some((data) => data.read === "createForm");
/** The panel state the edited object is held in; a form that only creates holds none. */
const state = computed(() => (editInput === undefined ? null : slotState(panel.manifest, slot.slot, editInput)));
const key = computed(() => (state.value === null ? null : selectedKey(panel.instance.state.values.value[state.value])));
/** The form's save as its owner admits it now: whether, with nothing chosen, it creates is the owner's to say. */
const save = computed(() => formSave(member.operations.value));
const target = computed<PanelFormTarget | null>(() => {
  if (key.value) return { kind: "object", objectType, primaryKey: key.value };
  return save.value?.descriptor.target.source === "draft" ? { kind: "draft" } : null;
});
const targetKey = (value: PanelFormTarget | null) => (value === null ? "" : value.kind === "object" ? value.primaryKey : "draft");

/** Puts the panel's state where the form shows `next`: an existing object held, or the state emptied for a new one. */
function moveTo(next: PanelFormTarget) {
  if (state.value === null) return;
  panel.instance.state.set(state.value, next.kind === "object" ? { className: objectType, primaryKey: next.primaryKey } : null);
}

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
/**
 * The described fields this edit submits, by path: those the reader set (whatever value they end on) and those a received
 * draft wrote. The owner keeps a field not named here as it is, so a field nobody touched is never added. Whether a
 * value ended where it began does not matter: a field set back to the value shown is still submitted, and can be saved.
 */
const submitted = shallowRef<ReadonlySet<string>>(new Set());
/** Whether the form has something to save or discard: changed values, a received draft, or fields set on purpose. */
const canSettle = computed(() => dirty.value || panel.instance.draft.value?.slot === slot.slot || submitted.value.size > 0);

/** A draft this form took, for the target it addresses, shown once the form is on that target. */
let held: {
  target: string; baseline: PanelFormDescription; checked: PanelFormDescription; changed: ReadonlySet<string>; submitted: ReadonlySet<string>;
} | null = null;
/** The target the form was last read for, so one change of target is one read. */
let loaded: string | null = null;

/** The owner's field errors, by the field each names. */
const fieldMessages = (list: readonly { field: string; message: string }[]) =>
  Object.fromEntries(list.map(({ field, message }) => [field, message]));

function adopt(
  baseline: PanelFormDescription,
  shown: PanelFormDescription = baseline,
  marked: ReadonlySet<string> = new Set(),
  written: ReadonlySet<string> = new Set(),
) {
  submitted.value = written;
  opened.value = baseline;
  description.value = shown;
  values.value = shown.values;
  changed.value = marked;
  refusal.value = null;
  // The owner's verdict on the values it returned: a field it does not accept says why, on that field.
  errors.value = fieldMessages(shown.errors);
  invalid.value = {};
  failure.value = null;
  loading.value = false;
}

/**
 * The latest read of the form — its first, one for another target, or a refresh of the same object. Only the latest
 * read's answer is applied: an earlier one that comes back after it (the first read, answered after a refresh that
 * came in while it was on its way) would put back what a reader has typed since.
 */
let latestRead = 0;

function load(next: PanelFormTarget | null) {
  const nextKey = targetKey(next);
  const reading = ++latestRead;
  loaded = nextKey;
  if (next === null) {
    description.value = opened.value = null;
    values.value = {};
    loading.value = false;
    return;
  }
  if (held?.target === nextKey) {
    adopt(held.baseline, held.checked, held.changed, held.submitted);
    return;
  }
  loading.value = true;
  void forms.describe({ target: next, changedField: null }).then(
    (answer) => { if (reading === latestRead && held?.target !== nextKey) adopt(answer); },
    (reason: unknown) => { if (reading === latestRead) fail(reason); },
  );
}

function fail(reason: unknown) {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
  loading.value = false;
}

onMounted(() => load(target.value));
let pendingRefresh = false;
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
  const reading = ++latestRead;
  void forms.describe({ target: current, changedField: null }).then(
    (answer) => {
      if (reading !== latestRead || held?.target === currentKey) return;
      if (canSettle.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      adopt(answer);
    },
    (reason: unknown) => { if (reading === latestRead) fail(reason); },
  );
}
useProjectionObjectRefresh((id) => id === key.value, () => {
  pendingRefresh = true;
  refreshWhenClean();
});
watch([canSettle, saving], refreshWhenClean);

/** One field changed: the form holds the value; a field the owner's form depends on has the owner asked again. */
function set(path: string, value: RuntimeJsonValue) {
  // The described field the edit is in: a row's or an object's field submits the array or object it belongs to.
  const described = fields.value.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (described) submitted.value = new Set([...submitted.value, described.path]);
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
    errors.value = fieldMessages(answer.errors);
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
    const declared = Object.values(panel.manifest.members).some(({ formField }) =>
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
    if (create && !creates && !draft.created) throw new Error("This panel's form does not create objects");
    // The target whose owner form names the draft's operation: the create target of a form that creates, otherwise the
    // object the draft (or its earlier save) addresses.
    const named: PanelFormTarget = create && creates
      ? { kind: "draft" }
      : { kind: "object", objectType, primaryKey: draft.target.id ?? draft.created!.id };
    const namedForm = await forms.describe({ target: named, changedField: null });
    if (namedForm.save.draftOperation !== draft.operation) return null;
    // A create draft saved once addresses the object it created from then on.
    const into: PanelFormTarget = draft.created ? { kind: "object", objectType, primaryKey: draft.created.id } : named;
    const baseline = targetKey(into) === targetKey(named) ? namedForm : await forms.describe({ target: into, changedField: null });
    const checked = await forms.describe({ target: into, values: draft.form as PanelFormValues, changedField: null });
    // A draft the owner does not accept is refused whole, with the fields and the reasons.
    if (checked.errors.length) throw new PlatformObjectRefusal(checked.errors[0]!.message, fieldMessages(checked.errors));
    const marked = changedPaths(checked.fields, baseline.values, checked.values);
    // What the draft wrote, by its presence: a field it left out is not submitted, though the owner's check returns it.
    const written = new Set(checked.fields.filter((item) => valueAt(draft.form as PanelFormValues, item.path) !== undefined).map((item) => item.path));
    // A draft is held for what it changed and for what it wrote: one that writes a field as it already is still submits it.
    held = marked.size || written.size ? { target: targetKey(into), baseline, checked, changed: marked, submitted: written } : null;
    if (targetKey(target.value) === targetKey(into)) load(into);
    else moveTo(into);
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
    const saved = await forms.save(into, {
      values: values.value, submittedFields: [...submitted.value], ...(revision === undefined ? {} : { revision }),
    });
    submitted.value = new Set();
    held = null;
    opened.value = { ...description.value!, values: values.value };
    changed.value = new Set();
    if (into.kind === "draft") moveTo({ kind: "object", objectType, primaryKey: saved.primaryKey });
    // The save went through the coordinator, whose receipt reaches the host's one refresh port and is read again there.

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

/**
 * The form's state, in the product's one presentation: the owner's form once read, a selection needed first, loading,
 * no permission, or the reason it could not be read.
 */
const shown = computed<DataStateResult<PanelFormDescription>>(() => {
  const reason = failure.value;
  if (reason) return reason instanceof MemberDataUnavailable && reason.state.status !== "error" ? reason.state : { status: "error", message: reason.message };
  if (loading.value) return { status: "loading" };
  return description.value ? { status: "ready", value: description.value } : { status: "awaiting" };
});
const labels = computed(() => ({ empty: t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));

/** The fields a received draft changed, by the owner's labels, in the form's order — those other slots draw included. */
const changedLabels = computed(() => fields.value.filter((field) => changed.value.has(field.path)).map((field) => field.label).join(", "));
</script>

<template>
  <div class="sdk-owner-form">
    <data-state :result="shown" :labels="labels">
    <!-- The panel frame is sandboxed without allow-forms, so the browser drops a native form submission before any
         submit handler runs: the reader's save is the button's own click. -->
    <el-form label-position="top">
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
    </data-state>
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
