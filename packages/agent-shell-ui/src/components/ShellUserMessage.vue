<script setup lang="ts">
import { computed, inject } from "vue";
import { ChevronRight, Database } from "lucide-vue-next";
import { splitContinuationMessage } from "../continuation-message";
import { shellContextKey } from "../context";
const props = defineProps<{ text: string }>();
const message = computed(() => splitContinuationMessage(props.text));
const shell = inject(shellContextKey)!;
</script>
<template>
  <div class="user-message-content">
    <div>{{ message.text }}</div>
    <details v-if="message.context" class="analysis-context">
      <summary><Database :size="13" /><span>{{ shell.labels.value.analysisContext ?? 'Analysis context' }}</span><ChevronRight :size="13" class="context-chevron" /></summary>
      <pre>{{ message.context }}</pre>
    </details>
  </div>
</template>
<style scoped>
.analysis-context { margin-top: var(--spacing-sm); padding-top: var(--spacing-sm); border-top: 1px solid var(--el-border-color-light); white-space: normal; }
summary { display: flex; align-items: center; gap: var(--spacing-xs); width: fit-content; min-height: var(--control-height-sm); padding: 0 var(--spacing-xs); border-radius: var(--radius-sm); list-style: none; cursor: pointer; color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: var(--leading-xs); }
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
summary:focus-visible { outline: 2px solid var(--el-color-primary); }
.context-chevron { transition: transform var(--transition-fast); }
details[open] .context-chevron { transform: rotate(90deg); }
pre { margin: var(--spacing-sm) 0 0; padding: var(--spacing-sm); max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: var(--text-xs)/var(--leading-sm) var(--font-mono); color: var(--el-text-color-secondary); background: var(--el-fill-color-light); border-radius: var(--radius-sm); }
@media (prefers-reduced-motion: reduce) { .context-chevron { transition: none; } }
</style>
