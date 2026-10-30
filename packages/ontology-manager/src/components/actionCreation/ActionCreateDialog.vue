<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { Plus } from "lucide-vue-next";
import {
  AgentChatPanel,
  createAgentHostClient,
  type AgentHostAgent,
  type AgentHostClient,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import { useManagerClient, useOntologyText } from "../../context";
import { useManagerFeedback } from "../../feedback";
import ActionDefinitionView from "./ActionDefinitionView.vue";
import { actionChatLabels } from "./chatLabels";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; created: []; back: [] }>();

const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const manager = useManagerClient();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const client: AgentHostClient = createAgentHostClient({
  request: (path, init) => manager.request(`/ontology/ai${path}`, init),
});

const agentId = ref<string | null>(null);
const agent = computed<AgentHostAgent | null>(() =>
  agentId.value
    ? {
        id: agentId.value,
        name: ot("actionWizardChatTitle"),
        description: ot("actionWizardIntro"),
        icon: null,
        enabled: true,
      }
    : null
);
const chat = ref<InstanceType<typeof AgentChatPanel> | null>(null);
const sessionId = ref<string | null>(null);
const draft = ref<any>(null);
const saving = ref(false);
const creatingDraft = ref(false);
const examples = ref<string[]>([]);
const examplesLoading = ref(false);
const errorText = ref("");

const labels = computed(() =>
  actionChatLabels({
    greeting: ot("actionWizardGreeting"),
    placeholder: ot("actionWizardPlaceholder"),
    send: ot("actionWizardSend"),
    stop: ot("actionWizardStop"),
    newConversation: ot("actionWizardNewChat"),
    working: ot("actionWizardGenerating"),
  })
);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    errorText.value = "";
    void loadAgent();
    if (!examples.value.length) void loadExamples();
  }
);

async function loadAgent() {
  if (agentId.value) return;
  try {
    const response = await manager.request("/action/creationAgent");
    const body = await response.json();
    const id = body?.data?.agentId ?? body?.agentId;
    if (typeof id === "string") agentId.value = id;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : ot("actionWizardAgentError");
  }
}

async function loadExamples() {
  examplesLoading.value = true;
  try {
    const response = await manager.request("/action/exampleRequests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    const list = body?.data?.examples ?? body?.examples ?? [];
    examples.value = Array.isArray(list) ? list.slice(0, 3).map((item) => String(item)) : [];
  } catch {
    examples.value = [];
  } finally {
    examplesLoading.value = false;
  }
}

function onSession(id: string | null) {
  sessionId.value = id;
}

function onError(text: string) {
  errorText.value = text;
  message.error(text);
}

async function onRunComplete(payload: { sessionId: string; runId: string; ok: boolean }) {
  if (!payload.ok) return;
  creatingDraft.value = true;
  errorText.value = "";
  try {
    const response = await manager.request("/action/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: payload.sessionId, runId: payload.runId }),
    });
    const body = await response.json();
    if (body?.success === false) throw new Error(body.message || ot("actionWizardDraftFailed"));
    const value = body?.data ?? body;
    // A question-only turn has no result file; keep the previous draft.
    if (value?.noDraft) return;
    if (!value?.draftId) throw new Error(ot("actionWizardDraftFailed"));
    draft.value = value.action ?? value;
    draft.value = { ...draft.value, draftId: value.draftId };
    if (value.explanationMissing) message.warning(ot("actionWizardExplanationMissing"));
  } catch (error) {
    const text = error instanceof Error ? error.message : ot("actionWizardDraftFailed");
    errorText.value = text;
    message.error(text);
  } finally {
    creatingDraft.value = false;
  }
}

async function save() {
  if (!draft.value?.draftId) {
    message.warning(ot("actionWizardNoDraft"));
    return;
  }
  saving.value = true;
  try {
    const response = await manager.request("/action/saveDraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.value.draftId }),
    });
    const body = await response.json();
    if (body?.success === false) throw new Error(body.message || ot("assetSaveFailed"));
    message.success(ot("actionWizardSaved"));
    visible.value = false;
    emit("created");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetSaveFailed"));
  } finally {
    saving.value = false;
  }
}

