<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, ArrowRight, Star } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { appIcon } from "@ontomato/platform-shell";
import type { HomeItem } from "./items";

/**
 * One application or agent on the home, compact: its icon and its name, with the whole name and its one line as the
 * tooltip. Where it comes from (built in, published, connected, a link) is not shown.
 *
 * In the square it carries the star that adds it to the favourites or takes it out. Among the favourites it carries the
 * two arrows that move it, so the order can be changed from the keyboard as well as by dragging; they float over the
 * tile's end while it is pointed at or holds focus, so they take no width from the name.
 */
const props = defineProps<{
  item: HomeItem;
  /** Whether it is a favourite, when the tile offers the star. */
  favorite?: boolean;
  /** The favourite's place among the favourites, when the tile is shown in that row. */
  position?: { first: boolean; last: boolean };
}>();

const emit = defineEmits<{ open: []; toggleFavorite: []; move: [offset: -1 | 1] }>();
const { t } = useI18n();
const tooltip = computed(() => (props.item.description ? `${props.item.label}\n${props.item.description}` : props.item.label));
</script>

<template>
  <div class="home-tile">
    <button type="button" class="home-tile-open" :title="tooltip" @click="emit('open')">
      <component :is="appIcon(item.icon)" class="home-tile-icon" :size="16" aria-hidden="true" />
      <span class="home-tile-name">{{ item.label }}</span>
    </button>
    <button
      v-if="favorite !== undefined"
      type="button"
      class="home-tile-action home-tile-star"
      :class="{ favorite }"
      :aria-pressed="favorite"
      :aria-label="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
      :title="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
      @click="emit('toggleFavorite')"
    >
      <Star :size="14" :fill="favorite ? 'currentColor' : 'none'" aria-hidden="true" />
    </button>
    <div v-if="position" class="home-tile-move">
      <button
        type="button"
        class="home-tile-action"
        :disabled="position.first"
        :aria-label="t('home.moveEarlier', { name: item.label })"
        :title="t('home.moveEarlier', { name: item.label })"
        @click="emit('move', -1)"
      >
        <ArrowLeft :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="home-tile-action"
        :disabled="position.last"
        :aria-label="t('home.moveLater', { name: item.label })"
        :title="t('home.moveLater', { name: item.label })"
        @click="emit('move', 1)"
      >
        <ArrowRight :size="14" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.home-tile {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--control-height-lg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.home-tile:hover {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-light);
}
.home-tile-open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
  height: 100%;
  padding: 0 var(--spacing-md);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  cursor: pointer;
}
.home-tile-open:focus-visible,
.home-tile-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.home-tile-icon {
  flex: 0 0 auto;
  color: var(--el-color-primary);
}
.home-tile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-tile-action {
  display: inline-flex;
  flex: 0 0 auto;
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
.home-tile-action:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.home-tile-action:disabled {
  color: var(--el-text-color-disabled);
  cursor: default;
}
.home-tile-star {
  margin-right: var(--spacing-xs);
}
.home-tile-star.favorite {
  color: var(--el-color-warning);
}
/* Out of the layout, over the tile's end, shown only while the tile is pointed at or one of its controls has focus. */
.home-tile-move {
  position: absolute;
  top: 50%;
  right: var(--spacing-xs);
  display: flex;
  gap: 2px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity var(--transition-fast);
}
.home-tile:hover .home-tile-move,
.home-tile:focus-within .home-tile-move {
  opacity: 1;
}
</style>
