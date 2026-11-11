<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { MessageSquare } from "lucide-vue-next";
import { relativeTime } from "@ontomato/workbench-ui";
import HomeTile from "./HomeTile.vue";
import { itemKey, type HomeItem, type RecentConversation } from "./items";

/**
 * Where the reader left off: their latest conversations, each reopened where it was, then the applications they opened
 * last. The agents are not listed again on their own; the conversations already name them.
 */
defineProps<{
  conversations: readonly RecentConversation[];
  applications: readonly HomeItem[];
  /** The reader's favourites, by `itemKey`, so the applications' stars show which they are. */
  favorites: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  openConversation: [conversation: RecentConversation];
  openApplication: [item: HomeItem];
  toggleFavorite: [item: HomeItem];
}>();
const { t } = useI18n();
</script>

<template>
  <div class="home-continue">
    <ul v-if="conversations.length > 0" class="home-conversations">
      <li v-for="conversation in conversations" :key="conversation.sessionId">
        <button
          type="button"
          class="home-conversation"
          :title="conversation.title || t('home.untitledConversation')"
          @click="emit('openConversation', conversation)"
        >
          <MessageSquare class="home-conversation-icon" :size="16" aria-hidden="true" />
          <span class="home-conversation-text">
            <span class="home-conversation-title" :class="{ untitled: !conversation.title }">
              {{ conversation.title || t("home.untitledConversation") }}
            </span>
            <span class="home-conversation-meta">
              <span class="home-conversation-agent">{{ conversation.agent.label }}</span>
              <span aria-hidden="true">·</span>
              <time :datetime="conversation.updatedAt">{{ relativeTime(conversation.updatedAt) }}</time>
            </span>
          </span>
        </button>
      </li>
    </ul>
    <div v-if="applications.length > 0" class="home-recent-apps">
      <h3 class="home-subheading">{{ t("home.recentApps") }}</h3>
      <div class="home-tile-row">
        <HomeTile
          v-for="item in applications"
          :key="item.id"
          :item="item"
          :favorite="favorites.has(itemKey(item))"
          @open="emit('openApplication', item)"
          @toggle-favorite="emit('toggleFavorite', item)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-continue {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}
.home-conversations {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing-md);
  margin: 0;
  padding: 0;
  list-style: none;
}
.home-conversation {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.home-conversation:hover {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-light);
}
.home-conversation:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.home-conversation-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
}
.home-conversation-text {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.home-conversation-title {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-conversation-title.untitled {
  color: var(--el-text-color-secondary);
}
.home-conversation-meta {
  display: flex;
  gap: var(--spacing-xs);
  min-width: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: nowrap;
}
.home-conversation-agent {
  overflow: hidden;
  text-overflow: ellipsis;
}
.home-recent-apps {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.home-subheading {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
}
.home-tile-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--spacing-sm);
}
</style>
