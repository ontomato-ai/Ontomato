<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { PlatformPageHeader, useLeaveConfirmation, useUnsavedChanges } from "@ontomato/platform-shell";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { RefreshCw, Trash2 } from "lucide-vue-next";
import {
  AgentAvatar,
  agentAvatar,
  avatarSwatch,
  changedFields,
  draftTarget,
  readPageDraft,
  storedAgentAvatar,
  type PageDraftLink,
} from "@ontomato/agent-shell-ui";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { assistantAgentInputSchema, type AssistantAgentDefinition, type AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import type { McpServiceOption } from "@ontomato/contracts/agent-runtime-mcp";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { agentDefinitionsApi, type ObjectClassOption, type ObjectRelationOption } from "../api";
import { useAgentSettingsAddress } from "../agent-settings-address";
import { createAssistantClient } from "../../workbench/assistant-host";
import AgentBasicInfoFields from "./AgentBasicInfoFields.vue";
import AgentExecutionField from "./AgentExecutionField.vue";
import DataScopeGraph from "./DataScopeGraph.vue";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";
import SkillSelector from "./SkillSelector.vue";

/**
 * One agent as one long page under its header (DESIGN.md "Page architecture"): its name, the unsaved marker, Delete and
 * Save in the header; the basics, the model, the instructions, the capabilities and the data scope one after another in
 * the page, reached through the page's own contents list rather than steps or tabs. The page is one draft.
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
const { t, locale } = useI18n();

interface Form {
  name: string;
  description: string;
  /** The avatar's icon key and its swatch's light-palette value (see AgentBasicInfoFields). */
  avatarKey: string;
  avatarColor: string;
  enabled: boolean;
  systemPrompt: string;
  /** The agent's own model; null follows the domain default. */
  modelId: string | null;
  skills: RuntimeSkillRef[];
  classNames: string[];
  mcpServiceIds: string[];
  /** Whose permissions the agent runs with; null is the reader's own. */
  executionUserId: string | null;
}

function toForm(agent: AssistantAgentDefinition | null): Form {
  const avatar = agentAvatar(agent?.icon ?? null);
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    avatarKey: avatar.key,
    avatarColor: avatarSwatch(avatar.color).light,
    enabled: agent?.enabled ?? true,
    systemPrompt: agent?.systemPrompt ?? "",
    modelId: agent?.modelSelection.modelId ?? null,
    skills: [...(agent?.skills ?? [])],
    classNames: [...(agent?.classNames ?? [])],
    mcpServiceIds: [...(agent?.enabledMcpServiceIds ?? [])],
    executionUserId: agent?.executionUserId ?? null,
  };
}

/**
 * A draft's form is the page's own save request, so it fills the same fields a read agent does, as a save would store
 * them: once saved, the same draft reads as the agent it saved rather than as a change.
 */
function fromInput(input: AssistantAgentInput): Form {
  const avatar = agentAvatar(input.icon);
  return {
    // The save trims the name.
    name: input.name.trim(),
    description: input.description,
    avatarKey: avatar.key,
    avatarColor: avatarSwatch(avatar.color).light,
    enabled: input.enabled,
    systemPrompt: input.systemPrompt,
    modelId: input.modelSelection.modelId,
    skills: input.skills.map(heldSkill),
    classNames: [...input.classNames],
    mcpServiceIds: [...input.enabledMcpServiceIds],
    // An update that omits the field keeps what the owner stores; a draft that names one fills it.
    executionUserId: input.executionUserId === undefined ? (props.agent?.executionUserId ?? null) : input.executionUserId,
  };
}

/**
 * A draft may name a domain skill without its id, and the owner stores it under the agent's own domain: a domain skill the
 * agent already holds by that name is that skill. One the agent does not hold keeps the reference the draft gave, which
 * the selector shows as it is.
 */
function heldSkill(skill: AssistantAgentInput["skills"][number]): RuntimeSkillRef {
  if (skill.namespace.kind === "domain" && skill.namespace.domainId === undefined)
    return props.agent?.skills.find((held) => held.namespace.kind === "domain" && held.name === skill.name) ?? (skill as RuntimeSkillRef);
  return skill as RuntimeSkillRef;
}

