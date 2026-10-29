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
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { agentDefinitionsApi, type ObjectClassOption, type OntologyRelationOption } from "../api";
import { avatarIcon, lightAvatarColorOptions, themedAvatarColor } from "../avatar";
import AgentBasicInfoFields from "./AgentBasicInfoFields.vue";
import GraphScopeField from "./GraphScopeField.vue";
import SkillSelector from "./SkillSelector.vue";

/** Edits one agent definition; a null agent is a new one. */
const props = defineProps<{
  agent: AssistantAgentDefinition | null;
  classes: ObjectClassOption[];
  relations: OntologyRelationOption[];
  outlineLoading: boolean;
}>();
const emit = defineEmits<{ saved: [agent: AssistantAgentDefinition]; deleted: [id: string] }>();
const { t } = useI18n();
const { isDark } = useTheme();

interface Form {
  name: string;
  description: string;
  avatarKey: string;
  avatarColor: string;
  enabled: boolean;
  systemPrompt: string;
  skills: RuntimeSkillRef[];
  classNames: string[];
  scopeMode: "panorama" | "subgraph";
  scopeRoots: string[];
  scopeDepth: number | undefined;
  mcpServiceNames: string[];
}

function toForm(agent: AssistantAgentDefinition | null): Form {
  let avatar = { key: "Brain", color: lightAvatarColorOptions[0]! };
  try {
    if (agent?.icon) avatar = { ...avatar, ...JSON.parse(agent.icon) };
  } catch {
    // A malformed stored avatar falls back to the default.
  }
  const scope = agent?.graphScope;
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    avatarKey: avatar.key,
    avatarColor: themedAvatarColor(avatar.color, isDark.value),
    enabled: agent?.enabled ?? true,
    systemPrompt: agent?.systemPrompt ?? "",
    skills: [...(agent?.skills ?? [])],
    classNames: [...(agent?.classNames ?? [])],
    scopeMode: scope?.mode === "subgraph" ? "subgraph" : "panorama",
    scopeRoots: scope?.mode === "subgraph" ? [...scope.rootClassNames] : [],
    scopeDepth: scope?.mode === "subgraph" ? scope.maxDepth : 1,
    mcpServiceNames: [...(agent?.enabledMcpServiceNames ?? [])],
  };
}

const form = ref<Form>(toForm(props.agent));
const baseline = ref(JSON.stringify(form.value));
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
const saving = ref(false);
const skillsReady = ref(false);
const promptPreview = ref(false);
const mcpNames = ref<string[]>([]);
const mcpLoading = ref(false);
const mcpFailed = ref(false);

watch(isDark, (dark) => {
  form.value.avatarColor = themedAvatarColor(form.value.avatarColor, dark);
});

async function loadMcp() {
  mcpLoading.value = true;
  mcpFailed.value = false;
  try {
    mcpNames.value = await agentDefinitionsApi.listMcpServiceNames();
  } catch {
    mcpFailed.value = true;
  } finally {
    mcpLoading.value = false;
  }
}
onMounted(loadMcp);

function classLabel(cls: ObjectClassOption) {
  const name = cls.showName || cls.classDesc || cls.className;
  return name === cls.className ? cls.className : `${name} (${cls.className})`;
}

function validInput(): AssistantAgentInput | null {
  const value = form.value;
  if (!value.name.trim()) {
    ElMessage.warning(t("analysis.agentNameRequired"));
    return null;
  }
  if (value.scopeMode === "subgraph") {
    if (!value.scopeRoots.length) {
      ElMessage.warning(t("admin.graphScopeRootsRequired"));
      return null;
    }
    const depth = value.scopeDepth;
    if (depth === undefined || !Number.isInteger(depth) || depth < 0 || depth > 10) {
      ElMessage.warning(t("admin.graphScopeDepthInvalid"));
      return null;
    }
  }
  return {
    name: value.name.trim(),
    description: value.description,
    icon: JSON.stringify({ key: value.avatarKey, color: value.avatarColor }),
    enabled: value.enabled,
    systemPrompt: value.systemPrompt,
    skills: value.skills,
    classNames: value.classNames,
    graphScope:
      value.scopeMode === "subgraph"
        ? { mode: "subgraph", rootClassNames: value.scopeRoots, maxDepth: value.scopeDepth! }
        : { mode: "panorama" },
    enabledMcpServiceNames: value.mcpServiceNames,
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
      <el-button v-if="agent" text :icon="Trash2" :disabled="saving" @click="remove">{{ t("common.delete") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!skillsReady || (!dirty && !!agent)" @click="save">{{ t("common.save") }}</el-button>
    </header>

    <div class="editor-body">
      <el-form label-position="top" :disabled="saving" @submit.prevent>
        <section class="editor-section">
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

        <section class="editor-section">
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

        <section class="editor-section">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.skills") }}</h3>
              <p>{{ t("agents.skillsHint") }}</p>
            </div>
          </div>
          <SkillSelector v-model="form.skills" @ready="skillsReady = $event" />
        </section>

        <section class="editor-section">
          <div class="section-head">
            <div>
              <h3>{{ t("agents.data") }}</h3>
              <p>{{ t("agents.dataHint") }}</p>
            </div>
          </div>
          <el-form-item :label="t('admin.relatedClasses')">
            <el-select
              v-model="form.classNames"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              clearable
              :max-collapse-tags="4"
              :loading="outlineLoading"
              :placeholder="t('admin.relatedClasses')"
              class="full"
            >
              <el-option v-for="cls in classes" :key="cls.className" :label="classLabel(cls)" :value="cls.className" />
            </el-select>
            <p class="form-tip">{{ t("agents.relatedClassesHint") }}</p>
          </el-form-item>
          <GraphScopeField
            v-model:mode="form.scopeMode"
            v-model:roots="form.scopeRoots"
            v-model:depth="form.scopeDepth"
            :classes="classes"
            :relations="relations"
            :loading="outlineLoading"
          />
        </section>

        <section class="editor-section">
          <div class="section-head">
            <div>
              <h3>{{ t("admin.externalMcpServices") }}</h3>
              <p>{{ t("admin.externalMcpServicesHint") }}</p>
            </div>
            <div class="section-actions">
              <el-button size="small" tag="a" href="#/admin/mcp-service" target="_blank" rel="noopener" :icon="ExternalLink">
                {{ t("mcp.manageServices") }}
              </el-button>
              <el-button size="small" :loading="mcpLoading" :icon="RefreshCw" @click="loadMcp">{{ t("common.refresh") }}</el-button>
            </div>
          </div>
          <el-select
            v-model="form.mcpServiceNames"
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
            <el-option v-for="name in mcpNames" :key="name" :label="name" :value="name" />
            <el-option
              v-for="name in form.mcpServiceNames.filter((selected) => !mcpNames.includes(selected))"
              :key="name"
              :label="name"
              :value="name"
              disabled
            />
          </el-select>
          <el-alert v-if="mcpFailed" class="mcp-alert" type="warning" :closable="false" :title="t('admin.externalMcpServicesLoadFailed')" />
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
  border-radius: 10px;
  color: var(--el-color-primary);
}
.editor-title {
  display: flex;
  flex-direction: column;
  flex: 1;
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
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 12px;
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
  border-radius: 10px;
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
.form-tip {
  flex-basis: 100%;
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.mcp-alert {
  margin-top: 10px;
}
</style>
