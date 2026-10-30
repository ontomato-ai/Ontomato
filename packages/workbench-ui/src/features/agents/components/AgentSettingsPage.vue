<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { Plus } from "lucide-vue-next";
import { useTheme } from "../../../composables/useTheme";
import type { AssistantAgentDefinition as AgentDefinition } from "@ontomato/contracts/assistant-chat";
import {
  agentDefinitionsApi,
  loadOntologyOutline,
  type ObjectClassOption,
} from "../api";
import { avatarIcon, lightAvatarColorOptions, themedAvatarColor } from "../avatar";
import AgentEditor from "./AgentEditor.vue";

/** Agent settings of the business workbench: the agents on the left, the selected one's editor on the right. */
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const { isDark } = useTheme();

const agents = ref<AgentDefinition[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
/** null while creating a new agent. */
const selectedId = ref<string | null>(null);
const creating = ref(false);
const editor = ref<{ dirty: boolean } | null>(null);
const classes = ref<ObjectClassOption[]>([]);
const outlineLoading = ref(true);

const selected = computed(() => agents.value.find((agent) => agent.id === selectedId.value) ?? null);
const editorKey = computed(() => (creating.value ? "new" : (selectedId.value ?? "none")));

function avatarOf(agent: AgentDefinition) {
  try {
    const parsed = agent.icon ? JSON.parse(agent.icon) : {};
    return { icon: avatarIcon(parsed.key), color: themedAvatarColor(parsed.color ?? lightAvatarColorOptions[0], isDark.value) };
  } catch {
    return { icon: avatarIcon(""), color: themedAvatarColor(lightAvatarColorOptions[0]!, isDark.value) };
  }
}

async function load() {
  loading.value = true;
  loadFailed.value = false;
  try {
    agents.value = await agentDefinitionsApi.list();
    if (!creating.value && !selected.value) selectedId.value = agents.value[0]?.id ?? null;
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  void load();
  try {
    const outline = await loadOntologyOutline();
    classes.value = outline.classes;
  } finally {
    outlineLoading.value = false;
  }
});

async function leaveEditor(): Promise<boolean> {
  if (!editor.value?.dirty) return true;
  try {
    await ElMessageBox.confirm(t("admin.agentEditorDiscard"), t("admin.agentEditorUnsaved"), {
      type: "warning",
      confirmButtonText: t("admin.agentEditorDiscardAction"),
      cancelButtonText: t("common.cancel"),
    });
    return true;
  } catch {
    return false;
  }
}

async function select(id: string) {
  if (id === selectedId.value && !creating.value) return;
  if (!(await leaveEditor())) return;
  creating.value = false;
  selectedId.value = id;
}

async function startNew() {
  if (creating.value || !(await leaveEditor())) return;
  creating.value = true;
  selectedId.value = null;
}

function saved(agent: AgentDefinition) {
  const index = agents.value.findIndex((known) => known.id === agent.id);
  if (index >= 0) agents.value[index] = agent;
  else agents.value = [...agents.value, agent];
  creating.value = false;
  selectedId.value = agent.id;
  emit("changed");
}

function deleted(id: string) {
  agents.value = agents.value.filter((agent) => agent.id !== id);
  selectedId.value = agents.value[0]?.id ?? null;
  emit("changed");
}
</script>

<template>
  <div class="agent-settings">
    <aside class="agent-list">
      <header class="list-head">
        <div>
          <h2>{{ t("agents.title") }}</h2>
          <p>{{ t("agents.intro") }}</p>
        </div>
      </header>
      <button type="button" class="new-agent" :class="{ active: creating }" @click="startNew">
        <Plus :size="16" />
        <span>{{ t("agents.newAgent") }}</span>
      </button>
      <div v-if="loading" class="list-skeleton" aria-busy="true"><span /><span /><span /></div>
      <div v-else-if="loadFailed" class="list-note">
        {{ t("agents.loadFailed") }}
        <button type="button" class="link" @click="load">{{ t("common.retry") }}</button>
      </div>
      <div v-else-if="agents.length === 0" class="list-note">{{ t("agents.empty") }}</div>
      <ul v-else>
        <li v-for="agent in agents" :key="agent.id">
          <button
            type="button"
            class="agent-item"
            :class="{ active: agent.id === selectedId && !creating }"
            :aria-current="agent.id === selectedId && !creating ? 'page' : undefined"
            @click="select(agent.id)"
          >
            <span class="item-avatar" :style="{ background: avatarOf(agent).color }">
              <component :is="avatarOf(agent).icon" :size="16" />
            </span>
            <span class="item-text">
              <span class="item-name">{{ agent.name }}</span>
              <span v-if="agent.description" class="item-description">{{ agent.description }}</span>
            </span>
            <el-tag v-if="!agent.enabled" size="small" type="info" effect="plain">{{ t("common.disabled") }}</el-tag>
          </button>
        </li>
      </ul>
    </aside>
    <section class="agent-detail">
      <AgentEditor
        v-if="creating || selected"
        ref="editor"
        :key="editorKey"
        :agent="creating ? null : selected"
        :classes="classes"
        :outline-loading="outlineLoading"
        @saved="saved"
        @deleted="deleted"
      />
      <el-empty v-else-if="!loading" :description="t('agents.empty')" />
    </section>
  </div>
</template>

<style scoped>
.agent-settings {
  display: flex;
  height: 100%;
  min-height: 0;
}
.agent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 280px;
  flex-shrink: 0;
  padding: 18px 12px;
  border-right: 1px solid var(--el-border-color-light);
  overflow-y: auto;
}
.list-head {
  padding: 0 8px 10px;
}
.list-head h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.list-head p {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.new-agent,
.agent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.new-agent {
  color: var(--el-color-primary);
  font-weight: 500;
}
.new-agent:hover,
.agent-item:hover {
  background: var(--el-fill-color);
}
.new-agent.active,
.agent-item.active {
  background: var(--el-fill-color-dark);
}
.new-agent:focus-visible,
.agent-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.item-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 9px;
  color: var(--el-color-primary);
}
.item-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.item-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-description {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-note {
  padding: 8px 10px;
  font-size: var(--text-sm);
  color: var(--el-text-color-tertiary);
}
.link {
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
}
.list-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}
.list-skeleton span {
  height: 32px;
  border-radius: 9px;
  background: var(--el-fill-color);
}
.agent-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
@media (max-width: 900px) {
  .agent-settings {
    flex-direction: column;
  }
  .agent-list {
    width: auto;
    max-height: 40%;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-light);
  }
}
</style>
