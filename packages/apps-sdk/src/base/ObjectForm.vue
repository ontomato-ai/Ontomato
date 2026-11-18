<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FormField } from "@ontomato/contracts/form-fields";
import { FormFields as FormFieldsView } from "@ontomato/foundation-ui/form";
import { slotState, usePanelContext, useProjectionForm, useProjectionSlot } from "../panel/context";
import { platformObjectFor, PlatformObjectRefusal, selectedKey, type PlatformObjectForm } from "../panel/platform-objects";
import type { ReceivedPanelDraft } from "../panel/draft";

/**
 * One object's form, as its owner declares it. It draws the owner's fields and nothing else — a choice is a select whose
 * unavailable options stay listed with the reason, a text is an input or a large box, in the owner's order and limits.
 * When a field the owner says the form depends on changes, the owner is asked again and its whole answer replaces the
 * fields and the values: a field the answer removed disappears with its value.
 *
 * Two readers reach this form: one who types, and one who opens a link to a draft an agent wrote. The draft's values are
 * what the form then holds, with the fields the draft changed marked and nothing written; the reader saves or discards.
 * Either way the save is one operation, sent with the revision the form was read at, so a change somebody else made in
 * the meantime is refused rather than replaced.
 */
const props = withDefaults(
  defineProps<{
    /** The slot input whose panel state names the object this form edits; the slot's first input by default. */
    inputName?: string;
    /** What a choice shows before anything is chosen. */
    choosePlaceholder?: string;
  }>(),
  { inputName: undefined, choosePlaceholder: "" },
);

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const client = platformObjectFor(slot.projection.binding.id);
const fields = shallowRef<readonly FormField[]>([]);
const values = ref<Record<string, string>>({});
/** The owner's fields, values and revision when this form opened. */
const opened = shallowRef<PlatformObjectForm | null>(null);
/** The fields a received draft changed, marked on the form until the reader saves or discards. */
const changed = ref<ReadonlySet<string>>(new Set());
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<Error | null>(null);
/** The owner's refusal of the last save, shown with the form the reader still holds; its fields' messages on the fields. */
const refusal = shallowRef<Error | null>(null);
const fieldErrors = ref<Readonly<Record<string, string>>>({});

const state = computed(() => slotState(panel.manifest, slot.slot, props.inputName));
const key = computed(() => selectedKey(panel.instance.state.values.value[state.value]));
const dirty = computed(() => JSON.stringify(values.value) !== JSON.stringify(opened.value?.values ?? {}));
const canSettle = computed(() => dirty.value || panel.instance.draft.value?.slot === slot.slot);
/**
 * The draft this form shows, by the object it addresses. Whenever the owner's form for that object is read — when the
 * draft arrives, when the selection moves to the object, when the form is first drawn — the draft is laid over it, so a
 * read that answers later never replaces it. It goes when the reader saves or discards.
 */
let held: { primaryKey: string; filled: Record<string, string>; changed: ReadonlySet<string> } | null = null;

function showFields(form: PlatformObjectForm) {
  fields.value = form.fields;
  values.value = { ...form.values };
  loading.value = false;
}

function adopt(form: PlatformObjectForm) {
  opened.value = form;
  showFields(form);
  changed.value = new Set();
  refusal.value = null;
  fieldErrors.value = {};
}

