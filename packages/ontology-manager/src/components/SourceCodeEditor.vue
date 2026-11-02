<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton } from "element-plus";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import { useOntologyText } from "../context";

hljs.registerLanguage("python", python);
const props = defineProps<{ modelValue?: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const { ot } = useOntologyText();
const editing = ref(false);
const preview = ref<HTMLElement>();
const highlighted = computed(() => hljs.highlight(props.modelValue || "", { language: "python", ignoreIllegals: true }).value);
function syncScroll(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  if (preview.value) { preview.value.scrollTop = input.scrollTop; preview.value.scrollLeft = input.scrollLeft; }
}
function indent(event: KeyboardEvent) {
  if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  const input = event.target as HTMLTextAreaElement;
  input.setRangeText("    ", input.selectionStart, input.selectionEnd, "end");
  emit("update:modelValue", input.value);
}
</script>

<template>
  <div class="source-code-editor" :class="{ 'is-editing': editing }">
    <div class="source-toolbar">
      <span>Python</span>
      <div class="source-modes" role="group" :aria-label="ot('explainerCode')">
        <el-button text :bg="!editing" size="small" :aria-pressed="!editing" @click="editing = false">{{ ot('ovPreview') }}</el-button>
        <el-button text :bg="editing" size="small" :aria-pressed="editing" @click="editing = true">{{ ot('ovEdit') }}</el-button>
      </div>
    </div>
    <div class="source-body" :class="{ 'is-editing': editing }">
      <!-- highlight.js escapes source text before adding its own token spans. -->
      <pre ref="preview" class="source-preview" :tabindex="editing ? -1 : 0" :aria-hidden="editing || undefined" :aria-label="ot('explainerCode')"><code class="hljs language-python" v-html="highlighted + '\n'" /></pre>
      <textarea v-if="editing" class="source-input" :value="modelValue || ''" :aria-label="ot('explainerCode')" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" @scroll="syncScroll" @keydown="indent" />
    </div>
  </div>
</template>

<style scoped>
.source-code-editor { width: 100%; min-width: 0; overflow: hidden; border-radius: var(--radius-sm); background: var(--el-fill-color-extra-light); }
.source-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 12px; border-bottom: 1px solid var(--el-border-color-lighter); color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.source-modes { display: flex; align-items: center; gap: 4px; }
.source-modes .el-button + .el-button { margin-inline-start: 0; }
.source-modes .el-button[aria-pressed="true"], .source-modes .el-button[aria-pressed="true"]:hover { color: var(--el-color-primary); background: var(--el-color-primary-light-9) !important; box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5); }
.source-body { position: relative; }
.source-preview { box-sizing: border-box; height: 360px; margin: 0; padding: 12px 16px; overflow: auto; tab-size: 4; white-space: pre; color: var(--el-text-color-primary); }
.source-preview, .source-input { font-family: var(--font-mono); font-size: var(--text-sm); font-weight: normal; line-height: 22px; letter-spacing: normal; tab-size: 4; }
.source-preview code { font: inherit; }
.source-preview:focus-visible { outline: 1px solid var(--el-border-color-hover); outline-offset: -1px; }
.is-editing .source-preview { pointer-events: none; }
.source-input { position: absolute; inset: 0; box-sizing: border-box; width: 100%; height: 100%; margin: 0; padding: 12px 16px; border: 0; border-radius: 0; resize: none; overflow: auto; white-space: pre; background: transparent; color: transparent; -webkit-text-fill-color: transparent; caret-color: var(--el-text-color-primary); }
.source-input:focus-visible { outline: none; }
.source-input::selection { background: color-mix(in srgb, var(--el-color-primary) 25%, transparent); color: transparent; -webkit-text-fill-color: transparent; }
.source-preview :deep(.hljs-comment) { color: var(--el-text-color-secondary); }
.source-preview :deep(.hljs-keyword), .source-preview :deep(.hljs-literal) { color: var(--el-color-primary); }
.source-preview :deep(.hljs-string), .source-preview :deep(.hljs-doctag) { color: var(--el-color-success); }
.source-preview :deep(.hljs-number), .source-preview :deep(.hljs-built_in) { color: var(--el-color-warning); }
.source-preview :deep(.hljs-title), .source-preview :deep(.hljs-meta) { color: var(--el-color-danger); }
</style>
