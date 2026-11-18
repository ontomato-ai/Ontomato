<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowLeft, Cpu, Plus } from "lucide-vue-next";
import { ElButton } from "element-plus";
import { useAgentModelLabels, usePageAccess } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useAgentDefinitions } from "../definitions";

/**
 * The agent platform's settings navigation, drawn in the application's column when the settings are open.
 *
 * It replaces the conversation column for as long as the settings are shown: back to the conversation, the agents (one
 * click opens it in the editor beside), a new agent, and at the foot the models of the ontology service agents the
 * platform's conversations run on, for an account that may open them. Skills and external MCP services are the
 * platform's, managed in the ontology manager and the system settings; an agent only selects them. The main area holds
 * the editor only — the list is here, never a second time beside it (DESIGN.md "Applications and shells").
 */
const props = withDefaults(defineProps<{
  /** The agent being edited, or null while creating one or while the models are open. */
  agentId: string | null;
  creating: boolean;
  /** The models page is open. */
  models: boolean;
  /**
   * The settings are a page of the platform's own navigation (the ontology manager's product layer), so the column has
   * no way back to a conversation and no models entry: those belong to the agent platform's own column.
   */
  standalone?: boolean;
  /**
   * The list names itself at its head. At the page's own address it does; beside a conversation the pane's header already
   * names the page, and a second title right under it says the same thing twice.
   */
  heading?: boolean;
}>(), { standalone: false, heading: true });
const emit = defineEmits<{
  back: [];
  selectAgent: [id: string];
  createAgent: [];
  openModels: [];
}>();
const { t } = useI18n();
const canOpen = usePageAccess();
// The models entry is the agent platform column's own: a settings page that has its own navigation reads no model words.
const modelLabels = props.standalone ? null : useAgentModelLabels();
const { agents, loading, loadFailed, ensureLoaded } = useAgentDefinitions();
/** The agents and a new one are the agents' settings, listed only to an account that may open them. */
const editsAgents = computed(() => canOpen(platformRoutes.agents.path));
const currentAgentId = computed(() => props.creating || props.models
  ? null
  : props.agentId ?? (props.standalone ? agents.value[0]?.id : null));

// The column and the editor share one read: whichever is mounted first starts it and the other reads the same list.
onMounted(() => {
  if (editsAgents.value) void ensureLoaded();
});

/** The page the list belongs to, and whether the list says so: beside a conversation the pane's header already does. */
const pageTitle = computed(() => t("agents.title"));
</script>

<template>
  <nav class="settings-nav" :class="{ 'is-standalone': standalone }" :aria-label="pageTitle">
    <button v-if="!props.standalone" type="button" class="back" @click="emit('back')">
      <ArrowLeft :size="16" aria-hidden="true" />
      <span>{{ t("common.backToChat") }}</span>
    </button>
    <h2 v-if="heading && !standalone" class="nav-head">{{ pageTitle }}</h2>

    <template v-if="editsAgents">
      <div v-if="standalone" class="list-header">
        <h2>{{ heading ? pageTitle : t("agents.agentsGroup") }}</h2>
        <el-button
          :icon="Plus"
          size="small"
          :class="{ 'is-active': creating }"
          :aria-current="creating ? 'page' : undefined"
          @click="emit('createAgent')"
        >{{ t("agents.newAgent") }}</el-button>
      </div>
      <p v-else class="group-title">{{ t("agents.agentsGroup") }}</p>
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
            :class="{ active: agent.id === currentAgentId }"
            :aria-current="agent.id === currentAgentId ? 'page' : undefined"
            @click="emit('selectAgent', agent.id)"
          >
            <span class="row-name">{{ agent.name }}</span>
            <span v-if="agent.description" class="row-note">{{ agent.description }}</span>
          </button>
        </li>
      </ul>
      <button v-if="!standalone" type="button" class="new-agent" :class="{ active: props.creating }" @click="emit('createAgent')">
        <Plus :size="16" aria-hidden="true" />
        <span>{{ t("agents.newAgent") }}</span>
      </button>
    </template>

    <div v-if="modelLabels && canOpen(platformRoutes.agentModels.path)" class="nav-foot">
      <button
        type="button"
        class="foot-row"
        :class="{ active: props.models }"
        :aria-current="props.models ? 'page' : undefined"
        @click="emit('openModels')"
      >
        <Cpu :size="16" aria-hidden="true" />
        <span>{{ modelLabels.title }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/*
 * Its column decides how wide the list is — the settings page gives it the platform's list width — and how much of the
 * column's height it takes; here it only fills what it is given and scrolls its own rows.
 */
.settings-nav {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  gap: 2px;
  overflow-y: auto;
}
.is-standalone {
  --shell-nav-hover: var(--shell-panel-hover, var(--el-fill-color-light));
  --shell-nav-selected: var(--shell-panel-selected, var(--el-color-primary-light-9));
  gap: var(--spacing-sm);
}
.list-header {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs) var(--spacing-sm);
  min-height: var(--panel-header-height);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-light);
  box-sizing: border-box;
}
.list-header h2 {
  margin: 0;
  font-size: var(--text-base);
  line-height: var(--leading-base);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.list-header .el-button.is-active {
  background: var(--shell-nav-selected);
  color: var(--brand-link);
}
.is-standalone .agent-row {
  padding: var(--spacing-sm);
}
.is-standalone .row-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.is-standalone .agent-row.active .row-name {
  color: var(--brand-link);
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
/* The application's own entry stays at the foot of the column, under a hairline. */
.nav-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-light);
}
.foot-row {
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
  cursor: pointer;
}
.foot-row:hover {
  background: var(--shell-nav-hover, var(--el-fill-color-light));
}
.foot-row.active {
  background: var(--shell-nav-selected, var(--el-color-primary-light-9));
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
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
.new-agent:focus-visible,
.foot-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
