<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { CalendarClock, Check, ChevronDown, ExternalLink, SquarePen, Trash2, MoreHorizontal, Pencil, X } from "lucide-vue-next";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";
import { featureIcon } from "../icons";

/**
 * The navigation column of a conversation application: its head, a new conversation, the application's own pages, the
 * recent conversations, and the application's own entry at the foot.
 *
 * The head is the agent switcher when the application runs on more than one agent (the agent platform, switched the way
 * Codex switches products) and the application's name when it runs on one. The column is drawn by the application inside
 * the area the platform gives it; this component owns no frame, no brand and no footer chrome.
 */
const props = withDefaults(defineProps<{
  workbench: ShellWorkbenchDeclaration;
  /** The application's name, shown at the top when it runs on one agent. */
  title: string;
  agents: AgentHostAgent[];
  agentPicker?: boolean;
  agentId: string | null;
  sessions: AgentHostSession[];
  sessionsState: "loading" | "ready" | "error";
  hasMore: boolean;
  sessionId: string | null;
  featureId: string | null;
  /** The application's own entry at the foot (its settings, the model the diagnosis runs on). */
  bottom?: { label: string; icon: string } | null;
  /** The shell's own words; the column is drawn outside the conversation's provider, so they are passed in. */
  labels: ShellLabels;
}>(), {
  // A column drawn before its reads settle (or after the host was torn down) shows an empty column, not a crash.
  agents: () => [],
  sessions: () => [],
  sessionsState: "loading",
  hasMore: false,
  agentId: null,
  sessionId: null,
  featureId: null,
  bottom: null,
});
const emit = defineEmits<{
  newConversation: [];
  selectFeature: [id: string];
  featureAction: [id: string];
  selectAgent: [id: string];
  selectSession: [id: string];
  deleteSession: [id: string];
  renameSession: [id: string, title: string];
  openBottom: [];
  loadMore: [];
  retry: [];
}>();
const agentMenuOpen = ref(false);
const agentMenu = ref<HTMLElement | null>(null);
const agentPopup = ref<HTMLElement | null>(null);
const popupStyle = ref<Record<string, string>>({});
const confirmingDelete = ref<string | null>(null);
const sessionMenu = ref<string | null>(null);
const editingSession = ref<string | null>(null);
const draftTitle = ref("");
const renameDialog = ref<HTMLDialogElement | null>(null);
function cancelRename() {
  renameDialog.value?.close();
  editingSession.value = null;
}
const navRoot = ref<HTMLElement | null>(null);
const sessionPopup = ref<HTMLElement | null>(null);
const sessionPopupStyle = ref<Record<string, string>>({});
let sessionTrigger: HTMLElement | null = null;
function positionSessionMenu() {
  const popup = sessionPopup.value;
  if (!sessionTrigger?.isConnected || !popup) return;
  const rect = sessionTrigger.getBoundingClientRect();
  const margin = 8, gap = 4;
  const width = popup.getBoundingClientRect().width || Math.min(160, window.innerWidth - 16);
  const height = popup.getBoundingClientRect().height || popup.scrollHeight;
  const below = window.innerHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  const openAbove = height > below && above > below;
  const available = Math.max(0, openAbove ? above : below);
  sessionPopupStyle.value = {
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
    top: `${Math.max(margin, openAbove ? rect.top - gap - Math.min(height, available) : rect.bottom + gap)}px`,
    maxHeight: `${available}px`,
  };
}
function onSessionScroll(event: Event) {
  // Scrolling the menu itself must not dismiss it; scrolling its anchor's area does.
  if (!sessionPopup.value?.contains(event.target as Node)) closeSessionMenu(false);
}
function closeSessionMenu(restoreFocus: boolean | KeyboardEvent = true) {
  sessionPopup.value?.hidePopover?.();
  if (restoreFocus !== false && sessionMenu.value) sessionTrigger?.focus();
  sessionMenu.value = null;
  document.removeEventListener('pointerdown', onSessionPointer);
  window.removeEventListener('resize', positionSessionMenu);
  document.removeEventListener('scroll', onSessionScroll, true);
  sessionTrigger = null;
}
function onSessionPointer(event: PointerEvent) {
  if (!sessionPopup.value?.contains(event.target as Node) && !sessionTrigger?.contains(event.target as Node)) closeSessionMenu(false);
}
async function toggleSessionMenu(id: string, event: MouseEvent) {
  if (sessionMenu.value === id) { closeSessionMenu(); return; }
  closeSessionMenu();
  sessionTrigger = event.currentTarget as HTMLElement;
  sessionPopupStyle.value = { visibility: 'hidden' };
  sessionMenu.value = id;
  await nextTick();
  sessionPopup.value?.showPopover?.();
  positionSessionMenu();
  document.addEventListener('pointerdown', onSessionPointer);
  window.addEventListener('resize', positionSessionMenu);
  document.addEventListener('scroll', onSessionScroll, true);
}
function beginRename(session: AgentHostSession) {
  closeSessionMenu();
  editingSession.value = session.id;
  draftTitle.value = session.title;
  void nextTick(() => {
    renameDialog.value?.showModal?.();
    const input = renameDialog.value?.querySelector<HTMLInputElement>('input');
    input?.focus(); input?.select();
  });
}
function saveRename(id: string) {
  const title = draftTitle.value.trim();
  if (!title) return;
  emit('renameSession', id, title);
  cancelRename();
}
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

