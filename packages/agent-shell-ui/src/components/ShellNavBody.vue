<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { CalendarClock, Check, ChevronDown, ExternalLink, SquarePen, Trash2 } from "lucide-vue-next";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { ShellWorkbenchDeclaration } from "../types";
import { shellContextKey } from "../context";
import { featureIcon } from "../icons";

/**
 * The conversation shell's navigation content: new conversation, the function area, the agent picker and the
 * conversation history. It is the body its own sidebar shows, and the platform's application panel shows the same
 * component, so an application's second column and the shell's sidebar cannot drift apart.
 *
 * It owns no brand, no footer and no panel chrome: those belong to whatever puts it on screen.
 */
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
  <div class="shell-nav-body">
    <div class="features">
      <button
        type="button"
        class="nav-item primary"
        :class="{ active: featureId === null && sessionId === null }"
        @click="emit('newConversation')"
      >
        <SquarePen :size="16" />
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
          <component :is="featureIcon(feature.icon)" :size="16" />
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
          <component :is="featureIcon(feature.icon)" :size="16" />
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
          <component :is="featureIcon(feature.icon)" :size="16" />
          <span class="nav-label">{{ feature.label }}</span>
        </button>
      </template>
    </div>

    <div v-if="agents.length > 1" ref="agentMenu" class="agent-picker">
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
  </div>
</template>

<style scoped>
/*
 * 32px navigation rows (DESIGN.md "Navigation row"), `label` group headings and single-line 32px conversation rows.
 * The current row takes the selected background of the band it sits on, which the host provides.
 */
.shell-nav-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.features {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
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
  background: var(--shell-nav-hover, var(--el-fill-color-light));
}
.nav-item.active {
  background: var(--shell-nav-selected, var(--el-color-primary-light-9));
  color: var(--el-text-color-primary);
  font-weight: 600;
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
  margin: 12px 0 4px;
}
.agent-trigger {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.agent-trigger:hover {
  border-color: var(--el-border-color-dark);
}
.agent-caption {
  grid-column: 1;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
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
  transition: transform var(--transition-fast);
}
.agent-chevron.open {
  transform: rotate(180deg);
}
.agent-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.agent-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.agent-option:hover {
  background: var(--el-fill-color-light);
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
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
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
  padding: 8px 8px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
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
.session-item:hover {
  background: var(--shell-nav-hover, var(--el-fill-color-light));
}
.session-item.active {
  background: var(--shell-nav-selected, var(--el-color-primary-light-9));
}
.session-open {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: var(--nav-row-height);
  padding: 0 8px;
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
  font-weight: 600;
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
  padding: 6px 8px;
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
  padding: 8px;
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
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.more:hover {
  background: var(--shell-nav-hover, var(--el-fill-color-light));
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
