<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { useFormControls } from "./form-controls";

/*
 * The advanced fields of one level of an owner form — the form, an object's fields, a row of a list — drawn after the
 * others behind one toggle that starts closed. A message on one of them (at its path or inside it) opens the section,
 * so the owner's refusal is never hidden; the reader may close it again. Closed, its fields stay mounted, so text a
 * reader typed that is no value yet is kept. Its fields lay out as the level's own (the class the level gives it).
 */
const props = defineProps<{ paths: readonly string[] }>();
const { t } = useI18n();
const controls = useFormControls();
const erred = computed(() => Object.keys(controls.errors.value).some((key) =>
  props.paths.some((path) => key === path || key.startsWith(`${path}/`))));
const open = ref(false);
watch(erred, (next) => {
  if (next) open.value = true;
}, { immediate: true });
</script>

<template>
  <div class="sdk-form-advanced">
    <div class="sdk-form-advanced-head">
      <el-button text class="sdk-form-advanced-toggle" :class="{ open }" :aria-expanded="open" data-advanced-toggle @click="open = !open">
        {{ t("platform.formAdvanced") }}
      </el-button>
    </div>
    <div v-show="open" class="sdk-form-advanced-body" data-advanced-body><slot></slot></div>
  </div>
</template>

<style scoped>
.sdk-form-advanced-head {
  flex-basis: 100%;
}
.sdk-form-advanced-toggle {
  color: var(--el-text-color-secondary);
  padding-inline: 0;
}
.sdk-form-advanced-toggle::before {
  border-block: 4px solid transparent;
  border-inline-start: 5px solid currentcolor;
  content: "";
  margin-inline-end: var(--spacing-xs);
  transition: transform 0.15s;
}
.sdk-form-advanced-toggle.open::before {
  transform: rotate(90deg);
}
/* Its fields are items of the level's own layout. */
.sdk-form-advanced-body {
  display: contents;
}
</style>