const currentAgent = computed(() => props.agents.find((agent) => agent.id === props.agentId) ?? null);
/** The switch's accessible name: what it switches, and the agent it currently shows. */
const switchLabel = computed(() => `${props.labels.agent}: ${currentAgent.value?.name ?? "—"}`);
/** More than one agent means the head is a switcher; one agent leaves the application's name there. */
const hasPicker = computed(() => props.agentPicker || props.agents.length > 1);

function onDocumentPointer(event: PointerEvent) {
  if (agentMenu.value && !agentMenu.value.contains(event.target as Node)) closeAgentMenu();
}
function positionAgentMenu() {
  const trigger = agentMenu.value?.getBoundingClientRect();
  if (!trigger) return;
  const width = Math.min(320, window.innerWidth - 32);
  const top = trigger.bottom + 4;
  popupStyle.value = {
    left: `${Math.max(16, Math.min(trigger.left, window.innerWidth - width - 16))}px`,
    top: `${top}px`, width: `${width}px`,
    maxHeight: `${Math.max(80, window.innerHeight - top - 16)}px`,
  };
}
async function openAgentMenu() {
  agentMenuOpen.value = true;
  positionAgentMenu();
  await nextTick();
  if (!agentMenuOpen.value) return;
  agentPopup.value?.showPopover?.();
  document.addEventListener("pointerdown", onDocumentPointer);
  window.addEventListener("resize", positionAgentMenu);
  document.addEventListener("scroll", positionAgentMenu, true);
}
function closeAgentMenu() {
  agentPopup.value?.hidePopover?.();
  agentMenuOpen.value = false;
  document.removeEventListener("pointerdown", onDocumentPointer);
  window.removeEventListener("resize", positionAgentMenu);
  document.removeEventListener("scroll", positionAgentMenu, true);
}
function chooseAgent(id: string) {
  closeAgentMenu();
  if (id !== props.agentId) emit("selectAgent", id);
}

function requestDelete(id: string) {
  if (confirmingDelete.value === id) {
    confirmingDelete.value = null;
    emit("deleteSession", id);
    closeSessionMenu();
    return;
  }
  confirmingDelete.value = id;
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => (confirmingDelete.value = null), 3000);
}

onBeforeUnmount(() => {
  closeAgentMenu();
  closeSessionMenu();
  if (confirmTimer) clearTimeout(confirmTimer);
});
</script>

