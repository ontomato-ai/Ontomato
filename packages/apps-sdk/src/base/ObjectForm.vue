<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { FormField } from "@ontomato/contracts/form-fields";
import { FormFields as FormFieldsView } from "@ontomato/foundation-ui/form";
import { slotState, usePanelContext, useProjectionForm, useProjectionSlot } from "../panel/context";
import { platformObjectFor, selectedKey, type PlatformObjectForm } from "../panel/platform-objects";
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

const slot = useProjectionSlot();
const panel = usePanelContext();
const client = platformObjectFor(slot.projection.binding.id);
const fields = shallowRef<readonly FormField[]>([]);
const values = ref<Record<string, string>>({});
/** What the owner answered: the form as it was read, which a draft and the reader's typing both differ from. */
const baseline = ref<Record<string, string>>({});
/** The revision the form was read at; the save sends it and the owner refuses a write over a newer one. */
const revision = ref(0);
/** The fields a received draft changed, marked on the form until the reader saves or discards. */
const changed = ref<ReadonlySet<string>>(new Set());
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<Error | null>(null);

const state = computed(() => slotState(slot.slot, props.inputName));
const key = computed(() => selectedKey(panel.instance.state.values.value[state.value]));
const dirty = computed(() => JSON.stringify(values.value) !== JSON.stringify(baseline.value));

function adopt(form: PlatformObjectForm) {
  fields.value = form.fields;
  values.value = { ...form.values };
  baseline.value = { ...form.values };
  revision.value = form.revision;
  changed.value = new Set();
  loading.value = false;
}

function load(primaryKey: string | null) {
  if (!primaryKey) {
    fields.value = [];
    values.value = {};
    baseline.value = {};
    loading.value = false;
    return;
  }
  loading.value = true;
  void client.form(primaryKey).then(adopt, (reason: unknown) => fail(reason));
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
  void client.changed(primaryKey, values.value, field.key).then(adopt, (reason: unknown) => fail(reason));
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
    // The instance selects what the draft addresses, so the panel shows the object being edited.
    panel.instance.state.set(state.value, { className: slot.projection.binding.id, primaryKey });
    loading.value = false;
    const filled = asText(draft.form);
    void client.form(primaryKey).then(
      (form) => {
        adopt(form);
        values.value = { ...form.values, ...filled };
        changed.value = draft.changed;
        // A field the draft changed may be one the form depends on: the owner answers again with the draft's values, and
        // its answer is the field set the draft is shown in.
        const depended = form.fields.find((field) => field.type === "select" && field.refreshOnChange && draft.changed.has(field.key));
        if (depended)
          void client.changed(primaryKey, values.value, depended.key).then(
            (next) => {
              fields.value = next.fields;
              values.value = { ...next.values, ...filled };
              changed.value = draft.changed;
            },
            (reason: unknown) => fail(reason),
          );
      },
      (reason: unknown) => fail(reason),
    );
  },
  dirty: () => dirty.value,
  discard() {
    values.value = { ...baseline.value };
    changed.value = new Set();
  },
});

/**
 * Writes the form through its owner, at the revision it was read at. An owner that refuses — somebody else changed the
 * object, or a value is no longer valid — has its answer shown, and nothing is retried: the reader's form stays as they
 * left it.
 */
async function write(valuesToSave: Record<string, string>, primaryKey: string): Promise<unknown> {
  saving.value = true;
  try {
    const saved = await client.save(primaryKey, valuesToSave, revision.value);
    adopt({ fields: fields.value, values: valuesToSave, revision: revision.value + 1 });
    return saved;
  } catch (reason) {
    fail(reason);
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
    <el-form v-else label-position="top" @submit.prevent>
      <FormFieldsView
        :fields="fields"
        :values="values"
        :errors="{}"
        :disabled="saving"
        :choose-placeholder="choosePlaceholder"
        @input="typed"
        @choose="choose"
      ></FormFieldsView>
      <p v-if="changed.size" class="sdk-owner-form-changed" role="status">
        Changed: {{ [...changed].join(", ") }}
      </p>
    </el-form>
  </div>
</template>

<style scoped>
.sdk-owner-form-changed {
  color: var(--el-color-primary);
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
