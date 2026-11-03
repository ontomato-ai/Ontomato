<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Languages, LogOut, Moon, Sun } from "lucide-vue-next";
import { availableGroups, availablePages } from "../navigation";
import { usePlatformHost } from "../context";

/*
 * The platform area's layout: the header (back to the workspace, title, action tabs, language, theme, account) and the
 * left navigation of platform pages. It lists only pages the account may enter; the router guard reads the same rule,
 * so the menu and a deep link agree.
 */
const host = usePlatformHost();
const { preferences } = host;
const route = useRoute();
const router = useRouter();

const navigation = computed(() => host.navigation.value);
const pages = computed(() => availablePages(navigation.value, host.access));
const shownGroups = computed(() =>
  availableGroups(navigation.value, host.access).map((group) => ({
    group,
    pages: pages.value.filter((page) => page.group === group.key),
  }))
);
/** Group headings appear only when the navigation has more than one group. */
const showGroupTitles = computed(() => shownGroups.value.length > 1);
const loadError = computed(() => (host.access.ready ? host.access.error : null));
const noPermissions = computed(() => host.access.ready && !loadError.value && pages.value.length === 0);
const currentPage = computed(() => navigation.value.pages.find((page) => page.path === route.path));

function select(path: string) {
  if (route.path !== path) void router.push(path);
}

function localeLabel(locale: string) {
  return `lang.${locale.replace("-", "")}`;
}
</script>

<template>
  <div class="platform-layout">
    <header class="platform-header">
      <div class="header-left">
        <el-button class="back-btn" text @click="host.openWorkspace()">
          <el-icon><ArrowLeft /></el-icon>
          <span>{{ $t("platform.backToWorkspace") }}</span>
        </el-button>
        <div class="header-divider"></div>
        <div class="header-title">{{ $t("platform.title") }}</div>
        <nav v-if="host.actions.length > 0 && !host.navigationHidden.value" class="header-actions">
          <el-button
            v-for="action in host.actions"
            :key="action.key"
            class="action-tab"
            text
            @click="action.select()"
          >
            {{ $t(action.titleKey) }}
          </el-button>
        </nav>
      </div>
      <div class="header-right">
        <el-dropdown v-if="preferences.locales.length > 1" trigger="click" @command="preferences.setLocale">
          <el-button class="lang-btn" text :icon="Languages" :title="$t('lang.switch')" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="locale in preferences.locales"
                :key="locale"
                :command="locale"
                :class="{ 'lang-item-active': preferences.locale.value === locale }"
              >
                {{ $t(localeLabel(locale)) }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button
          class="theme-btn"
          :icon="preferences.theme.value === 'dark' ? Sun : Moon"
          text
          :title="preferences.theme.value === 'dark' ? $t('theme.light') : $t('theme.dark')"
          @click="preferences.setTheme(preferences.theme.value === 'dark' ? 'light' : 'dark')"
        />
        <template v-if="host.account">
          <span class="user-name">{{ host.account.userName }}</span>
          <el-popconfirm
            :title="$t('user.logoutConfirm')"
            :confirm-button-text="$t('user.logout')"
            :cancel-button-text="$t('common.cancel')"
            width="220"
            @confirm="host.account.signOut()"
          >
            <template #reference>
              <el-button class="logout-btn" text>
                <el-icon><LogOut /></el-icon>
                <span>{{ $t("user.logout") }}</span>
              </el-button>
            </template>
          </el-popconfirm>
        </template>
      </div>
    </header>

    <main v-if="host.navigationHidden.value" class="platform-main platform-main--alone">
      <router-view />
    </main>

    <div v-else-if="loadError" class="permission-empty" role="alert">
      <span>{{ loadError }}</span>
    </div>

    <div v-else-if="noPermissions" class="permission-empty">
      <span>{{ $t("admin.noAvailableMenuPermission") }}</span>
      <el-button type="primary" @click="host.openWorkspace()">
        {{ $t("platform.backToWorkspace") }}
      </el-button>
    </div>

    <div v-else class="platform-body">
      <aside class="platform-aside">
        <nav class="platform-nav">
          <template v-for="entry in shownGroups" :key="entry.group.key">
            <p v-if="showGroupTitles" class="nav-heading">{{ entry.group.title ?? $t(entry.group.titleKey) }}</p>
            <button
              v-for="page in entry.pages"
              :key="page.path"
              :class="['nav-item', { active: route.path === page.path }]"
              @click="select(page.path)"
            >
              <span>{{ page.title ?? $t(page.titleKey) }}</span>
            </button>
          </template>
        </nav>
      </aside>
      <main class="platform-main">
        <h1 v-if="currentPage" class="page-title">{{ currentPage.title ?? $t(currentPage.titleKey) }}</h1>
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.platform-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.platform-header {
  display: flex;
  height: 64px;
  flex: 0 0 64px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  box-shadow: var(--shadow-tab);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.header-divider {
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
}

.header-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  letter-spacing: -0.01em;
}

.back-btn,
.logout-btn {
  color: var(--el-text-color-secondary);
}

.back-btn span,
.logout-btn span {
  font-size: var(--text-sm);
}

.user-name {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.platform-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.platform-aside {
  width: 220px;
  flex: 0 0 220px;
  overflow-y: auto;
  border-right: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.platform-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-sm);
}

.nav-heading {
  margin: var(--spacing-md) var(--spacing-sm) var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: 10px var(--spacing-md);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  transition: background var(--transition-base), color var(--transition-base);
}

.nav-item:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.nav-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}

.platform-main {
  min-width: 0;
  flex: 1;
  overflow: auto;
  padding: var(--spacing-xl);
  background: var(--el-bg-color-page);
}

.platform-main--alone {
  min-height: 0;
}

.page-title {
  margin: 0 0 var(--spacing-lg);
  color: var(--el-text-color-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-left: var(--spacing-md);
}

.action-tab {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}

.permission-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
}

.lang-item-active {
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}
</style>