<template>
  <div ref="navRoot" class="shell-nav-body">
    <!-- The head: the agent this conversation runs on, or the application's name. -->
    <div v-if="hasPicker" ref="agentMenu" class="agent-switch">
      <button
        type="button"
        class="switch-trigger"
        aria-haspopup="listbox"
        :aria-expanded="agentMenuOpen"
        :aria-label="switchLabel"
        :disabled="agents.length === 0"
        @click="agentMenuOpen ? closeAgentMenu() : openAgentMenu()"
        @keydown.escape="closeAgentMenu"
      >
        <span class="switch-name">{{ currentAgent?.name ?? labels.agent }}</span>
        <ChevronDown :size="16" class="switch-chevron" :class="{ open: agentMenuOpen }" aria-hidden="true" />
      </button>
      <ul v-if="agentMenuOpen" ref="agentPopup" popover="manual" :style="popupStyle" class="agent-menu" role="listbox" :aria-label="labels.agent" @keydown.escape="closeAgentMenu">
        <li v-for="agent in agents" :key="agent.id" role="option" :aria-selected="agent.id === agentId">
          <button type="button" class="agent-option" :class="{ current: agent.id === agentId }" @click="chooseAgent(agent.id)">
            <span class="option-text">
              <span class="option-name">{{ agent.name }}</span>
              <span v-if="agent.description" class="option-description">{{ agent.description }}</span>
            </span>
            <Check v-if="agent.id === agentId" :size="16" class="option-check" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
    <div v-else class="column-head">{{ title }}</div>

    <button
      type="button"
      class="nav-item primary"
      :class="{ active: featureId === null && sessionId === null }"
      @click="emit('newConversation')"
    >
      <SquarePen :size="16" aria-hidden="true" />
      <span class="nav-label">{{ labels.newConversation }}</span>
    </button>

    <template v-for="feature in workbench.features" :key="feature.id">
      <a v-if="feature.availability === 'link'" class="nav-item" :href="feature.href" target="_blank" rel="noopener">
        <component :is="featureIcon(feature.icon)" :size="16" aria-hidden="true" />
        <span class="nav-label">{{ feature.label }}</span>
        <ExternalLink
          class="external-mark"
          :size="13"
          :role="labels.opensInNewTab ? 'img' : undefined"
          :aria-label="labels.opensInNewTab"
          :aria-hidden="labels.opensInNewTab ? undefined : 'true'"
        />
      </a>
      <div
        v-else-if="feature.availability === 'unavailable'"
        class="nav-item unavailable"
        aria-disabled="true"
        :title="feature.hint || labels.unavailable"
      >
        <component :is="featureIcon(feature.icon)" :size="16" aria-hidden="true" />
        <span class="nav-label">{{ feature.label }}</span>
        <span class="badge">{{ feature.hint || labels.unavailable }}</span>
      </div>
      <button
        v-else
        type="button"
        class="nav-item"
        :class="{ active: featureId === feature.id }"
        :aria-current="featureId === feature.id ? 'page' : undefined"
        @click="feature.availability === 'action' ? emit('featureAction', feature.id) : emit('selectFeature', feature.id)"
      >
        <component :is="featureIcon(feature.icon)" :size="16" aria-hidden="true" />
        <span class="nav-label">{{ feature.label }}</span>
      </button>
    </template>

    <div class="sessions">
      <div class="section-title">{{ labels.sessions }}</div>
      <div v-if="sessionsState === 'loading' && sessions.length === 0" class="session-skeleton" aria-busy="true">
        <span /><span /><span />
      </div>
      <div v-else-if="sessionsState === 'error'" class="session-note">
        {{ labels.loadFailed }}
        <button type="button" class="link" @click="emit('retry')">{{ labels.retry }}</button>
      </div>
      <div v-else-if="sessions.length === 0" class="session-note">{{ labels.noSessions }}</div>
      <ul v-else class="session-list">
        <li v-for="session in sessions" :key="session.id">
          <div class="session-item" :class="{ active: session.id === sessionId && featureId === null }">
            <button
              type="button"
              class="session-open"
              :aria-current="session.id === sessionId ? 'page' : undefined"
              @click="emit('selectSession', session.id)"
            >
              <span v-if="session.latestRun?.status === 'running'" class="running" aria-hidden="true" />
              <span class="session-title">{{ session.title || labels.newConversation }}</span>
              <span
                v-if="session.origin === 'scheduled'"
                class="session-origin"
                role="img"
                :title="labels.scheduledSession"
                :aria-label="labels.scheduledSession"
              >
                <CalendarClock :size="13" aria-hidden="true" />
              </span>
            </button>
            <button v-if="editingSession !== session.id" type="button" class="session-more" :aria-label="labels.sessionActions || labels.more" aria-haspopup="menu" :aria-expanded="sessionMenu === session.id" @click="toggleSessionMenu(session.id, $event)" @keydown.escape="closeSessionMenu"><MoreHorizontal :size="16" /></button>
            <div v-if="sessionMenu === session.id" :ref="(element) => { sessionPopup = element as HTMLElement }" popover="manual" :style="sessionPopupStyle" class="session-menu" @keydown.escape="closeSessionMenu">
              <button type="button" @click="beginRename(session)"><Pencil :size="14" />{{ labels.renameSession || 'Rename conversation' }}</button>
            <button
              type="button"
              class="session-delete"
              :class="{ confirming: confirmingDelete === session.id }"
              :aria-label="confirmingDelete === session.id ? labels.deleteConfirm : labels.deleteSession"
              @click="requestDelete(session.id)"
            >
              <span v-if="confirmingDelete === session.id">{{ labels.deleteConfirm }}</span>
              <template v-else><Trash2 :size="14" />{{ labels.deleteSession }}</template>
            </button>
            </div>
          </div>
        </li>
        <li v-if="hasMore">
          <button type="button" class="more" :disabled="sessionsState === 'loading'" @click="emit('loadMore')">
            {{ labels.more }}
          </button>
        </li>
      </ul>
    </div>

    <dialog v-if="editingSession" ref="renameDialog" class="rename-dialog" :aria-label="labels.renameSession || 'Rename conversation'" @cancel.prevent="cancelRename">
      <form class="rename-form" @submit.prevent="saveRename(editingSession!)">
        <header><h2>{{ labels.renameSession || 'Rename conversation' }}</h2><button type="button" class="dialog-close" :aria-label="labels.close" @click="cancelRename"><X :size="18" /></button></header>
        <div class="rename-body"><input v-model="draftTitle" required maxlength="200" :aria-label="labels.renameSession || 'Rename conversation'" /></div>
        <footer><button type="button" class="dialog-action" @click="cancelRename">{{ labels.cancel }}</button><button type="submit" class="dialog-action is-primary" :disabled="!draftTitle.trim()">{{ labels.submit }}</button></footer>
      </form>
    </dialog>
    <div v-if="bottom" class="nav-foot">
      <button type="button" class="nav-item" @click="emit('openBottom')">
        <component :is="featureIcon(bottom.icon)" :size="16" aria-hidden="true" />
        <span class="nav-label">{{ bottom.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/*
 * 32px navigation rows (DESIGN.md "Navigation row"), the application's name or the agent switch at the top, and the
 * application's own entry at the foot behind a hairline. The current row takes the selected background of the band it
 * sits on, which the application provides.
 */
.shell-nav-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 2px;
}
.column-head {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 10px;
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.agent-switch {
  position: relative;
  min-height: 36px;
}
.switch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  cursor: pointer;
}
.switch-trigger:hover {
  background: var(--shell-panel-hover);
}
.switch-trigger:disabled {
  cursor: default;
}
.switch-trigger:disabled:hover {
  background: transparent;
}
.switch-name {
  flex: 1;
  min-width: 0;
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switch-chevron {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast);
}
.switch-chevron.open {
  transform: rotate(180deg);
}
.agent-menu {
  position: fixed;
  margin: 0;
  padding: var(--spacing-xs);
  overflow-y: auto;
  box-sizing: border-box;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.agent-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.agent-option:hover {
  background: var(--shell-panel-hover);
}
.agent-option.current {
  background: var(--shell-panel-selected);
  font-weight: var(--font-semibold);
}
.agent-option.current:hover {
  background: var(--shell-panel-selected-hover);
}
.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.option-name {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.option-description {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.option-check {
  flex-shrink: 0;
  color: var(--el-color-primary);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.nav-item svg {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.nav-item:hover:not(.unavailable) {
  background: var(--shell-panel-hover);
  color: var(--el-text-color-primary);
}
.nav-item.active {
  background: var(--shell-panel-selected);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.nav-item.active svg,
.nav-item.primary svg {
  color: var(--brand-link);
}
.nav-item.active:hover { background: var(--shell-panel-selected-hover); }
.nav-item.unavailable {
  cursor: default;
  color: var(--el-text-color-tertiary);
}
.nav-item.unavailable svg {
  color: var(--el-text-color-tertiary);
}
.external-mark {
  flex-shrink: 0;
}
.nav-item svg.external-mark {
  color: var(--el-text-color-tertiary);
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: var(--font-medium);
}
.nav-item:focus-visible,
.switch-trigger:focus-visible,
.agent-option:focus-visible,
.session-open:focus-visible,
.session-delete:focus-visible,
.more:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.sessions {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.section-title {
  padding: 14px 10px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
  overflow-y: auto;
  min-height: 0;
}
.session-item {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: background-color var(--transition-fast);
}
.session-more { flex: 0 0 28px; height: 28px; border: 0; border-radius: var(--radius-sm); color: var(--el-text-color-secondary); background: transparent; cursor: pointer; display: grid; place-items: center; }
.session-more:hover { background: var(--el-fill-color-light); }
.session-more { opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); }
.session-item:hover .session-more,
.session-item:focus-within .session-more,
.session-more[aria-expanded="true"] { opacity: 1; pointer-events: auto; }
@media (hover: none) { .session-more { opacity: 1; pointer-events: auto; } }
.session-menu { position: fixed; margin: 0; box-sizing: border-box; width: min(160px, calc(100vw - 16px)); overflow-y: auto; overflow-x: hidden; padding: 4px; border: 0; color: var(--el-text-color-regular); background: var(--el-bg-color-overlay); box-shadow: var(--elevation-overlay); border-radius: var(--radius-md); }
.session-menu > button { min-width: 0; box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; }
.session-menu > button > svg { flex-shrink: 0; }
.session-menu > .session-delete { margin: 0; }
.session-menu > button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); text-align: start; color: var(--el-text-color-regular); background: transparent; cursor: pointer; }
.session-menu > button:hover { background: var(--el-fill-color-light); }
.session-menu > .session-delete { opacity: 1; color: var(--el-color-danger); }
.session-rename { display: flex; align-items: center; gap: 4px; width: 100%; padding: 4px; box-sizing: border-box; }
.session-rename input { width: 100%; min-width: 0; height: 28px; box-sizing: border-box; border: 1px solid var(--el-color-primary); border-radius: var(--radius-sm); background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; }
.session-rename button { flex: 0 0 24px; display: grid; place-items: center; border: 0; background: transparent; color: var(--el-text-color-secondary); }
.rename-dialog { position: fixed; inset: 0; box-sizing: border-box; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; overflow: auto; border: 1px solid var(--el-border-color-light); border-radius: var(--radius-lg); background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); box-shadow: var(--elevation-modal); }
.rename-dialog::backdrop { background: var(--el-overlay-color-lighter); }
.rename-form header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--el-border-color-lighter); }
.rename-form h2 { margin: 0; font-size: var(--text-title); line-height: var(--leading-title); font-weight: var(--font-semibold); }
.rename-body { padding: 20px; }
.rename-body input { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; padding: 4px 12px; border: 1px solid var(--el-border-color-dark); border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); color: var(--el-text-color-primary); background: var(--el-bg-color); }
.rename-body input:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.rename-form footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--el-border-color-lighter); }
.session-item:hover {
  background: var(--shell-panel-hover);
}
.session-item.active {
  background: var(--shell-panel-selected);
}
.session-item.active:hover { background: var(--shell-panel-selected-hover); }
.session-open {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: var(--nav-row-height);
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.session-item.active .session-open {
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-origin {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: auto;
  color: var(--el-text-color-tertiary);
}
.running {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  animation: breathe 1.6s ease-in-out infinite;
}
.session-delete {
  display: grid;
  place-items: center;
  height: var(--control-height-sm);
  min-width: var(--control-height-sm);
  margin-right: 4px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-tertiary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  opacity: 0;
}
.session-item:hover .session-delete,
.session-delete:focus-visible,
.session-delete.confirming {
  opacity: 1;
}
.session-delete:hover,
.session-delete.confirming {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.session-delete.confirming {
  font-weight: var(--font-semibold);
}
.session-note {
  padding: 6px 10px;
  color: var(--el-text-color-secondary);
}
.link {
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.session-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 10px;
}
.session-skeleton span {
  height: 12px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
}
.session-skeleton span:nth-child(2) {
  width: 70%;
}
.session-skeleton span:nth-child(3) {
  width: 85%;
}
.more {
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.more:hover {
  background: var(--shell-panel-hover);
}
/* The application's own entry, behind the one divider inside the column. */
.nav-foot {
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color);
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .running {
    animation: none;
  }
}
</style>
