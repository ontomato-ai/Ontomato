<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { PlatformTabs } from "@ontomato/platform-shell";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-vue-next";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";
import { renderAgentMarkdown } from "../../../utils/agent-markdown";
import type {
  AssistantAgentDefinition,
  AssistantAgentInput,
} from "@ontomato/contracts/assistant-chat";
import type { McpServiceOption } from "@ontomato/contracts/agent-runtime-mcp";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { agentDefinitionsApi, type ObjectClassOption, type ObjectRelationOption } from "../api";
import AgentBasicInfoFields from "./AgentBasicInfoFields.vue";
import DataScopeGraph from "./DataScopeGraph.vue";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";
import SkillSelector from "./SkillSelector.vue";

/**
 * One draft in responsive configuration sections, saved together from the page header.
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
  /** The capability library button: the settings' host opens the library at its own address. */
  openCapabilities: [];
}>();
const { t } = useI18n();

interface Form {
  name: string;
  description: string;
  enabled: boolean;
  systemPrompt: string;
  /** The agent's own model; null follows the domain default. */
  modelId: string | null;
  skills: RuntimeSkillRef[];
  classNames: string[];
  mcpServiceIds: string[];
}

function toForm(agent: AssistantAgentDefinition | null): Form {
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
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
watch(() => props.agent, (agent) => {
  if (dirty.value) return;
  form.value = toForm(agent);
  baseline.value = JSON.stringify(form.value);
});
const saving = ref(false);
const skillsReady = ref(false);
const promptPreview = ref(false);
const workspaceTab = ref("prompt");
const workspaceTabs = computed(() => [
  { id: "prompt", label: t("agents.prompt") },
  { id: "capabilities", label: t("agents.capabilities") },
  { id: "data", label: t("agents.data") },
]);
const mcpOptions = ref<McpServiceOption[]>([]);
const mcpLoading = ref(false);
const mcpFailed = ref(false);



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
    icon: props.agent?.icon ?? null,
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
      confirmButtonClass: "el-button--danger",
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
      <div class="editor-title">
        <strong>{{ form.name.trim() || (agent ? agent.name : t("agents.newAgent")) }}</strong>
        <small :class="{ dirty }">{{ dirty ? t("admin.agentEditorUnsaved") : t("admin.agentEditorSaved") }}</small>
      </div>
      <div class="editor-actions">
      <el-button v-if="agent" type="danger" text :icon="Trash2" :disabled="saving" @click="remove">{{ t("common.delete") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!skillsReady || (!dirty && !!agent)" @click="save">{{ t("common.save") }}</el-button>
      </div>
    </header>

    <div class="editor-body">
      <el-form class="editor-form" label-position="top" :disabled="saving" @submit.prevent>
        <div class="configuration-column">
        <section class="editor-section basics-section" data-section="basics">
          <h3>{{ t("agents.basic") }}</h3>
          <div class="basic-layout">
          <div class="identity-fields">
          <AgentBasicInfoFields
            v-model:name="form.name"
            v-model:description="form.description"
          />
          </div>
          <div class="runtime-fields" data-section="model">
            <el-form-item :label="t('agents.model')">
              <ModelSelectionSelect v-model="form.modelId" :options="modelOptions" :aria-label="t('agents.model')" />
              <p class="field-note">{{ t("agents.modelHint") }}</p>
            </el-form-item>
            <div v-if="modelOptionsFailed" class="model-options-failed" role="alert">
              <span>{{ t("agents.modelOptionsLoadFailed") }}</span>
              <el-button size="small" link type="primary" @click="emit('reloadModelOptions')">{{ t("common.retry") }}</el-button>
            </div>
          <div class="setting-row">
            <div>
              <strong>{{ t("common.enable") }}</strong>
              <p>{{ t("admin.agentEditorEnabledHint") }}</p>
            </div>
            <el-switch v-model="form.enabled" :aria-label="t('common.enable')" />
          </div>
          </div>
          </div>
        </section>

        </div>
        <div class="configuration-workspace">
          <PlatformTabs :tabs="workspaceTabs" :active-id="workspaceTab" :label="t('agents.sections')" @select="workspaceTab = $event" />
        <section v-show="workspaceTab === 'capabilities'" class="editor-section capabilities-section" data-section="capabilities">
          <div class="section-head">
            <div>
              <p>{{ t("agents.capabilitiesHint") }}</p>
            </div>
            <div class="section-actions">
              <el-button size="small" :icon="ExternalLink" @click="emit('openCapabilities')">
                {{ t("agents.capabilityLibrary") }}
              </el-button>
            </div>
          </div>

          <div class="capability-group">
          <h4 class="group-title">{{ t("agents.skills") }}</h4>
          <p class="group-hint">{{ t("agents.skillsHint") }}</p>
          <SkillSelector v-model="form.skills" @ready="skillsReady = $event" />
          </div>

          <div class="capability-group">
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
          </div>
        </section>

        <section v-show="workspaceTab === 'prompt'" class="editor-section prompt-section" data-section="prompt">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.prompt") }}</h3>
              <p>{{ t("agents.promptHint") }}</p>
            </div>
            <el-button size="small" @click="promptPreview = !promptPreview">
              {{ promptPreview ? t("common.edit") : t("admin.agentEditorPreview") }}
            </el-button>
          </div>
          <div v-if="promptPreview" class="prompt-preview markdown-body" v-html="renderAgentMarkdown(form.systemPrompt)" />
           <CodeMirrorEditor v-else v-model="form.systemPrompt" language="markdown" :min-height="480" />
          <small class="prompt-count">{{ t("admin.agentEditorCharacters", { count: form.systemPrompt.length }) }} · Markdown</small>
        </section>
        <section v-show="workspaceTab === 'data'" class="editor-section data-section" data-section="data">
          <div class="section-head">
            <div><h3>{{ t("agents.data") }}</h3><p>{{ t("agents.dataHint") }}</p></div>
          </div>
          <DataScopeGraph v-model="form.classNames" :classes="classes" :relations="relations" :loading="outlineLoading" />
        </section>
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.agent-editor {
  container: agent-editor / inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.editor-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--component-gap);
  padding: var(--spacing-md) var(--page-section-padding);
  border-bottom: 1px solid var(--el-border-color-light);
}
.editor-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--spacing-sm) var(--spacing-md);
  flex: 1;
  min-width: 0;
}
.editor-title strong {
  font-size: var(--text-lg);
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
.editor-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: auto;
  flex-wrap: wrap;
}
.editor-actions :deep(.el-button) {
  margin: 0;
}
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.editor-form {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
  min-height: 100%;
  align-items: stretch;
  margin: 0;
}
.configuration-column {
  min-width: 0;
  padding: var(--page-section-padding);
  border-inline-end: 1px solid var(--el-border-color);
}
.configuration-column > .editor-section + .editor-section {
  margin-top: var(--spacing-xl);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color);
}
.configuration-heading {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  list-style: none;
  cursor: pointer;
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}
.configuration-heading::-webkit-details-marker { display: none; }
.disclosure-arrow { flex-shrink: 0; color: var(--el-text-color-secondary); transition: transform var(--transition-fast); }
details[open] > summary .disclosure-arrow { transform: rotate(90deg); }
.data-section {
  padding-block: var(--page-section-padding);
}
.configuration-workspace { min-width: 0; padding: 0 var(--page-section-padding) var(--spacing-xl); }
.configuration-workspace > .editor-section { padding-block: var(--page-section-padding); }
.configuration-heading span {
  margin-inline-start: var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
}
details[open] > .configuration-heading { margin-bottom: var(--spacing-lg); }
.editor-form :deep(.el-form-item) { margin-bottom: var(--spacing-lg); }
.editor-form :deep(.el-form-item__content) { min-width: 0; }
.editor-form :deep(.el-form-item:last-child) { margin-bottom: 0; }
.prompt-section { padding-inline: 0; }
.basic-layout {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}
.identity-fields, .runtime-fields { min-width: 0; }
.runtime-fields {
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color);
}
.field-note {
  margin: var(--spacing-sm) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
.editor-section {
  min-width: 0;
}
.editor-section h3 {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
  flex-wrap: wrap;
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
  margin-top: 0;
}
.capability-group {
  min-width: 0;
}
.capability-group + .capability-group {
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color);
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color);
}
.setting-row strong {
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
}
.setting-row p {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.prompt-preview {
  min-height: 480px;
  padding: var(--page-section-padding);
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
@container agent-editor (max-width: 760px) {
  .editor-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .configuration-column { border-inline-end: 0; border-bottom: 1px solid var(--el-border-color); }
}
</style>
