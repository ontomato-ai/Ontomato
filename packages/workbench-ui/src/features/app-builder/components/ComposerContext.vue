<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { Info, SquareMousePointer } from "lucide-vue-next";

/**
 * With the composer: what a message sent now carries (the open view of the workspace and the object selected in the
 * preview's app), while the page is open. When another conversation's run occupies the workspace it says which, and
 * opens it; this conversation's message would be refused until that run ends. Above the conversation's composer each
 * part may take its own line; `inline`, inside the full page's one-row composer, everything stays on one line and a part
 * that does not fit is cut short, its whole text in its title.
 */
const props = defineProps<{
  pageOpen: boolean;
  inline: boolean;
  /** The open view, as the message names it. */
  page: string;
  icon: Component;
  /** The selected object, as the message names it; null when none goes with the message. */
  selection: string | null;
  busy: { title: string | null; sessionId: string | null } | null;
}>();
const emit = defineEmits<{ openSession: [id: string] }>();
const { t } = useI18n();
const selected = computed(() => props.selection && t("appBuilder.selected", { object: props.selection }));
/** Read only while busy is shown. */
const busyText = computed(() =>
  props.busy?.title ? t("appBuilder.busyElsewhere", { title: props.busy.title }) : t("appBuilder.busyUnknown"),
);
</script>

<template>
  <div class="composer-context-line" :class="{ inline }">
    <p v-if="busy" class="busy" role="status">
      <Info :size="14" aria-hidden="true" />
      <span class="busy-text" :title="busyText">{{ busyText }}</span>
      <button v-if="busy.sessionId" type="button" class="link" @click="emit('openSession', busy.sessionId)">
        {{ t("appBuilder.openBusy") }}
      </button>
    </p>
    <div v-if="pageOpen" class="carries">
      <span class="carries-label">{{ t("appBuilder.carries") }}</span>
      <span class="chip" :title="page"><component :is="icon" :size="13" aria-hidden="true" /><span class="chip-text">{{ page }}</span></span>
      <span v-if="selected" class="chip" :title="selected">
        <SquareMousePointer :size="13" aria-hidden="true" /><span class="chip-text">{{ selected }}</span>
      </span>
    </div>
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
/* Each chip keeps its own line when the two do not fit, and is cut short only when it alone is wider than the row. */
.carries {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}
/* Inside the one-row composer: everything on one line, each part cut short rather than wrapped. */
.composer-context-line.inline {
  flex-direction: row;
  align-items: center;
}
.inline .busy {
  align-items: center;
  min-width: 0;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
}
.inline .busy svg {
  margin-top: 0;
}
.inline .busy-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline .carries {
  flex-wrap: nowrap;
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
.link {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
