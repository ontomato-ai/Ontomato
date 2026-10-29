<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { Check, ChevronDown, SquarePen, Trash2 } from "lucide-vue-next";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { ShellWorkbenchDeclaration } from "../types";
import { shellContextKey } from "../context";
import { featureIcon } from "../icons";

const props = defineProps<{
  workbench: ShellWorkbenchDeclaration;
  agents: AgentHostAgent[];
  agentId: string | null;
  sessions: AgentHostSession[];
  sessionsState: "loading" | "ready" | "error";
  hasMore: boolean;
  sessionId: string | null;
  featureId: string | null;
}>();
const emit = defineEmits<{
  newConversation: [];
  selectFeature: [id: string];
  featureAction: [id: string];
  selectAgent: [id: string];
  selectSession: [id: string];
  deleteSession: [id: string];
  loadMore: [];
  retry: [];
}>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);

const agentMenuOpen = ref(false);
const agentMenu = ref<HTMLElement | null>(null);
const confirmingDelete = ref<string | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

const currentAgent = computed(() => props.agents.find((agent) => agent.id === props.agentId) ?? null);

function onDocumentPointer(event: PointerEvent) {
  if (agentMenu.value && !agentMenu.value.contains(event.target as Node)) closeAgentMenu();
}
function openAgentMenu() {
  agentMenuOpen.value = true;
  document.addEventListener("pointerdown", onDocumentPointer);
}
function closeAgentMenu() {
  agentMenuOpen.value = false;
  document.removeEventListener("pointerdown", onDocumentPointer);
}
function chooseAgent(id: string) {
  closeAgentMenu();
  if (id !== props.agentId) emit("selectAgent", id);
}

function requestDelete(id: string) {
  if (confirmingDelete.value === id) {
    confirmingDelete.value = null;
    emit("deleteSession", id);
    return;
  }
  confirmingDelete.value = id;
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => (confirmingDelete.value = null), 3000);
}

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointer);
  if (confirmTimer) clearTimeout(confirmTimer);
});
</script>

<template>
  <nav class="shell-sidebar" :aria-label="workbench.label">
    <div class="brand">
      <slot name="brand">
        <span class="brand-name">{{ workbench.label }}</span>
      </slot>
    </div>

    <div class="features">
      <button
        type="button"
        class="nav-item primary"
        :class="{ active: featureId === null && sessionId === null }"
        @click="emit('newConversation')"
      >
        <SquarePen :size="17" />
        <span class="nav-label">{{ labels.newConversation }}</span>
      </button>
      <template v-for="feature in workbench.features" :key="feature.id">
        <a
          v-if="feature.availability === 'link'"
          class="nav-item"
          :href="feature.href"
          target="_blank"
          rel="noopener"
        >
          <component :is="featureIcon(feature.icon)" :size="17" />
          <span class="nav-label">{{ feature.label }}</span>
        </a>
        <div
          v-else-if="feature.availability === 'unavailable'"
          class="nav-item unavailable"
          aria-disabled="true"
          :title="feature.hint || labels.unavailable"
        >
          <component :is="featureIcon(feature.icon)" :size="17" />
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
          <component :is="featureIcon(feature.icon)" :size="17" />
          <span class="nav-label">{{ feature.label }}</span>
        </button>
      </template>
    </div>

    <div ref="agentMenu" class="agent-picker">
      <button
        type="button"
        class="agent-trigger"
        aria-haspopup="listbox"
        :aria-expanded="agentMenuOpen"
        :aria-label="labels.agent"
        @click="agentMenuOpen ? closeAgentMenu() : openAgentMenu()"
        @keydown.escape="closeAgentMenu"
      >
        <span class="agent-caption">{{ labels.agent }}</span>
        <span class="agent-name">{{ currentAgent?.name ?? "—" }}</span>
        <ChevronDown :size="15" class="agent-chevron" :class="{ open: agentMenuOpen }" />
      </button>
      <ul v-if="agentMenuOpen" class="agent-menu" role="listbox" @keydown.escape="closeAgentMenu">
        <li v-for="agent in agents" :key="agent.id" role="option" :aria-selected="agent.id === agentId">
          <button type="button" class="agent-option" @click="chooseAgent(agent.id)">
            <span class="option-text">
              <span class="option-name">{{ agent.name }}</span>
              <span v-if="agent.description" class="option-description">{{ agent.description }}</span>
            </span>
            <Check v-if="agent.id === agentId" :size="15" class="option-check" />
          </button>
        </li>
      </ul>
    </div>

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
            </button>
            <button
              type="button"
              class="session-delete"
              :class="{ confirming: confirmingDelete === session.id }"
              :title="confirmingDelete === session.id ? labels.deleteConfirm : labels.deleteSession"
              :aria-label="confirmingDelete === session.id ? labels.deleteConfirm : labels.deleteSession"
              @click="requestDelete(session.id)"
            >
              <span v-if="confirmingDelete === session.id">{{ labels.deleteConfirm }}</span>
              <Trash2 v-else :size="14" />
            </button>
          </div>
        </li>
        <li v-if="hasMore">
          <button type="button" class="more" :disabled="sessionsState === 'loading'" @click="emit('loadMore')">
            {{ labels.more }}
          </button>
        </li>
      </ul>
    </div>

    <div class="footer">
      <slot name="footer" />
    </div>
  </nav>
