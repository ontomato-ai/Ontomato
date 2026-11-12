<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowLeft, Plus } from "lucide-vue-next";
import { useAgentDefinitions } from "../definitions";

/**
 * The agent platform's settings navigation, drawn in the application's column when the settings are open.
 *
 * It replaces the conversation column for as long as the settings are shown: back to the conversation, the agents (one
 * click opens it in the editor beside) and a new agent. Skills and external MCP services are the platform's, managed in
 * the ontology manager and the system settings; an agent only selects them. The main area holds the editor only —
 * the list is here, never a second time beside it (DESIGN.md "Applications and shells").
 */
const props = defineProps<{
  /** The agent being edited, or null while creating one. */
  agentId: string | null;
  creating: boolean;
}>();
const emit = defineEmits<{
  back: [];
  selectAgent: [id: string];
  createAgent: [];
}>();
const { t } = useI18n();
const { agents, loading, loadFailed, ensureLoaded } = useAgentDefinitions();

// The column and the editor share one read: whichever is mounted first starts it and the other reads the same list.
onMounted(() => {
  void ensureLoaded();
});

const heading = computed(() => t("agents.title"));
</script>

<template>
  <div class="settings-nav">
    <button type="button" class="back" @click="emit('back')">
      <ArrowLeft :size="16" aria-hidden="true" />
      <span>{{ t("common.backToChat") }}</span>
    </button>
    <h2 class="nav-head">{{ heading }}</h2>

    <p class="group-title">{{ t("agents.agentsGroup") }}</p>
    <div v-if="loading" class="skeleton" aria-busy="true"><span /><span /></div>
    <div v-else-if="loadFailed" class="note">
      {{ t("agents.loadFailed") }}
      <button type="button" class="link" @click="ensureLoaded()">{{ t("common.retry") }}</button>
    </div>
    <div v-else-if="agents.length === 0" class="note">{{ t("agents.empty") }}</div>
    <ul v-else class="agent-rows">
      <li v-for="agent in agents" :key="agent.id">
        <button
          type="button"
          class="agent-row"
          :class="{ active: !props.creating && agent.id === props.agentId }"
          :aria-current="!props.creating && agent.id === props.agentId ? 'page' : undefined"
          @click="emit('selectAgent', agent.id)"
        >
          <span class="row-name">{{ agent.name }}</span>
          <span v-if="agent.description" class="row-note">{{ agent.description }}</span>
        </button>
      </li>
    </ul>
    <button type="button" class="new-agent" :class="{ active: props.creating }" @click="emit('createAgent')">
      <Plus :size="16" aria-hidden="true" />
      <span>{{ t("agents.newAgent") }}</span>
    </button>

  </div>
</template>

<style scoped>
.settings-nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 2px;
  overflow-y: auto;
}
.back {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--nav-row-height);
  margin-bottom: 6px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.back:hover {
  background: var(--shell-nav-hover, var(--el-fill-color-light));
}
.nav-head {
  margin: 0;
  padding: 0 10px 10px;
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.group-title {
  margin: 0;
  padding: 14px 10px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.agent-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.agent-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row-name {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.row-note {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.agent-row:hover,
.new-agent:hover,
.back:hover {
  background: var(--shell-nav-hover, var(--el-fill-color-light));
}
.agent-row.active,
.new-agent.active {
  background: var(--shell-nav-selected, var(--el-color-primary-light-9));
}
.new-agent {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height);
  margin-top: 6px;
  padding: 0 10px;
  border: 1px dashed var(--el-border-color);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.note {
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
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
}
.skeleton span {
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
}
.skeleton span:last-child {
  width: 70%;
}
.back:focus-visible,
.agent-row:focus-visible,
.new-agent:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
