<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-vue-next";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";
import { useTheme } from "../../../composables/useTheme";
import { renderAgentMarkdown } from "../../../utils/agent-markdown";
import type {
  AssistantAgentDefinition,
  AssistantAgentInput,
} from "@ontomato/contracts/assistant-chat";
import type { McpServiceOption } from "@ontomato/contracts/agent-runtime-mcp";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { agentDefinitionsApi, type ObjectClassOption, type ObjectRelationOption } from "../api";
import { avatarIcon, lightAvatarColorOptions, themedAvatarColor } from "../avatar";
import AgentBasicInfoFields from "./AgentBasicInfoFields.vue";
import DataScopeGraph from "./DataScopeGraph.vue";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";
import SkillSelector from "./SkillSelector.vue";

/**
 * Edits one agent definition as one long page, in the order the work is done: basics, data scope, capabilities (skills
 * and external tools), model and instructions. A null agent is a new one. The section titles double as in-page anchors.
 */
const props = defineProps<{
  agent: AssistantAgentDefinition | null;
  classes: ObjectClassOption[];
  relations: ObjectRelationOption[];
  outlineLoading: boolean;
  /** The domain's models; null until read (or when reading failed). */
  modelOptions: ModelOptions | null;
  modelOptionsFailed: boolean;
}>();
const emit = defineEmits<{
  saved: [agent: AssistantAgentDefinition];
  deleted: [id: string];
  reloadModelOptions: [];
}>();
const { t } = useI18n();
const { isDark } = useTheme();

interface Form {
  name: string;
  description: string;
  avatarKey: string;
  avatarColor: string;
  enabled: boolean;
  systemPrompt: string;
  /** The agent's own model; null follows the domain default. */
  modelId: string | null;
  skills: RuntimeSkillRef[];
  classNames: string[];
  mcpServiceIds: string[];
}

function toForm(agent: AssistantAgentDefinition | null): Form {
  let avatar = { key: "Brain", color: lightAvatarColorOptions[0]! };
  try {
    if (agent?.icon) avatar = { ...avatar, ...JSON.parse(agent.icon) };
  } catch {
    // A malformed stored avatar falls back to the default.
  }
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    avatarKey: avatar.key,
    avatarColor: themedAvatarColor(avatar.color, isDark.value),
    enabled: agent?.enabled ?? true,
    systemPrompt: agent?.systemPrompt ?? "",
    modelId: agent?.modelSelection.modelId ?? null,
    skills: [...(agent?.skills ?? [])],
    classNames: [...(agent?.classNames ?? [])],
    mcpServiceIds: [...(agent?.enabledMcpServiceIds ?? [])],
  };
}

const form = ref<Form>(toForm(props.agent));
const baseline = ref(JSON.stringify(form.value));
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
const saving = ref(false);
const skillsReady = ref(false);
const promptPreview = ref(false);
const mcpOptions = ref<McpServiceOption[]>([]);
const mcpLoading = ref(false);
const mcpFailed = ref(false);

const sections = computed(() => [
  { id: "basics", label: t("agents.basic") },
  { id: "data", label: t("agents.data") },
  { id: "capabilities", label: t("agents.capabilities") },
  { id: "model", label: t("agents.model") },
  { id: "prompt", label: t("agents.prompt") },
]);

const bodyRef = ref<HTMLElement | null>(null);

