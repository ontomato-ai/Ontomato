<script setup lang="ts">
import { ArrowLeft } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

/**
 * A page's own list beside its detail. Wide, both columns show; in the narrow side panel the page shows the list until
 * something is selected, then the detail with a way back (DESIGN "Agent apps": a page works at the side panel's width).
 */
defineProps<{ selected: boolean }>();
const emit = defineEmits<{ back: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="list-detail" :class="{ selected }">
    <aside class="ld-list">
      <div v-if="$slots.toolbar" class="ld-toolbar"><slot name="toolbar" /></div>
      <div class="ld-items"><slot name="list" /></div>
    </aside>
    <section class="ld-detail">
      <button v-if="selected" type="button" class="ld-back" @click="emit('back')">
        <ArrowLeft :size="15" />{{ t("common.back") }}
      </button>
      <div class="ld-body"><slot name="detail" /></div>
    </section>
  </div>
</template>

<style scoped>
.list-detail {
  display: flex;
  height: 100%;
  min-height: 0;
}
.ld-list {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  min-height: 0;
  border-right: 1px solid var(--el-border-color);
}
.ld-toolbar {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.ld-items {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--spacing-sm);
}
.ld-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.ld-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.ld-back {
  display: none;
}
@container page (max-width: 720px) {
  .ld-list {
    width: 100%;
    border-right: 0;
  }
  .list-detail.selected .ld-list,
  .list-detail:not(.selected) .ld-detail {
    display: none;
  }
  .ld-back {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--nav-row-height);
    padding: 0 12px;
    border: 0;
    border-bottom: 1px solid var(--el-border-color);
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    cursor: pointer;
  }
}
</style>
