<script setup lang="ts">
import { ArrowLeft, ArrowRight, Star } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { appIcon } from "@ontomato/platform-shell";
import type { HomeItem } from "./items";

/**
 * One application or agent on the home: its icon, its name, its one line, and the star that adds it to the reader's
 * favourites or takes it out. Where it comes from (built in, published, connected, a link) is not shown.
 *
 * A favourite can be moved by the two arrow buttons as well as dragged, so its order can be changed from the keyboard.
 * The arrows float beside the star while the card is pointed at or holds focus, so they take no width from the name
 * and the line: a favourite truncates its text exactly as the same card does in the square.
 */
defineProps<{
  item: HomeItem;
  favorite: boolean;
  /** The favourite's place among the favourites, when the card is shown in that list. */
  position?: { first: boolean; last: boolean };
}>();

const emit = defineEmits<{ open: []; toggleFavorite: []; move: [offset: -1 | 1] }>();
const { t } = useI18n();
</script>

<template>
  <div class="home-card">
    <button type="button" class="home-card-open" @click="emit('open')">
      <span class="home-card-icon" aria-hidden="true"><component :is="appIcon(item.icon)" :size="18" /></span>
      <span class="home-card-text">
        <span class="home-card-name">{{ item.label }}</span>
        <span v-if="item.description" class="home-card-description" :title="item.description">{{ item.description }}</span>
      </span>
    </button>
    <div class="home-card-actions">
      <div v-if="position" class="home-card-move-group">
        <button
          type="button"
          class="home-card-action home-card-move"
          :disabled="position.first"
          :aria-label="t('home.moveEarlier', { name: item.label })"
          :title="t('home.moveEarlier', { name: item.label })"
          @click="emit('move', -1)"
        >
          <ArrowLeft :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="home-card-action home-card-move"
          :disabled="position.last"
          :aria-label="t('home.moveLater', { name: item.label })"
          :title="t('home.moveLater', { name: item.label })"
          @click="emit('move', 1)"
        >
          <ArrowRight :size="14" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        class="home-card-action home-card-star"
        :class="{ favorite }"
        :aria-pressed="favorite"
        :aria-label="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
        :title="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
        @click="emit('toggleFavorite')"
      >
        <Star :size="16" :fill="favorite ? 'currentColor' : 'none'" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.home-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.home-card:hover {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-light);
}
.home-card-open {
  display: flex;
  flex: 1;
  align-items: flex-start;
  gap: var(--spacing-md);
  min-width: 0;
  padding: var(--spacing-md);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.home-card-open:focus-visible,
.home-card-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.home-card-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.home-card-text {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.home-card-name {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  line-height: var(--leading-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-card-description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.home-card-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: var(--spacing-sm) var(--spacing-sm) 0 0;
}
.home-card-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.home-card-action:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.home-card-action:disabled {
  color: var(--el-text-color-disabled);
  cursor: default;
}
.home-card-star.favorite {
  color: var(--el-color-warning);
}
/*
 * The arrows are for rearranging: out of the layout, on the star's row just left of it (one 28px action and the 2px gap),
 * and shown only while the card is pointed at or one of its controls has focus, so tabbing reaches them and they never
 * narrow the text; while shown they cover the end of the name.
 */
.home-card-move-group {
  position: absolute;
  top: var(--spacing-sm);
  right: calc(var(--spacing-sm) + 30px);
  display: flex;
  gap: 2px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.home-card:hover .home-card-move-group,
.home-card:focus-within .home-card-move-group {
  opacity: 1;
}
</style>
