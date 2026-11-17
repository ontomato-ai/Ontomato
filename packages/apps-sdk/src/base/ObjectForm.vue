<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { FormField } from "@ontomato/contracts/form-fields";
import { FormFields as FormFieldsView } from "@ontomato/foundation-ui/form";
import { slotState, usePanelContext, useProjectionForm, useProjectionSlot } from "../panel/context";
import { platformObjectFor, selectedKey } from "../panel/platform-objects";

/**
 * One object's form, as its owner declares it. It draws the owner's fields and nothing else — a choice is a select whose
 * unavailable options stay listed with the reason, a text is an input or a large box, in the owner's order and limits.
 * When a field the owner says the form depends on changes, the owner is asked again and its whole answer replaces the
 * fields and the values: a field the answer removed disappears with its value.
 *
 * The form is a projection, so it registers its own draft handling: the SDK compares the draft a reader's address names
 * with what the owner holds, and saving is this projection's own operation through the same owner interface.
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
/** What the owner last answered: a reader's change is the difference from it. */
const baseline = ref<Record<string, string>>({});
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<Error | null>(null);

const state = computed(() => slotState(slot.slot, props.inputName));
const key = computed(() => selectedKey(panel.instance.state.values.value[state.value]));
const dirty = computed(() => JSON.stringify(values.value) !== JSON.stringify(baseline.value));

function adopt(form: { fields: readonly FormField[]; values: Readonly<Record<string, string>> }) {
  fields.value = form.fields;
  values.value = { ...form.values };
  baseline.value = { ...form.values };
  loading.value = false;
}

function load(primaryKey: string | null) {
  if (!primaryKey) {
    adopt({ fields: [], values: {} });
    return;
  }
  loading.value = true;
  void client.form(primaryKey).then(adopt, (reason: unknown) => {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
    loading.value = false;
  });
}

onMounted(() => load(key.value));
watch(key, (next) => load(next));

/** A text changed: the draft follows it and the owner is not asked again. */
function typed(name: string, value: string) {
  values.value = { ...values.value, [name]: value };
}

/** A choice changed: when the field says the form depends on it, the owner answers again and replaces fields and values. */
function choose(field: Extract<FormField, { type: "select" }>, value: string) {
  values.value = { ...values.value, [field.key]: value };
  if (!field.refreshOnChange) return;
  loading.value = true;
  void client.changed(key.value, values.value, field.key).then(adopt, (reason: unknown) => {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
    loading.value = false;
  });
}

// The draft this projection receives is compared with the owner's own reading; the save is this form's write.
useProjectionForm({
  read: async (target) => {
    const primaryKey = target.id ?? key.value;
    if (!primaryKey) throw new Error("This form edits one object, and the draft names none");
    return (await client.form(primaryKey)).values;
  },
  save: async (form, target) => {
    saving.value = true;
    try {
      const primaryKey = target.id ?? key.value;
      if (!primaryKey) throw new Error("This form edits one object, and it names none");
      const saved = await client.save(primaryKey, form);
      adopt({ fields: fields.value, values: form });
      return saved;
    } finally {
      saving.value = false;
    }
  },
  dirty: () => dirty.value,
});
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
    </el-form>
  </div>
</template>
