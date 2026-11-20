<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, ArrowRight, Star } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { AgentAvatar } from "@ontomato/agent-shell-ui";
import ApplicationGlyph from "./ApplicationGlyph.vue";
import type { HomeItem } from "./items";

/**
 * One application or agent on the home, compact: its icon and its name, with the whole name and its one line as the
 * tooltip. Where it comes from (built in, published, connected, a link) is not shown.
 *
 * Wherever it is shown it carries the star: filled when the item is a favourite, and pressing it adds the item to the
 * favourites or takes it out. Among the favourites it also carries the two arrows that move it, so the order can be
 * changed from the keyboard as well as by dragging; they float beside the star while the tile is pointed at or holds
 * focus, so they take no width from the name.
 */
const props = defineProps<{
  item: HomeItem;
  /** Whether it is one of the reader's favourites. */
  favorite: boolean;
  favoriteBusy?: boolean;
  favoriteDisabled?: boolean;
  variant?: "compact" | "preview";
  /** The favourite's place among the favourites, when the tile is shown in that row. */
  position?: { first: boolean; last: boolean };
}>();

const emit = defineEmits<{ open: []; toggleFavorite: []; move: [offset: -1 | 1] }>();
const { t } = useI18n();
const tooltip = computed(() => (props.item.description ? `${props.item.label}\n${props.item.description}` : props.item.label));
</script>

<template>
  <div class="home-tile" :class="{ 'home-tile-preview': variant === 'preview' }">
    <button type="button" class="home-tile-open" :title="tooltip" @click="emit('open')">
      <AgentAvatar v-if="item.kind === 'agent'" :icon="item.icon" :size="22" />
      <ApplicationGlyph v-else class="home-tile-icon" :icon="item.icon" :size="16" />
      <span class="home-tile-content">
        <span class="home-tile-name">{{ item.label }}</span>
        <span v-if="variant === 'preview' && item.description" class="home-tile-description">{{ item.description }}</span>
      </span>
    </button>
    <button
      type="button"
      class="home-tile-action home-tile-star"
      :class="{ favorite }"
      :aria-pressed="favorite"
      :aria-busy="favoriteBusy || undefined"
      :aria-disabled="favoriteDisabled || undefined"
      :aria-label="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
      :title="t(favorite ? 'home.removeFavorite' : 'home.addFavorite', { name: item.label })"
      @click="!favoriteDisabled && emit('toggleFavorite')"
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
.home-tile-content { display: grid; min-width: 0; gap: var(--spacing-xs); }
.home-tile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-tile-preview { height: auto; min-height: 106px; align-items: flex-start; border-radius: var(--radius-lg); }
.home-tile-preview:hover { background: var(--el-bg-color); border-color: var(--el-border-color-dark); box-shadow: var(--elevation-panel); }
.home-tile-preview .home-tile-open { align-self: stretch; align-items: flex-start; height: auto; padding: var(--spacing-lg); }
.home-tile-preview .home-tile-name { font-weight: var(--font-semibold); }
.home-tile-preview .home-tile-icon { margin-top: 3px; }
.home-tile-preview .home-tile-star { margin: var(--spacing-sm) var(--spacing-sm) 0 0; }
.home-tile-star[aria-disabled="true"] { cursor: wait; }
.home-tile-star[aria-busy="true"] { opacity: 0.55; }
.home-tile-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
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
/*
 * Out of the layout, just left of the star (its 28px and its margin, then a 2px gap), shown only while the tile is pointed
 * at or one of its controls has focus.
 */
.home-tile-move {
  position: absolute;
  top: 50%;
  right: calc(var(--spacing-xs) + 30px);
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
