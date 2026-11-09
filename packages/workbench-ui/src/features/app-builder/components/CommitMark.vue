<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { GitCommitHorizontal } from "lucide-vue-next";
import { shortCommit } from "../panel";

/** Under an answer whose round saved files: the commit the run itself recorded, opening its changes. */
defineProps<{ commit: string }>();
const emit = defineEmits<{ open: [commit: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="commit-mark">
    <GitCommitHorizontal :size="15" class="mark" aria-hidden="true" />
    <span>{{ t("appBuilder.autoCommitted") }}</span>
    <button type="button" class="hash" :title="t('appBuilder.viewChanges')" @click="emit('open', commit)">{{ shortCommit(commit) }}</button>
    <button type="button" class="link" @click="emit('open', commit)">{{ t("appBuilder.viewChanges") }}</button>
  </div>
</template>

<style scoped>
.commit-mark {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  max-width: 100%;
  margin-left: 6px;
  padding: 3px 12px 3px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.mark {
  flex-shrink: 0;
  color: var(--el-color-success);
}
.hash {
  padding: 1px 6px;
  border: 0;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 18px;
  cursor: pointer;
}
.hash:hover {
  background: var(--el-fill-color-dark);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.hash:focus-visible,
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
