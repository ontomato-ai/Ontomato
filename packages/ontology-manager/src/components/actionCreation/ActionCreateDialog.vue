<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput } from "element-plus";
import { Send } from "lucide-vue-next";
import { useManagerClient, useOntologyText } from "../../context";
import { useManagerFeedback } from "../../feedback";
import ActionDefinitionView from "./ActionDefinitionView.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; created: []; back: [] }>();

const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const { requestSmartAsset, loadOntology } = useManagerClient();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

type ChatMessage = { role: "user" | "assistant" | "error"; text: string };

const messages = ref<ChatMessage[]>([]);
const prompt = ref("");
const generating = ref(false);
const saving = ref(false);
const draft = ref<any>(null);
const examples = ref<string[]>([]);
const examplesLoading = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

function reset() {
  messages.value = [{ role: "assistant", text: ot("actionWizardIntro") }];
  prompt.value = "";
  generating.value = false;
  saving.value = false;
  draft.value = null;
  void nextTick(scrollBottom);
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    reset();
    await loadExamples();
  }
);

async function loadExamples() {
  examplesLoading.value = true;
  examples.value = [];
  try {
    const response = await requestSmartAsset("actions", "exampleRequests", {});
    const list = response?.data?.examples ?? response?.examples ?? [];
    if (Array.isArray(list) && list.length) {
      examples.value = list.slice(0, 3).map((item) => String(item));
      return;
    }
  } catch {
    // The model may be unavailable; fall through to ontology templates.
  } finally {
    examplesLoading.value = false;
  }
  try {
    const ontology = await loadOntology();
    examples.value = buildExamples(ontology.objects, ontology.relations);
  } catch {
    examples.value = [];
  }
  if (!examples.value.length) {
    examples.value = [
      ot("actionWizardExample1"),
      ot("actionWizardExample2"),
      ot("actionWizardExample3"),
    ];
  }
}

function labelOf(className: string, objects: Array<{ className: string; showName: string }>) {
  return objects.find((item) => item.className === className)?.showName || className;
}

function buildExamples(
  objects: Array<{ className: string; showName: string; attrs: Array<{ name: string; showName: string; type: string; primaryKey?: boolean }> }>,
  relations: Array<{ fromclass: string; toclass: string }>
): string[] {
  const withAttributes = objects.filter((item) => item.attrs?.length);
  const primary = withAttributes[0];
  const attribute = primary?.attrs.find((item) => !item.primaryKey && !/vector|file/i.test(item.type))
    ?? primary?.attrs.find((item) => !item.primaryKey);
  const relation = relations[0];
  const result: string[] = [];
  if (primary) {
    result.push(ot("actionExampleCreate", { name: primary.showName }));
  }
  if (primary && attribute) {
    result.push(ot("actionExampleUpdate", { name: primary.showName, field: attribute.showName }));
  }
  if (relation) {
    result.push(
      ot("actionExampleRelation", {
        source: labelOf(relation.fromclass, objects),
        target: labelOf(relation.toclass, objects),
      })
    );
  } else if (primary) {
    result.push(ot("actionExampleDelete", { name: primary.showName }));
  }
  return result.slice(0, 3);
}

function scrollBottom() {
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function runGeneration(question: string) {
  messages.value.push({ role: "user", text: question });
  generating.value = true;
  void nextTick(scrollBottom);
  try {
    const response = await requestSmartAsset("actions", "generateFromNatureLanguage", {
      question,
      persistence: false,
    });
    const generated = response?.data ?? response;
    if (!generated) throw new Error(ot("actionWizardGenerateFailed"));
    draft.value = generated;
    messages.value.push({
      role: "assistant",
      text: ot("actionDefinitionReady", { name: generated.name || "—" }),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : ot("actionWizardGenerateFailed");
    messages.value.push({ role: "error", text });
    message.error(text);
  } finally {
    generating.value = false;
    void nextTick(scrollBottom);
  }
}

async function send() {
  const question = prompt.value.trim();
  if (!question) {
    message.warning(ot("actionPromptRequired"));
    return;
  }
  prompt.value = "";
  await runGeneration(question);
}

async function sendExample(text: string) {
  if (generating.value) return;
  prompt.value = text;
  await send();
}

async function save() {
  if (!draft.value) {
    message.warning(ot("actionWizardNoDraft"));
    return;
  }
  saving.value = true;
  try {
    await requestSmartAsset("actions", "save", draft.value);
    message.success(ot("actionWizardSaved"));
    visible.value = false;
    emit("created");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetSaveFailed"));
  } finally {
    saving.value = false;
  }
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
    <div class="action-create">
      <section class="chat">
        <header class="chat-header">
          <strong>{{ ot("actionWizardChatTitle") }}</strong>
        </header>
        <div ref="messagesEl" class="messages">
          <template v-for="(item, index) in messages" :key="index">
            <div :class="['msg', item.role]">{{ item.text }}</div>
            <div v-if="index === 0 && messages.length === 1" class="try-say">
              <p>{{ ot("actionWizardTrySay") }}</p>
              <p v-if="examplesLoading" class="example-loading">{{ ot("actionWizardExamplesLoading") }}</p>
              <button
                v-for="example in examples"
                :key="example"
                type="button"
                @click="sendExample(example)"
              >
                {{ example }}
              </button>
            </div>
          </template>
          <div v-if="generating" class="msg assistant typing">{{ ot("actionWizardGenerating") }}</div>
        </div>
        <div class="composer">
          <el-input
            v-model="prompt"
            type="textarea"
            :rows="3"
            resize="none"
            :placeholder="ot('actionWizardPlaceholder')"
            @keydown.ctrl.enter.prevent="send"
          />
          <div class="composer-actions">
            <span class="kbd">Ctrl + Enter</span>
            <el-button type="primary" :icon="Send" :loading="generating" :disabled="generating" @click="send">
              {{ ot("actionWizardSend") }}
            </el-button>
          </div>
        </div>
      </section>

      <aside class="definition-pane">
        <header class="definition-head">
          <strong>{{ ot("actionDefinitionTitle") }}</strong>
          <span v-if="draft" class="draft-name">{{ draft.name }}</span>
        </header>
        <div class="definition-body">
          <ActionDefinitionView :action="draft" />
        </div>
        <footer v-if="draft" class="definition-actions">
          <el-button type="primary" :loading="saving" @click="save">
            {{ ot("actionWizardSave") }}
          </el-button>
        </footer>
      </aside>
    </div>
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
  padding: 16px 18px 8px;
}
.messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.user {
  align-self: flex-end;
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
.msg.assistant {
  align-self: flex-start;
  background: var(--el-fill-color-light);
}
.msg.error {
  align-self: flex-start;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.msg.typing {
  color: var(--el-text-color-secondary);
  font-style: italic;
}
.try-say {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--el-color-success-light-7);
  border-radius: 10px;
  background: var(--el-color-success-light-9);
}
.try-say p {
  margin: 0 0 2px;
  color: var(--el-color-success-dark-2);
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
.try-say button:hover {
  border-color: var(--el-color-success);
  color: var(--el-color-success-dark-2);
}
.composer {
  padding: 12px 18px 18px;
  border-top: 1px solid var(--el-border-color-light);
}
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.kbd {
  color: var(--el-text-color-placeholder);
  font-size: var(--text-xs, 11px);
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
