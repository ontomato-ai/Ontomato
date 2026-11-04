<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { ExternalLink, Languages, LogOut, Moon, Orbit, Sun } from "lucide-vue-next";
import { availableGroups, availablePages } from "../navigation";
import { usePlatformHost } from "../context";

/*
 * The Ontology Service's one data shell: a sidebar (brand, links to the other applications, the navigation groups,
 * then user, language and theme) and the page area. The sidebar lists only pages the account may enter; the router
 * guard reads the same rule, so the navigation and a deep link agree. Pages without a header of their own get the
 * 48px page header (title and one-line description) from here.
 */
const host = usePlatformHost();
const { preferences } = host;
const route = useRoute();

const navigation = computed(() => host.navigation.value);
const pages = computed(() => availablePages(navigation.value, host.access));
const shownGroups = computed(() =>
  availableGroups(navigation.value, host.access).map((group) => ({
    group,
    pages: pages.value.filter((page) => page.group === group.key),
  }))
);
const loadError = computed(() => (host.access.ready ? host.access.error : null));
const noPermissions = computed(() => host.access.ready && !loadError.value && pages.value.length === 0);
const currentPage = computed(() => navigation.value.pages.find((page) => page.path === route.meta.page));
const dark = computed(() => preferences.theme.value === "dark");
const userInitial = computed(() => host.account?.userName.trim().charAt(0).toUpperCase() ?? "");

function localeLabel(locale: string) {
  return `lang.${locale.replace("-", "")}`;
}
</script>

<template>
  <div class="service-layout">
    <aside class="service-sidebar">
      <div class="sidebar-brand">
        <span class="brand-mark" aria-hidden="true"><Orbit :size="14" :stroke-width="2.2" /></span>
        <span class="brand-name">{{ $t("platform.serviceName") }}</span>
      </div>

      <nav v-if="!host.navigationHidden.value" class="sidebar-nav" :aria-label="$t('platform.navigation')">
        <div v-if="host.links.length > 0" class="nav-section nav-links">
          <template v-for="link in host.links" :key="link.key">
            <a
              v-if="link.href"
              class="nav-row nav-link"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              <component :is="link.icon" class="nav-icon" :size="16" aria-hidden="true" />
              <span class="nav-label">{{ $t(link.titleKey) }}</span>
              <ExternalLink class="nav-external" :size="13" role="img" :aria-label="$t('platform.openInNewTab')" />
            </a>
            <button v-else type="button" class="nav-row nav-link" @click="link.open?.()">
              <component :is="link.icon" class="nav-icon" :size="16" aria-hidden="true" />
              <span class="nav-label">{{ $t(link.titleKey) }}</span>
              <ExternalLink class="nav-external" :size="13" role="img" :aria-label="$t('platform.openInNewTab')" />
            </button>
          </template>
        </div>

        <div v-if="host.links.length > 0 && shownGroups.length > 0" class="nav-divider" role="separator" />

        <section v-for="entry in shownGroups" :key="entry.group.key" class="nav-section nav-group">
          <p class="nav-heading">{{ entry.group.title ?? $t(entry.group.titleKey) }}</p>
          <RouterLink v-for="page in entry.pages" :key="page.path" v-slot="{ href, navigate }" :to="page.path" custom>
            <a
              :href="href"
              :class="['nav-row', { active: currentPage?.path === page.path }]"
              :aria-current="currentPage?.path === page.path ? 'page' : undefined"
              @click="navigate"
            >
              <component :is="page.icon" v-if="page.icon" class="nav-icon" :size="16" aria-hidden="true" />
              <span class="nav-label">{{ page.title ?? $t(page.titleKey) }}</span>
              <span v-if="page.count && page.count() !== null" class="nav-count">{{ page.count() }}</span>
            </a>
          </RouterLink>
        </section>
      </nav>
      <div v-else class="sidebar-nav" />

      <div class="sidebar-footer">
        <template v-if="host.account">
          <span class="user-avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="user-name" :title="host.account.userName">{{ host.account.userName }}</span>
        </template>
        <span v-else class="footer-spacer" />
        <el-dropdown
          v-if="preferences.locales.length > 1"
          trigger="click"
          placement="top-start"
          @command="preferences.setLocale"
        >
          <button type="button" class="icon-button lang-button" :aria-label="$t('lang.switch')" :title="$t('lang.switch')">
            <Languages :size="16" aria-hidden="true" />
          </button>
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
        <button
          type="button"
          class="icon-button theme-button"
          :aria-label="dark ? $t('theme.light') : $t('theme.dark')"
          :title="dark ? $t('theme.light') : $t('theme.dark')"
          @click="preferences.setTheme(dark ? 'light' : 'dark')"
        >
          <Sun v-if="dark" :size="16" aria-hidden="true" />
          <Moon v-else :size="16" aria-hidden="true" />
        </button>
        <el-popconfirm
          v-if="host.account"
          :title="$t('user.logoutConfirm')"
          :confirm-button-text="$t('user.logout')"
          :cancel-button-text="$t('common.cancel')"
          width="220"
          @confirm="host.account.signOut()"
        >
          <template #reference>
            <button type="button" class="icon-button logout-button" :aria-label="$t('user.logout')" :title="$t('user.logout')">
              <LogOut :size="16" aria-hidden="true" />
            </button>
          </template>
        </el-popconfirm>
      </div>
    </aside>

    <main class="service-main">
      <div v-if="loadError" class="permission-empty" role="alert">
        <span>{{ loadError }}</span>
      </div>
      <div v-else-if="noPermissions" class="permission-empty">
        <span>{{ $t("admin.noAvailableMenuPermission") }}</span>
      </div>
      <template v-else>
        <header v-if="currentPage && !currentPage.ownHeader" class="page-header">
          <h1 class="page-title">{{ currentPage.title ?? $t(currentPage.titleKey) }}</h1>
          <p v-if="currentPage.descriptionKey" class="page-description">{{ $t(currentPage.descriptionKey) }}</p>
        </header>
        <div :class="['page-body', { 'page-body--content platform-page': currentPage && !currentPage.ownHeader }]">
          <RouterView />
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.service-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--el-bg-color);
}