function newChat() {
  sessionId.value = null;
  draft.value = null;
  errorText.value = "";
  chat.value?.reset();
}

function sendExample(text: string) {
  if (!agentId.value) return;
  chat.value?.send(text);
}

function onClosed() {
  emit("back");
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="ot('actionGenerateTitle')"
    width="min(1440px, 96vw)"
    top="3vh"
    class="action-create-dialog"
    :close-on-click-modal="false"
    @closed="onClosed"
  >
    <div v-if="agentId" class="action-create">
      <section class="chat">
        <header class="chat-header">
          <strong>{{ ot("actionWizardChatTitle") }}</strong>
          <el-button text size="small" :icon="Plus" @click="newChat">
            {{ ot("actionWizardNewChat") }}
          </el-button>
        </header>
        <div v-if="!draft && !sessionId" class="try-say">
          <p>{{ ot("actionWizardTrySay") }}</p>
          <p v-if="examplesLoading" class="example-loading">
            {{ ot("actionWizardExamplesLoading") }}
          </p>
          <button
            v-for="example in examples"
            :key="example"
            type="button"
            :disabled="creatingDraft"
            @click="sendExample(example)"
          >
            {{ example }}
          </button>
        </div>
        <p v-if="errorText" class="chat-error" role="alert">{{ errorText }}</p>
        <AgentChatPanel
          ref="chat"
          class="chat-panel"
          :client="client"
          :agent-id="agentId"
          :agent="agent"
          :labels="labels"
          :session-id="sessionId"
          @update:session-id="onSession"
          @run-complete="onRunComplete"
          @error="onError"
        />
      </section>

      <aside class="definition-pane">
        <header class="definition-head">
          <strong>{{ ot("actionDefinitionTitle") }}</strong>
          <span v-if="draft" class="draft-name">{{ draft.name }}</span>
        </header>
        <div class="definition-body">
          <p v-if="creatingDraft" class="definition-loading">
            {{ ot("actionWizardGenerating") }}
          </p>
          <ActionDefinitionView v-else :action="draft" />
        </div>
        <footer v-if="draft" class="definition-actions">
          <el-button type="primary" :loading="saving" @click="save">
            {{ ot("actionWizardSave") }}
          </el-button>
        </footer>
      </aside>
    </div>
    <p v-else-if="errorText" class="dialog-error" role="alert">{{ errorText }}</p>
  </el-dialog>
</template>

<style scoped>
.action-create {
  display: flex;
  height: 100%;
  min-height: 0;
  margin: -10px 0;
}
.chat {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--el-border-color-light);
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 8px;
}
.chat-panel {
  flex: 1;
  min-height: 0;
}
.try-say {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 18px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.try-say p {
  width: 100%;
  margin: 0 0 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
.try-say button {
  border: 1px solid var(--el-color-success-light-5);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  padding: 5px 10px;
  font: inherit;
  font-size: var(--text-xs, 12px);
  cursor: pointer;
  text-align: start;
}
.try-say button:hover:not(:disabled) {
  border-color: var(--el-color-success);
  color: var(--el-color-success-dark-2);
}
.chat-error,
.dialog-error {
  margin: 8px 18px;
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
}
.definition-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--el-bg-color);
}
.definition-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.draft-name {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.definition-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.definition-loading {
  padding: 24px 18px;
  color: var(--el-text-color-secondary);
}
.definition-actions {
  display: flex;
  justify-content: flex-end;
  padding: 10px 18px;
  border-top: 1px solid var(--el-border-color-light);
}
</style>

<style>
/* The manager shell caps every dialog at 720px; this creation surface needs the full working area. */
.ontology-manager-shell .el-dialog.action-create-dialog {
  width: min(1440px, calc(100cqw - 48px)) !important;
  max-width: calc(100cqw - 48px) !important;
  margin: 3cqh auto !important;
}
.ontology-manager-shell .el-dialog.action-create-dialog .el-dialog__body {
  height: min(84cqh, 1000px);
  max-height: none;
  padding: 0;
  overflow: hidden;
}
</style>