const form = ref<Form>(toForm(props.agent));
/** The avatar as the draft would store it, for the head's preview. */
const formIcon = computed(() => storedAgentAvatar({ key: form.value.avatarKey, color: form.value.avatarColor }));
/** The form's own field names under the page's words, for the line listing what the draft changed. */
const CHANGED_FIELD_LABELS: Record<string, string> = {
  name: "common.name",
  description: "common.description",
  avatarKey: "common.avatar",
  avatarColor: "common.avatar",
  enabled: "common.enable",
  systemPrompt: "agents.prompt",
  modelId: "agents.model",
  skills: "agents.skills",
  classNames: "agents.data",
  mcpServiceIds: "admin.externalMcpServices",
  executionUserId: "agents.executionUser",
};

const baseline = ref(JSON.stringify(form.value));
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
watch(() => props.agent, (agent) => {
  if (dirty.value) return;
  form.value = toForm(agent);
  baseline.value = JSON.stringify(form.value);
});
const saving = ref(false);
/** The execution field reports whether this reader may change it; the save sends the field only within that. */
const execution = ref<{ canSet: boolean } | null>(null);
const skillsReady = ref(false);
const promptPreview = ref(false);

/*
 * A page link may carry a draft (an agent wrote this form and the reader saves it). The draft fills the form over the
 * agent as it was read, the fields it changed are marked, and nothing is written here: until Save the owner holds the
 * old values. A draft that arrives while this form has unsaved changes asks first, and dropping it only empties the form.
 * A create draft's first save records the agent it created, and the draft addresses that agent from then on.
 */
const leaving = useLeaveConfirmation();
/**
 * The page's address and its draft: the page that mounts this editor provides them, so beside a conversation they are the
 * agent platform's parameter and at the page's own address the address itself.
 */
const settingsAddress = useAgentSettingsAddress();
const link = settingsAddress.draft.value;
const pagePath = settingsAddress.address.value.split("?")[0]!;
const changed = ref<ReadonlySet<string>>(new Set());
const draftExecutionChanged = ref(false);
const assistant = createAssistantClient();
/** The create draft the form holds: its first save records there the agent it created. */
let createDraft: PageDraftLink | null = null;
if (link) {
  void readPageDraft(assistant, link, {
    pageKey: "agent-settings",
    operations: ["agent.create", "agent.update"] as const,
  })
    .then(async (draft) => {
      // A create names no agent and an update names the agent it changes; a draft saying otherwise is not this page's.
      if ((draft.operation === "agent.create") !== (draft.target.id === undefined)) throw new Error(t("agents.draftOtherAgent"));
      // The agent the draft addresses: an update's, or the one a create draft's first save created.
      const target = draftTarget(draft);
      // The new-agent page given a draft of an existing agent opens that agent's own page with the same draft, which
      // compares there as an update. An agent since deleted is that page's missing agent, never a new create.
      if (target.kind === "update" && !props.agent) return settingsAddress.go(settingsAddress.agentAddress(target.id));
      // The draft and the page must name the same agent: a create only a new one, an update only the one shown.
      if (target.kind === "create" ? props.agent !== null : target.id !== props.agent?.id) throw new Error(t("agents.draftOtherAgent"));
      const filled = fromInput(assistantAgentInputSchema.parse(draft.form));
      const changes = changedFields(toForm(props.agent), filled);
      // A draft that changes nothing is no draft (the same link after its draft was saved): the page stays as the agent
      // is, and the reader's own edits are left alone without asking.
      if (!changes.size) return;
      if (dirty.value && !(await leaving.confirm())) return;
      if (target.kind === "create") createDraft = link;
      changed.value = changes;
      baseline.value = JSON.stringify(toForm(props.agent));
      form.value = filled;
      // A draft that changes whose permissions the agent runs with is the administrator's to save; the field shows what
      // the draft asked for, and this reader cannot submit it as their own change.
      draftExecutionChanged.value = changed.value.has("executionUserId");
    })
    .catch((error: unknown) => ElMessage.error(error instanceof Error ? error.message : String(error)));
}

/** The fields the draft changed, under the page's own names, for the line above the form and each section's marker. */
const changedLabels = computed(() => [...changed.value].map((field) => t(CHANGED_FIELD_LABELS[field] ?? field)));
const changedLine = computed(() =>
  t("agents.draftChanged", {
    fields: new Intl.ListFormat(locale.value, { style: "long", type: "conjunction" }).format(changedLabels.value),
  }),
);
const sectionChanged = (fields: readonly string[]) => fields.some((field) => changed.value.has(field));

