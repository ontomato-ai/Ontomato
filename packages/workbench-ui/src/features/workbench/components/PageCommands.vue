<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus";
import { Ellipsis } from "lucide-vue-next";
import { ActionTooltip } from "@ontomato/foundation-ui/overlay";
import type { PlatformPageAction } from "@ontomato/platform-shell";

/**
 * A page's commands where the conversation draws its title (big main's ruling, 2026-11-21: the host draws a page's
 * commands wherever it draws the page's title). Shown full they stand in a row as in the platform's header; beside the
 * conversation, where the strip is narrow, the icon tools stay and the rest are under one "More", every one still there.
 * A click is the page's own: a state change moves its address, an operation runs with the reader's rights.
 */
const props = defineProps<{ actions: readonly PlatformPageAction[]; view: "full" | "side" }>();
const { t } = useI18n();

const tool = (action: PlatformPageAction) => Boolean(action.iconOnly && action.icon);
const inline = computed(() => (props.view === "full" ? props.actions : props.actions.filter(tool)));
const more = computed(() => (props.view === "full" ? [] : props.actions.filter((action) => !tool(action))));
function run(id: string) {
  more.value.find((action) => action.id === id)?.onClick();
}
</script>

<template>
  <span class="page-commands">
    <template v-for="action in inline" :key="action.id">
      <ActionTooltip v-if="tool(action)" :content="action.label">
        <button type="button" class="command icon" :aria-label="action.label"
          :disabled="action.disabled || action.loading" @click="action.onClick()">
          <component :is="action.icon" :size="16" aria-hidden="true" />
        </button>
      </ActionTooltip>
      <button v-else type="button" class="command"
        :class="action.primary ? 'primary' : action.danger ? 'danger' : undefined"
        :disabled="action.disabled || action.loading" @click="action.onClick()">
        <component :is="action.icon" v-if="action.icon" :size="16" aria-hidden="true" />
        <span>{{ action.label }}</span>
      </button>
    </template>
    <ElDropdown v-if="more.length" trigger="click" placement="bottom-end" @command="run">
      <button type="button" class="command icon" :aria-label="t('common.more')" :title="t('common.more')">
        <Ellipsis :size="16" aria-hidden="true" />
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="action in more" :key="action.id" :command="action.id" :disabled="action.disabled || action.loading">
            {{ action.label }}
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </span>
</template>

<style scoped>
.page-commands {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.command {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  cursor: pointer;
}
.command.icon {
  width: 32px;
  padding: 0;
  justify-content: center;
  border-color: transparent;
  background: transparent;
  color: var(--el-text-color-secondary);
}
.command:hover:not(:disabled) { background: var(--el-fill-color-light); }
.command.primary { border-color: var(--el-color-primary); background: var(--el-color-primary); color: var(--el-color-white); }
.command.danger { color: var(--el-color-danger); }
.command:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
