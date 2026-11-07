<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ChevronRight } from "lucide-vue-next";
import type { McpTool } from "../api";
defineProps<{ tools: McpTool[] }>();
const { t } = useI18n();
</script>

<template>
  <div class="tool-list">
    <p v-if="!tools.length" class="muted">{{ t("mcp.noTools") }}</p>
    <details v-for="tool in tools" :key="tool.name">
      <summary>
        <span class="tool-arrow"><ChevronRight :size="14" aria-hidden="true" /></span>
        <span class="tool-name">
        <strong>{{ tool.title || tool.name }}</strong>
        <code v-if="tool.title">{{ tool.name }}</code>
        </span>
      </summary>
      <p v-if="tool.description">{{ tool.description }}</p>
      <template v-if="tool.inputSchema">
        <div class="muted">{{ t("hotData.inputParams") }}</div>
        <pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
      </template>
    </details>
  </div>
</template>

<style scoped>
.tool-list {
  margin-top: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
details {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: var(--spacing-md) var(--spacing-lg);
}
details:last-child { border-bottom: 0; }
summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  list-style: none;
  cursor: pointer;
  line-height: 28px;
  overflow-wrap: anywhere;
}
summary::-webkit-details-marker { display: none; }
.tool-arrow { display: inline-flex; flex: 0 0 14px; color: var(--el-text-color-secondary); transition: transform var(--transition-fast); }
details[open] > summary > .tool-arrow { transform: rotate(90deg); }
.tool-name { display: flex; min-width: 0; flex-wrap: wrap; align-items: baseline; gap: var(--spacing-xs) var(--spacing-md); }
summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
strong {
  font-weight: 500;
}
summary code {
  margin-left: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
p {
  margin: 8px 0;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre {
  margin-bottom: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  font-size: var(--text-mono);
}
.muted {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
