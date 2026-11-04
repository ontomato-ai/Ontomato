<script setup lang="ts">
import { ChevronDown, Moon, Sun, UserRound } from "lucide-vue-next";
import { useLocale } from "@ontomato/workbench-ui";

defineProps<{
  visible: boolean;
  isDark: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  toggleTheme: [];
}>();

const { t } = useLocale();

function closeAll() {
  emit("update:visible", false);
}

function handleToggleTheme() {
  emit("toggleTheme");
  closeAll();
}
</script>

<template>
  <div class="user-menu-wrapper">
    <button
      type="button"
      class="footer-user"
      :aria-label="t('user.menu')"
      :aria-expanded="visible"
      @click.stop="emit('update:visible', !visible)"
    >
      <span class="user-avatar"><UserRound :size="16" /></span>
      <span class="footer-user-name">{{ t("user.menu") }}</span>
      <ChevronDown :size="12" class="footer-chevron" :class="{ open: visible }" />
    </button>
    <Teleport to="body">
      <div v-if="visible" class="user-menu-overlay" @click="emit('update:visible', false)">
        <div class="user-menu-popup" @click.stop>
          <div class="user-menu-item" @click="handleToggleTheme">
            <Sun v-if="isDark" :size="14" />
            <Moon v-else :size="14" />
            <span>{{ isDark ? t("theme.light") : t("theme.dark") }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.user-avatar {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.footer-user {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--nav-row-height);
  padding: 0 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  transition: background-color var(--transition-fast);
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
.footer-user:hover {
  background: var(--el-fill-color-light);
}
.footer-user:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.footer-user-name {
  color: var(--el-text-color-regular);
}
.footer-chevron {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast);
}
.footer-chevron.open {
  transform: rotate(180deg);
}
.user-menu-wrapper {
  position: relative;
}
.user-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
}
.user-menu-popup {
  position: fixed;
  bottom: 56px;
  left: 8px;
  width: 200px;
  background: var(--el-bg-color-overlay);
  border-radius: var(--radius-md);
  box-shadow: var(--elevation-overlay);
  padding: 4px;
  animation: menuSlideUp var(--transition-base);
  z-index: 2101;
}
@keyframes menuSlideUp {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--nav-row-height);
  padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.user-menu-item:hover {
  background: var(--el-fill-color-light);
}
.user-menu-item :deep(svg) {
  color: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  .user-menu-popup {
    left: 12px;
    right: 12px;
    bottom: calc(52px + env(safe-area-inset-bottom));
    width: auto;
  }
  .user-menu-item {
    min-height: 44px;
  }
}
</style>