/* Sidebar: canvas tone and one hairline against the page, edge to edge (DESIGN data shell). */
.service-sidebar {
  display: flex;
  width: var(--shell-agent-rail);
  flex: 0 0 var(--shell-agent-rail);
  min-height: 0;
  flex-direction: column;
  border-inline-end: 1px solid var(--el-border-color);
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

.sidebar-brand {
  display: flex;
  height: var(--page-header-height);
  flex: 0 0 var(--page-header-height);
  align-items: center;
  gap: 10px;
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
}

.brand-mark {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--el-color-primary);
  color: var(--on-primary);
}

.brand-name {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  line-height: 20px;
}

.sidebar-nav {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  overflow-y: auto;
  padding: var(--spacing-sm);
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-divider {
  height: 1px;
  margin: 0 var(--spacing-sm);
  background: var(--el-border-color);
}

.nav-heading {
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  line-height: var(--leading-xs);
  letter-spacing: 0.02em;
}

.nav-row {
  display: flex;
  height: var(--nav-row-height);
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  text-decoration: none;
  transition: background var(--transition-fast);
}

.nav-row:hover {
  background: var(--el-fill-color-light);
}

.nav-row:focus-visible,
.icon-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.nav-row.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}

.nav-icon {
  flex: 0 0 auto;
}

.nav-row.active .nav-icon {
  color: var(--el-color-primary);
}

.nav-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-count,
.nav-external {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  font-variant-numeric: tabular-nums;
}

.sidebar-footer {
  display: flex;
  height: var(--page-header-height);
  flex: 0 0 var(--page-header-height);
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-md);
  border-top: 1px solid var(--el-border-color);
}

.user-avatar {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 9999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.user-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-spacer {
  flex: 1;
}

.icon-button {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.service-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background: var(--el-bg-color);
}

.page-header {
  display: flex;
  height: var(--page-header-height);
  flex: 0 0 var(--page-header-height);
  align-items: center;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
}

.page-title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
  white-space: nowrap;
}

.page-description {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.page-body > :deep(*) {
  min-height: 0;
  flex: 1;
}

.page-body--content {
  overflow: auto;
  padding: var(--spacing-lg);
}

.page-body--content > :deep(*) {
  flex: 0 0 auto;
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
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
</style>