/** The page's sections in order, for its contents list; each one scrolls into view, nothing is hidden. */
const sections = computed(() => [
  { id: "basics", label: t("agents.basic") },
  { id: "model", label: t("agents.model") },
  { id: "prompt", label: t("agents.prompt") },
  { id: "capabilities", label: t("agents.capabilities") },
  { id: "execution", label: t("agents.executionUser") },
  { id: "data", label: t("agents.data") },
]);
const sectionElements = new Map<string, Element>();
function sectionRef(id: string) {
  return (element: unknown) => {
    if (element instanceof Element) sectionElements.set(id, element);
  };
}
function jump(id: string) {
  sectionElements.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
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
  // A reader who may not set the reference never sends it: the stored one stays, and a draft that asked for a change is
  // not turned into this reader's own save (the notice under the form says so).
  const maySetExecutionUser = execution.value?.canSet === true;
  const executionChanged = value.executionUserId !== (props.agent?.executionUserId ?? null);
  return {
    name: value.name.trim(),
    description: value.description,
    icon: storedAgentAvatar({ key: value.avatarKey, color: value.avatarColor }),
    enabled: value.enabled,
    systemPrompt: value.systemPrompt,
    modelSelection: { modelId: value.modelId },
    skills: value.skills,
    classNames: value.classNames,
    enabledMcpServiceIds: value.mcpServiceIds,
    sortOrder: props.agent?.sortOrder ?? 0,
    // The field is sent only when the reader may set it and changed it: an omitted update keeps the stored reference, so
    // editing anything else never resets a member an administrator chose.
    ...(maySetExecutionUser && executionChanged ? { executionUserId: value.executionUserId } : {}),
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
    changed.value = new Set();
    // A saved update drops its draft handoff. A create moves straight to the new agent through the page.
    if (link && props.agent) settingsAddress.go(settingsAddress.savedAddress.value);
    ElMessage.success(props.agent ? t("analysis.agentUpdated") : t("analysis.agentCreated"));
    emit("saved", saved);
    // A create draft's first save records the agent it created, once the save itself is done: its link opens that agent
    // from now on.
    if (createDraft) await assistant.recordPageDraftCreated(createDraft.sessionId, createDraft.runId, createDraft.path, saved.id);
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

async function discard() {
  const confirmed = await ElMessageBox.confirm(t("agents.discardConfirm"), t("platform.discard"), {
    type: "warning",
    confirmButtonText: t("platform.discard"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false,
  );
  if (confirmed) form.value = JSON.parse(baseline.value) as Form;
}

/** The header's Save waits for the skills the agent may choose: its draft holds them by reference. */
const draft = computed(() => ({
  dirty: dirty.value,
  saving: saving.value || !skillsReady.value,
  save: () => void save(),
  discard: () => void discard(),
}));
const actions = computed(() =>
  props.agent
    ? [{ id: "delete", label: t("common.delete"), icon: Trash2, danger: true, disabled: saving.value, onClick: () => void remove() }]
    : [],
);
const title = computed(() => form.value.name.trim() || (props.agent ? props.agent.name : t("agents.newAgent")));

// Switching to another agent, a new one or anywhere else leaves this draft: with changes, the platform asks first.
useUnsavedChanges({ dirty: () => dirty.value, paths: () => [pagePath] });
</script>

<template>
  <div class="agent-editor">
    <PlatformPageHeader
      :title="title"
      :actions="actions"
      :draft="draft"
      :labels="{ save: t('common.save'), discard: t('platform.discard'), unsavedChanges: t('platform.unsavedChanges') }"
      @save="draft.save()"
      @discard="draft.discard()"
    >
      <template #leading><AgentAvatar :icon="formIcon" :size="28" /></template>
    </PlatformPageHeader>

    <div class="editor-body platform-page-gutter">
      <p v-if="draftExecutionChanged && execution?.canSet !== true" class="draft-changed" role="alert">
        {{ t("agents.executionDraftUnauthorized") }}
      </p>
      <p v-if="changedLabels.length" class="draft-changed" role="status">
        {{ changedLine }}
      </p>
      <div class="editor-layout">
        <el-form class="editor-form" label-position="top" :disabled="saving" @submit.prevent>
          <section :ref="sectionRef('basics')" class="editor-section" :class="{ changed: sectionChanged(['name', 'description', 'avatarKey', 'avatarColor', 'enabled']) }" data-section="basics">
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

          <section :ref="sectionRef('model')" class="editor-section" :class="{ changed: sectionChanged(['modelId']) }" data-section="model">
            <h3>{{ t("agents.model") }}</h3>
            <p class="section-hint">{{ t("agents.modelHint") }}</p>
            <ModelSelectionSelect v-model="form.modelId" class="model-select" :options="modelOptions" :aria-label="t('agents.model')" />
            <div v-if="modelOptionsFailed" class="model-options-failed" role="alert">
              <span>{{ t("agents.modelOptionsLoadFailed") }}</span>
              <el-button size="small" link type="primary" @click="emit('reloadModelOptions')">{{ t("common.retry") }}</el-button>
            </div>
          </section>

          <section :ref="sectionRef('prompt')" class="editor-section" :class="{ changed: sectionChanged(['systemPrompt']) }" data-section="prompt">
            <div class="section-head">
              <div>
                <h3>{{ t("agents.prompt") }}</h3>
                <p>{{ t("agents.promptHint") }}</p>
              </div>
              <el-button size="small" @click="promptPreview = !promptPreview">
                {{ promptPreview ? t("common.edit") : t("admin.agentEditorPreview") }}
              </el-button>
            </div>
            <div v-if="promptPreview" class="prompt-preview"><MarkdownView :content="form.systemPrompt" /></div>
            <CodeEditor v-else v-model="form.systemPrompt" language="markdown" :min-height="560" />
            <small class="prompt-count">{{ t("admin.agentEditorCharacters", { count: form.systemPrompt.length }) }} · Markdown</small>
          </section>

          <section :ref="sectionRef('capabilities')" class="editor-section" :class="{ changed: sectionChanged(['skills', 'mcpServiceIds']) }" data-section="capabilities">
            <div class="section-head">
              <div>
                <h3>{{ t("agents.capabilities") }}</h3>
                <p>{{ t("agents.capabilitiesHint") }}</p>
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

          <section :ref="sectionRef('execution')" class="editor-section" :class="{ changed: sectionChanged(['executionUserId']) }" data-section="execution">
            <h3>{{ t("agents.executionUser") }}</h3>
            <p class="section-hint">{{ t("agents.executionUserHint") }}</p>
            <AgentExecutionField
              ref="execution"
              v-model="form.executionUserId"
              :stored="props.agent?.executionUserId ?? null"
              :disabled="saving"
            />
          </section>

          <section :ref="sectionRef('data')" class="editor-section" :class="{ changed: sectionChanged(['classNames']) }" data-section="data">
            <div class="section-head">
              <div><h3>{{ t("agents.data") }}</h3><p>{{ t("agents.dataHint") }}</p></div>
            </div>
            <DataScopeGraph v-model="form.classNames" :classes="classes" :relations="relations" :loading="outlineLoading" />
          </section>
        </el-form>

        <!-- The page's contents: each entry scrolls its section into view; every section stays on the page. -->
        <nav class="editor-contents" :aria-label="t('agents.sections')">
          <button v-for="section in sections" :key="section.id" type="button" class="contents-link" @click="jump(section.id)">
            {{ section.label }}
          </button>
        </nav>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The editor fills the main area under its header and scrolls as one page. Sections follow one another at the reading
 * width of a settings page, with a hairline between them; the contents list stays beside them while they scroll.
 */
.agent-editor {
  container: agent-editor / inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 880px) 160px;
  gap: var(--spacing-2xl);
  align-items: start;
}
.editor-form {
  min-width: 0;
  margin: 0;
}
.editor-section {
  min-width: 0;
  padding-block: var(--page-section-padding);
  scroll-margin-top: var(--spacing-sm);
}
.editor-section + .editor-section {
  border-top: 1px solid var(--el-border-color);
}
.editor-section.changed h3 {
  color: var(--el-color-primary);
}
/* The line naming what the draft changed: the reader sees the extent before reading the fields. */
.draft-changed {
  margin: var(--spacing-md) 0 0;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.editor-section h3 {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.section-hint {
  margin: calc(-1 * var(--spacing-md)) 0 var(--spacing-md);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
.model-select {
  max-width: 480px;
}
.editor-contents {
  position: sticky;
  top: var(--page-section-padding);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: var(--page-section-padding);
}
.contents-link {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.contents-link:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.contents-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.editor-form :deep(.el-form-item) { margin-bottom: var(--spacing-lg); }
.editor-form :deep(.el-form-item__content) { min-width: 0; }
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
  border-top: 1px solid var(--el-border-color-lighter);
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
  min-height: 560px;
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
/* Narrow: the contents list gives way to the sections. */
@container agent-editor (max-width: 900px) {
  .editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .editor-contents {
    display: none;
  }
}
</style>
