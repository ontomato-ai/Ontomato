<template>
  <div class="dsl-viewer">
    <pre
      class="dsl-pre language-json"
    ><code ref="codeRef" class="language-json">{{ code }}</code></pre>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import Prism from "prismjs";
import { useI18n } from "vue-i18n";

useI18n();

import "prismjs/components/prism-json";
import "prismjs/themes/prism.css";

const props = defineProps({
  value: { type: [Object, Array, String, Number, Boolean], default: null },
});

const code = computed(() => {
  const v = props.value;
  if (v == null) return "";
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return "";
    try {
      const parsed = JSON.parse(s);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
});

const codeRef = ref(null);

async function highlight() {
  await nextTick();
  const el = codeRef.value;
  if (!el) return;
  try {
    Prism.highlightElement(el);
  } catch {
    // Ignore highlight errors
  }
}

onMounted(() => highlight());
watch(code, () => highlight());
</script>

<style scoped>
.dsl-pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  max-height: 64vh;
  overflow: auto;
  color: var(--el-text-color-primary);
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  line-height: var(--leading-mono);
  white-space: pre;
}

.dsl-pre :deep(code) {
  font-family: var(--font-mono);
  text-shadow: none;
  color: inherit;
}

/* JSON tokens on the role colours so the block reads in both modes (Prism's own theme is light only). */
.dsl-pre :deep(.token.property) {
  color: var(--brand-link);
}

.dsl-pre :deep(.token.string) {
  color: var(--el-color-success);
}

.dsl-pre :deep(.token.number),
.dsl-pre :deep(.token.boolean),
.dsl-pre :deep(.token.null) {
  color: var(--el-color-warning);
}

.dsl-pre :deep(.token.punctuation),
.dsl-pre :deep(.token.operator) {
  color: var(--el-text-color-secondary);
  background: none;
}
</style>