</template>

<style scoped>
.shell-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 14px 10px 10px;
  box-sizing: border-box;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm, 13px);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 8px 12px;
}
.brand-name {
  font-size: var(--text-lg, 17px);
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.features {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
.nav-item svg {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.nav-item:hover:not(.unavailable) {
  background: var(--el-fill-color);
}
.nav-item.active {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
}
.nav-item.active svg,
.nav-item.primary svg {
  color: var(--el-color-primary);
}
.nav-item.unavailable {
  cursor: default;
  color: var(--el-text-color-tertiary);
}
.nav-item.unavailable svg {
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
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
  font-weight: 500;
}
.nav-item:focus-visible,
.agent-trigger:focus-visible,
.agent-option:focus-visible,
.session-open:focus-visible,
.session-delete:focus-visible,
.more:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.agent-picker {
  position: relative;
  margin: 14px 0 6px;
}
.agent-trigger {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast, 150ms);
}
.agent-trigger:hover {
  border-color: var(--el-border-color-dark);
}
.agent-caption {
  grid-column: 1;
  font-size: var(--text-xs, 11px);
  color: var(--el-text-color-tertiary);
  letter-spacing: 0.02em;
}
.agent-name {
  grid-column: 1;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-chevron {
  grid-column: 2;
  grid-row: 1 / 3;
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast, 150ms);
}
.agent-chevron.open {
  transform: rotate(180deg);
}
.agent-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--shadow-dropdown, var(--el-shadow-md));
}
.agent-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.agent-option:hover {
  background: var(--el-fill-color);
}
.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.option-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.option-description {
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
.option-check {
  color: var(--el-color-primary);
  flex-shrink: 0;
}
.sessions {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.section-title {
  padding: 10px 10px 6px;
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  color: var(--el-text-color-tertiary);
  letter-spacing: 0.04em;
}
.session-list {
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
  border-radius: 10px;
  transition: background-color var(--transition-fast, 150ms);
}
.session-item:hover {
  background: var(--el-fill-color);
}
.session-item.active {
  background: var(--el-fill-color-dark);
}
.session-open {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.session-item.active .session-open {
  color: var(--el-text-color-primary);
}
.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.running {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: breathe 1.6s ease-in-out infinite;
}
.session-delete {
  display: grid;
  place-items: center;
  height: 28px;
  min-width: 28px;
  margin-right: 3px;
  padding: 0 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-tertiary);
  font: inherit;
  font-size: var(--text-xs, 12px);
  cursor: pointer;
  opacity: 0;
}
.session-item:hover .session-delete,
.session-delete:focus-visible,
.session-delete.confirming {
  opacity: 1;
}
.session-delete:hover {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.session-delete.confirming {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  font-weight: 600;
}
.session-note {
  padding: 6px 10px;
  color: var(--el-text-color-tertiary);
}
.link {
  border: 0;
  background: none;
  color: var(--el-color-primary);
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
  border-radius: 6px;
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
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  cursor: pointer;
}
.more:hover {
  background: var(--el-fill-color);
}
.footer {
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-light);
}
.footer:empty {
  display: none;
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