function load(primaryKey: string | null) {
  if (!primaryKey) {
    fields.value = [];
    values.value = {};
    opened.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  void client.form(primaryKey).then((form) => show(primaryKey, form), (reason: unknown) => fail(reason));
}

/** The owner's form for an object, with the draft for that object laid over it and the fields it changed marked. */
function show(primaryKey: string, form: PlatformObjectForm) {
  adopt(form);
  const draft = held?.primaryKey === primaryKey ? held : null;
  if (!draft) return;
  values.value = { ...form.values, ...draft.filled };
  changed.value = draft.changed;
  // A field the draft changed may be one the form depends on: the owner answers again with the draft's values, and its
  // answer is the field set the draft is shown in.
  const depended = form.fields.find((field) => field.type === "select" && field.refreshOnChange && draft.changed.has(field.key));
  if (depended) {
    loading.value = true;
    void client.changed(primaryKey, values.value, depended.key).then(
      (next) => {
        showFields(next);
        values.value = { ...next.values, ...draft.filled };
        changed.value = draft.changed;
      },
      (reason: unknown) => fail(reason),
    );
  }
}

function fail(reason: unknown) {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
  loading.value = false;
}

onMounted(() => load(key.value));
watch(key, (next) => load(next));

/** A text changed: the form follows it and the owner is not asked again. */
function typed(name: string, value: string) {
  values.value = { ...values.value, [name]: value };
}

/** A choice changed: when the field says the form depends on it, the owner answers again and replaces fields and values. */
function choose(field: Extract<FormField, { type: "select" }>, value: string) {
  values.value = { ...values.value, [field.key]: value };
  if (!field.refreshOnChange) return;
  loading.value = true;
  const primaryKey = key.value;
  if (!primaryKey) return;
  // The owner changes the fields for these edits; the original revision and discard baseline still belong to the opened form.
  void client.changed(primaryKey, values.value, field.key).then(showFields, (reason: unknown) => fail(reason));
}

// The draft this projection receives: the object it addresses becomes the selected one, the form shows its values, and
// the fields it changed are marked. Nothing is written here.
useProjectionForm({
  read: async (target) => (await client.form(target.id ?? requireKey())).values,
  save: (form, target) => write(asText(form), target.id ?? requireKey()),
  // The frame's own save: what the form holds, at the revision it was read at.
  submit: () => write(values.value, requireKey()),
  apply(draft: ReceivedPanelDraft<Record<string, unknown>>) {
    const primaryKey = draft.target.id;
    if (!primaryKey) throw new Error("This form edits one object, and the draft names none");
    held = { primaryKey, filled: asText(draft.form), changed: draft.changed };
    // The instance selects what the draft addresses, so the panel shows the object being edited; the form is read for it
    // then, with the draft laid over.
    if (key.value === primaryKey) load(primaryKey);
    else panel.instance.state.set(state.value, { className: slot.projection.binding.id, primaryKey });
  },
  dirty: () => dirty.value,
  discard,
});

function discard() {
  held = null;
  adopt(opened.value!);
  panel.instance.clearDraft(slot.slot);
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
  fieldErrors.value = reason instanceof PlatformObjectRefusal ? reason.fields : {};
}

/**
 * Writes the form through its owner, at the revision it was read at. An owner that refuses — somebody else changed the
 * object, or a value is no longer valid — has its reason shown beside the form and its field messages on the fields it
 * named. Nothing is retried or read again: the reader's form stays as they left it.
 */
async function write(valuesToSave: Record<string, string>, primaryKey: string): Promise<unknown> {
  saving.value = true;
  refusal.value = null;
  fieldErrors.value = {};
  try {
    const revision = opened.value!.revision;
    const saved = await client.save(primaryKey, valuesToSave, revision);
    held = null;
    adopt({ fields: fields.value, values: valuesToSave, revision: revision + 1 });
    panel.instance.clearDraft(slot.slot);
    return saved;
  } catch (reason) {
    showRefusal(reason);
    throw reason;
  } finally {
    saving.value = false;
  }
}

function requireKey(): string {
  const primaryKey = key.value;
  if (!primaryKey) throw new Error("This form edits one object, and none is selected");
  return primaryKey;
}

/** A form's values as the owner's text: every field the form holds is text on the wire. */
function asText(form: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(form).map(([name, value]) => [name, typeof value === "string" ? value : String(value ?? "")]),
  );
}
</script>

<template>
  <div class="sdk-owner-form">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="4" animated></el-skeleton>
    <el-empty v-else-if="!fields.length" :image-size="48"></el-empty>
    <!-- The panel frame is sandboxed without allow-forms, so the browser drops a native form submission before any
         submit handler runs: the reader's save is the button's own click. -->
    <el-form v-else label-position="top">
      <FormFieldsView
        :fields="fields"
        :values="values"
        :errors="fieldErrors"
        :disabled="saving"
        :choose-placeholder="choosePlaceholder"
        @input="typed"
        @choose="choose"
      ></FormFieldsView>
      <p v-if="changed.size" class="sdk-owner-form-changed" role="status">
        Changed: {{ [...changed].join(", ") }}
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
  font-size: 12px;
  margin: 4px 0 0;
}
.sdk-owner-form-refusal {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
