<script setup lang="ts">
import type { Component } from "vue";
import { useI18n } from "vue-i18n";
import { Info, PanelRightOpen } from "lucide-vue-next";

/**
 * Above the composer: what a message sent now carries (the open view of the workspace), or, with only the conversation
 * shown, the way back to the workspace page. When another conversation's run occupies the workspace it says which, and
 * opens it; this conversation's message would be refused until that run ends.
 */
defineProps<{
  pageOpen: boolean;
  /** The open view, as the message names it. */
  page: string;
  icon: Component;
  busy: { title: string | null; sessionId: string | null } | null;
}>();
const emit = defineEmits<{ openPage: []; openSession: [id: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="composer-context-line">
    <p v-if="busy" class="busy" role="status">
      <Info :size="14" aria-hidden="true" />
      <span>{{ busy.title ? t("appBuilder.busyElsewhere", { title: busy.title }) : t("appBuilder.busyUnknown") }}</span>
      <button v-if="busy.sessionId" type="button" class="link" @click="emit('openSession', busy.sessionId)">
        {{ t("appBuilder.openBusy") }}
      </button>
    </p>
    <div v-if="pageOpen" class="carries">
      <span class="carries-label">{{ t("appBuilder.carries") }}</span>
      <span class="chip"><component :is="icon" :size="13" aria-hidden="true" /><span class="chip-text">{{ page }}</span></span>
    </div>
    <button v-else type="button" class="chip open-page" @click="emit('openPage')">
      <PanelRightOpen :size="13" aria-hidden="true" />
      <span class="chip-text">{{ t("appBuilder.openPreview") }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Small chips on the overlay surface, legible on the conversation and over the page the full composer floats on. */
.composer-context-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.busy {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--el-color-warning-light-9);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.busy svg {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--el-color-warning);
}
.carries {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}
.carries-label {
  flex-shrink: 0;
  padding: 0 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  height: 24px;
  padding: 0 9px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-full);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
}
.chip svg {
  flex-shrink: 0;
}
.chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.open-page {
  cursor: pointer;
}
.open-page:hover {
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}
.link {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.open-page:focus-visible,
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