/** Section titles are in-page anchors: the editor is one page, so jumping to a part does not reload anything. */
function jumpTo(id: string) {
  const target = bodyRef.value?.querySelector<HTMLElement>(`[data-section="${id}"]`);
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

watch(isDark, (dark) => {
  form.value.avatarColor = themedAvatarColor(form.value.avatarColor, dark);
});

async function loadMcp() {
  mcpLoading.value = true;
  mcpFailed.value = false;
  try {
    mcpOptions.value = await agentDefinitionsApi.listMcpServiceOptions();
  } catch {
    mcpFailed.value = true;
  } finally {
    mcpLoading.value = false;
  }
}
onMounted(loadMcp);

function validInput(): AssistantAgentInput | null {
  const value = form.value;
  if (!value.name.trim()) {
    ElMessage.warning(t("analysis.agentNameRequired"));
    return null;
  }
  return {
    name: value.name.trim(),
    description: value.description,
    icon: JSON.stringify({ key: value.avatarKey, color: value.avatarColor }),
    enabled: value.enabled,
    systemPrompt: value.systemPrompt,
    modelSelection: { modelId: value.modelId },
    skills: value.skills,
    classNames: value.classNames,
    enabledMcpServiceIds: value.mcpServiceIds,
    sortOrder: props.agent?.sortOrder ?? 0,
  };
}

async function save() {
  const input = validInput();
  if (!input || saving.value || !skillsReady.value) return;
  saving.value = true;
  try {
    const saved = props.agent
      ? await agentDefinitionsApi.update(props.agent.id, input)
      : await agentDefinitionsApi.create(input);
    baseline.value = JSON.stringify(form.value);
    ElMessage.success(props.agent ? t("analysis.agentUpdated") : t("analysis.agentCreated"));
    emit("saved", saved);
  } catch (error) {
    ElMessage.error(
      error instanceof Error && error.message
        ? error.message
        : t(props.agent ? "analysis.updateFailed" : "analysis.createFailed"),
    );
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const agent = props.agent;
  if (!agent) return;
  try {
    await ElMessageBox.confirm(t("agents.deleteConfirm", { name: agent.name }), t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  try {
    await agentDefinitionsApi.remove(agent.id);
    ElMessage.success(t("common.deleted"));
    emit("deleted", agent.id);
  } catch (error) {
    ElMessage.error(error instanceof Error && error.message ? error.message : t("analysis.deleteFailed"));
  }
}

defineExpose({ dirty });
</script>

<template>
  <div class="agent-editor">
    <header class="editor-bar">
      <span class="editor-avatar" :style="{ background: form.avatarColor }">
        <component :is="avatarIcon(form.avatarKey)" :size="18" />
      </span>
      <div class="editor-title">
        <strong>{{ form.name.trim() || (agent ? agent.name : t("agents.newAgent")) }}</strong>
        <small :class="{ dirty }">{{ dirty ? t("admin.agentEditorUnsaved") : t("admin.agentEditorSaved") }}</small>
      </div>
      <nav class="section-anchors" :aria-label="t('agents.sections')">
        <button v-for="section in sections" :key="section.id" type="button" @click="jumpTo(section.id)">
          {{ section.label }}
        </button>
      </nav>
      <el-button v-if="agent" text :icon="Trash2" :disabled="saving" @click="remove">{{ t("common.delete") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!skillsReady || (!dirty && !!agent)" @click="save">{{ t("common.save") }}</el-button>
    </header>

    <div ref="bodyRef" class="editor-body">
      <el-form label-position="top" :disabled="saving" @submit.prevent>
        <section class="editor-section" data-section="basics">
          <h3>{{ t("agents.basic") }}</h3>
          <AgentBasicInfoFields
            v-model:name="form.name"
            v-model:description="form.description"
            v-model:avatar-key="form.avatarKey"
            v-model:avatar-color="form.avatarColor"
          />
          <div class="setting-row">
            <div>
              <strong>{{ t("common.enable") }}</strong>
              <p>{{ t("admin.agentEditorEnabledHint") }}</p>
            </div>
            <el-switch v-model="form.enabled" :aria-label="t('common.enable')" />
          </div>
        </section>

        <section class="editor-section" data-section="data">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.data") }}</h3>
              <p>{{ t("agents.dataHint") }}</p>
            </div>
          </div>
          <DataScopeGraph
            v-model="form.classNames"
            :classes="classes"
            :relations="relations"
            :loading="outlineLoading"
          />
        </section>

        <section class="editor-section" data-section="capabilities">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.capabilities") }}</h3>
              <p>{{ t("agents.capabilitiesHint") }}</p>
            </div>
            <div class="section-actions">
              <el-button size="small" tag="a" href="#/agents/settings?tab=capabilities" :icon="ExternalLink">
                {{ t("agents.capabilityLibrary") }}
              </el-button>
            </div>
          </div>

          <h4 class="group-title">{{ t("agents.skills") }}</h4>
          <p class="group-hint">{{ t("agents.skillsHint") }}</p>
          <SkillSelector v-model="form.skills" @ready="skillsReady = $event" />

          <div class="section-head tool-head">
            <div>
              <h4 class="group-title">{{ t("admin.externalMcpServices") }}</h4>
              <p class="group-hint">{{ t("admin.externalMcpServicesHint") }}</p>
            </div>
            <el-button size="small" :loading="mcpLoading" :icon="RefreshCw" @click="loadMcp">{{ t("common.refresh") }}</el-button>
          </div>
          <el-select
            v-model="form.mcpServiceIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            :loading="mcpLoading"
            :disabled="mcpLoading || mcpFailed"
            :aria-label="t('admin.externalMcpServices')"
            :placeholder="t('admin.externalMcpServicesPlaceholder')"
            class="full"
          >
            <el-option v-for="service in mcpOptions" :key="service.id" :label="service.name" :value="service.id" />
            <el-option
              v-for="id in form.mcpServiceIds.filter((selected) => !mcpOptions.some((service) => service.id === selected))"
              :key="id"
              :label="t('assistant.unavailable')"
              :value="id"
              disabled
            />
          </el-select>
          <el-alert v-if="mcpFailed" class="mcp-alert" type="warning" :closable="false" :title="t('admin.externalMcpServicesLoadFailed')" />
        </section>

        <section class="editor-section" data-section="model">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.model") }}</h3>
              <p>{{ t("agents.modelHint") }}</p>
            </div>
          </div>
          <ModelSelectionSelect v-model="form.modelId" :options="modelOptions" :aria-label="t('agents.model')" />
          <div v-if="modelOptionsFailed" class="model-options-failed" role="alert">
            <span>{{ t("agents.modelOptionsLoadFailed") }}</span>
            <el-button size="small" link type="primary" @click="emit('reloadModelOptions')">{{ t("common.retry") }}</el-button>
          </div>
        </section>

        <section class="editor-section" data-section="prompt">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.prompt") }}</h3>
              <p>{{ t("agents.promptHint") }}</p>
            </div>
            <el-radio-group v-model="promptPreview" size="small">
              <el-radio-button :value="false">{{ t("common.edit") }}</el-radio-button>
              <el-radio-button :value="true">{{ t("admin.agentEditorPreview") }}</el-radio-button>
            </el-radio-group>
          </div>
          <div v-if="promptPreview" class="prompt-preview markdown-body" v-html="renderAgentMarkdown(form.systemPrompt)" />
          <CodeMirrorEditor v-else v-model="form.systemPrompt" language="markdown" :min-height="320" />
          <small class="prompt-count">{{ t("admin.agentEditorCharacters", { count: form.systemPrompt.length }) }} · Markdown</small>
        </section>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.agent-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.editor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.editor-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  color: var(--el-color-primary);
}
.editor-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.editor-title strong {
  font-size: var(--text-base);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-title small {
  font-size: var(--text-xs);
  color: var(--el-text-color-tertiary);
}
.editor-title small.dirty {
  color: var(--el-color-warning);
}
.section-anchors {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  background: var(--el-fill-color);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}
.section-anchors button {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
  white-space: nowrap;
  cursor: pointer;
}
.section-anchors button:hover {
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
}
.section-anchors button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 24px 40px;
}
.editor-body :deep(.el-form) {
  max-width: 820px;
  margin: 0 auto;
}
.editor-section {
  padding: 22px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  scroll-margin-top: 12px;
}
.editor-section:last-child {
  border-bottom: 0;
}
.editor-section h3 {
  margin: 0 0 14px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.section-head h3 {
  margin-bottom: 4px;
}
.section-head p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.section-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.section-actions :deep(.el-button) {
  margin: 0;
  text-decoration: none;
}
.group-title {
  margin: 0 0 4px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.group-hint {
  margin: 0 0 10px;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.tool-head {
  margin-top: 20px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--el-fill-color-light);
}
.setting-row strong {
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
}
.setting-row p {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.prompt-preview {
  min-height: 320px;
  padding: 14px 18px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: auto;
}
.prompt-count {
  display: block;
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--el-text-color-tertiary);
}
.full {
  width: 100%;
}
.mcp-alert {
  margin-top: 10px;
}
.model-options-failed {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: var(--text-sm);
  color: var(--el-color-warning);
}
</style>
