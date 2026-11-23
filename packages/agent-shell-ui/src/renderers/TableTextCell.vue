<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import { ChevronDown, ChevronUp } from "lucide-vue-next";
import { shellContextKey } from "../context";

const props = defineProps<{ text: string }>();
const shell = inject(shellContextKey, null);
const toggleLabel = computed(() => expanded.value ? shell?.labels.value.close ?? "Close" : shell?.labels.value.open ?? "Open");
const content = ref<HTMLElement>();
const expanded = ref(false);
const overflowing = ref(false);
const expandable = computed(() => overflowing.value || expanded.value);
let observer: ResizeObserver | undefined;
function measure() {
  if (!expanded.value && content.value)
    overflowing.value = content.value.scrollHeight > content.value.clientHeight + 1;
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measure);
    if (content.value) observer.observe(content.value);
  }
});
watch(() => props.text, async () => {
  expanded.value = false;
  await nextTick();
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="table-text-cell" :class="{ expanded }">
    <div ref="content" class="text-content">{{ text }}</div>
    <button v-if="expandable" type="button" class="text-toggle" :aria-expanded="expanded" :aria-label="toggleLabel" :title="toggleLabel" @click.stop="expanded = !expanded">
      <component :is="expanded ? ChevronUp : ChevronDown" :size="14" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.table-text-cell { min-width: 0; }
.text-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; max-height: 4.5em; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.expanded .text-content { display: block; max-height: 240px; overflow: auto; overscroll-behavior: contain; }
.text-toggle { display: flex; align-items: center; justify-content: center; width: 24px; height: 22px; margin-top: 2px; padding: 0; border: 0; border-radius: 4px; color: var(--el-color-primary); background: transparent; cursor: pointer; }
.text-toggle:hover { background: var(--el-fill-color-light); }
.text-toggle:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
</style>
