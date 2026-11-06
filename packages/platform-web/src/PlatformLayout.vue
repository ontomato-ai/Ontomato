<script setup lang="ts">
import { computed } from "vue";
import { useRoute, RouterView } from "vue-router";
import {
  PlatformPageHeader,
  PlatformShell,
  type PlatformAccount,
  type PlatformPageActions,
  type PlatformPreferences,
  type PlatformShellLabels,
} from "@ontomato/platform-shell";
import type { PlatformAppDeclaration } from "./apps";
import { railApp } from "./apps";

/**
 * The page the current address shows: its words, and whether it draws its own header. Which application it belongs to is
 * not given here: the address decides that, so the shell cannot name one application while showing another's page.
 */
export interface PlatformShownPage {
  title: string;
  description?: string | null;
  /** The page draws its own header (the ontology graph, the model settings, the conversation). */
  ownHeader?: boolean;
}

const props = defineProps<{
  /** The applications the account may see, in rail order. */
  apps: readonly PlatformAppDeclaration[];
  /** Where the address belongs and what it shows; null on an address that is no page (a conversation). */
  shownPage: PlatformShownPage | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  /** The name of each supported language, in the words the shell shows. */
  localeNames?: Readonly<Record<string, string>>;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  pageActions: PlatformPageActions | null;
  /** The host shows no application at all (its licence is not in force, or the account holds no page). */
  blocked?: { reason: "licence" | "no-pages"; message: string } | null;
}>();

const emit = defineEmits<{ selectApp: [id: string]; openSettings: [appId: string, entryId: string] }>();

/** The application whose prefix holds an address, the longest match winning: the rail's current row follows the address. */
function appFor(path: string): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const app of props.apps ?? []) {
    if (path !== app.prefix && !path.startsWith(`${app.prefix}/`)) continue;
    if (!match || app.prefix.length > match.prefix.length) match = app;
  }
  return match;
}

const route = useRoute();
const railApps = computed(() => (props.apps ?? []).map(railApp));
const activeAppId = computed(() => appFor(route.path)?.id ?? null);
const headerShown = computed(() => props.shownPage !== null && !props.shownPage.ownHeader);
</script>

<template>
  <!-- A blocked edition shows the rail's account alone: no applications, the reason in the page area. -->
  <PlatformShell
    :apps="blocked ? [] : railApps"
    :active-app-id="activeAppId"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :brand="brand"
    @select-app="emit('selectApp', $event)"
  >
    <!--
      The application's own header, then its page. The application owns the whole surface beside the rail: an
      application that wants a column draws it inside its page, not here (DESIGN.md "Applications and shells").
    -->
    <PlatformPageHeader
      v-if="headerShown && shownPage && !blocked"
      :title="shownPage.title"
      :description="shownPage.description"
      :actions="pageActions"
      :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
      @save="pageActions?.save()"
      @discard="pageActions?.discard()"
    />
    <div v-if="blocked" class="platform-blocked" role="alert">{{ blocked.message }}</div>
    <div v-else class="platform-page-body">
      <RouterView />
    </div>
  </PlatformShell>
</template>

<style scoped>
/*
 * The page area is the application's: it fills the surface beside the rail with no gutter of its own, so a page that
 * wants the full width is not inset by the platform (DESIGN.md "Layout").
 */
.platform-page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
}
.platform-page-body :deep(.platform-page) {
  height: 100%;
}
.platform-blocked {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
}
</style>
