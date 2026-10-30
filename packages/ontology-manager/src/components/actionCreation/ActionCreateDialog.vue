<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElInput,
  ElOption,
  ElSelect,
  ElTag,
} from "element-plus";
import { Plus, Send, Sparkles, Trash2 } from "lucide-vue-next";
import { useManagerClient, useOntologyText } from "../../context";
import { useManagerFeedback } from "../../feedback";
import {
  compileStructuredSpec,
  emptyIntent,
  intentFromAction,
  intentInstruction,
  validateStep,
  type ActionIntent,
} from "./intent";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; created: []; back: [] }>();

const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const { requestSmartAsset } = useManagerClient();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

type ChatMessage = { role: "user" | "assistant" | "error"; text: string };

const intent = ref<ActionIntent>(emptyIntent());
const step = ref(0);
const messages = ref<ChatMessage[]>([]);
const prompt = ref("");
const generating = ref(false);
const saving = ref(false);
const draft = ref<any>(null);
const snapshot = ref("");
const messagesEl = ref<HTMLElement | null>(null);

const ACTION_TYPES = ["CREATE", "UPDATE", "DELETE", "LINK", "VECTOR", "EXTERNAL"];
const PARAMETER_TYPES = [
  "STRING",
  "NUMBER",
  "TIMESTAMP",
  "OBJECT_REFERENCE",
  "OBJECT_SET",
  "FILE",
  "ARRAY<STRING>",
  "ARRAY<NUMBER>",
  "ARRAY<TIMESTAMP>",
];
const RULE_KINDS = [
  "CREATE_OBJECT",
  "UPDATE_OBJECT",
  "DELETE_OBJECT",
  "CREATE_EDGE",
  "DELETE_EDGE",
  "APPEND_VECTOR",
  "UPDATE_VECTOR",
  "DELETE_VECTOR",
  "EXTERNAL_CALL",
];
const CONDITION_OPERATORS = ["IS", "IS_NOT", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "CONTAINS"];

const stepLabels = computed(() => [
  ot("actionWizardStepIntent"),
  ot("actionWizardStepParameters"),
  ot("actionWizardStepRules"),
  ot("actionWizardStepCriteria"),
  ot("actionWizardStepReview"),
]);

const draftEdited = computed(
  () => Boolean(draft.value) && JSON.stringify(intent.value) !== snapshot.value
);

const draftDefinition = computed(() => draft.value?.definition ?? null);
const draftRuleCount = computed(() => intent.value.rules.length);
const draftParameterCount = computed(() => intent.value.parameters.length);

const unrepresentableText = computed({
  get: () => (intent.value.criteria?.unrepresentable ?? []).join("\n"),
  set: (value: string) => {
    if (!intent.value.criteria) return;
    intent.value.criteria.unrepresentable = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  },
});

function reset() {
  intent.value = emptyIntent();
  step.value = 0;
  messages.value = [{ role: "assistant", text: ot("actionWizardIntro") }];
  prompt.value = "";
  draft.value = null;
  snapshot.value = "";
  generating.value = false;
  saving.value = false;
  void nextTick(scrollBottom);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  }
);

function scrollBottom() {
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function addParameter() {
  intent.value.parameters.push({ name: "", type: "STRING", className: "", description: "" });
  void nextTick(scrollBottom);
}

function removeParameter(index: number) {
  intent.value.parameters.splice(index, 1);
}

function addRule() {
  intent.value.rules.push({
    kind: "UPDATE_OBJECT",
    object: intent.value.targetObject,
    field: "",
    value: "",
  });
}

function removeRule(index: number) {
  intent.value.rules.splice(index, 1);
}

function ensureCriteria() {
  if (!intent.value.criteria) {
    intent.value.criteria = { operator: "AND", conditions: [], unrepresentable: [] };
  }
}

function addCondition() {
  ensureCriteria();
  intent.value.criteria!.conditions.push({
    object: intent.value.targetObject,
    field: "",
    operator: "IS",
    value: "",
    message: "",
  });
}

function removeCondition(index: number) {
  intent.value.criteria?.conditions.splice(index, 1);
}

function clearCriteria() {
  intent.value.criteria = null;
}

function go(target: number) {
  if (target < step.value || target <= step.value + 1) step.value = Math.max(0, Math.min(4, target));
}

function next() {
  if (!validateStep(step.value, intent.value)) {
    message.warning(ot("actionWizardIncomplete"));
    return;
  }
  if (step.value < 4) step.value += 1;
}

async function runGeneration(question: string) {
  messages.value.push({ role: "user", text: question });
  generating.value = true;
  void nextTick(scrollBottom);
  try {
    const response = await requestSmartAsset("actions", "generateFromNatureLanguage", {
      question,
      persistence: false,
      structuredSpec: compileStructuredSpec(intent.value) ?? undefined,
    });
    const generated = response?.data ?? response;
    if (!generated) throw new Error(ot("actionWizardGenerateFailed"));
    draft.value = generated;
    intent.value = intentFromAction(generated);
    snapshot.value = JSON.stringify(intent.value);
    messages.value.push({
      role: "assistant",
      text: ot("actionWizardDraftReady", {
        name: generated.name || "—",
        rules: draftRuleCount.value,
        parameters: draftParameterCount.value,
      }),
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

async function regenerate() {
  if (generating.value) return;
  await runGeneration(intentInstruction(intent.value));
}

async function save() {
  if (!draft.value) {
    message.warning(ot("actionWizardNoDraft"));
    return;
  }
  if (draftEdited.value) {
    message.warning(ot("actionWizardStale"));
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
    width="min(1180px, 94vw)"
    top="5vh"
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
          <div v-for="(item, index) in messages" :key="index" :class="['msg', item.role]">
            {{ item.text }}
          </div>
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

      <aside class="wizard">
        <ol class="steps">
          <li
            v-for="(label, index) in stepLabels"
            :key="label"
            :class="{ active: step === index, done: step > index }"
            @click="go(index)"
          >
            <span class="dot">{{ index + 1 }}</span>
            <span class="step-label">{{ label }}</span>
          </li>
        </ol>

        <div class="step-body">
          <template v-if="step === 0">
            <label class="field">
              <span>{{ ot("actionWizardActionType") }}</span>
              <el-select v-model="intent.actionType">
                <el-option v-for="type in ACTION_TYPES" :key="type" :value="type" :label="type" />
              </el-select>
            </label>
            <label class="field">
              <span>{{ ot("actionWizardTargetObject") }}</span>
              <el-input v-model="intent.targetObject" placeholder="orders" />
            </label>
            <label class="field">
              <span>{{ ot("actionWizardName") }}</span>
              <el-input v-model="intent.name" :placeholder="ot('assetFieldName')" />
            </label>
            <label class="field">
              <span>{{ ot("actionWizardDescription") }}</span>
              <el-input v-model="intent.description" type="textarea" :rows="3" resize="none" />
            </label>
          </template>

          <template v-else-if="step === 1">
            <div class="rows">
              <div class="row row-head">
                <span>{{ ot("actionWizardParameterName") }}</span>
                <span>{{ ot("actionWizardParameterType") }}</span>
                <span>{{ ot("actionWizardParameterClass") }}</span>
                <span>{{ ot("actionWizardDescription") }}</span>
                <span />
              </div>
              <div v-for="(parameter, index) in intent.parameters" :key="index" class="row">
                <el-input v-model="parameter.name" placeholder="order_id" />
                <el-select v-model="parameter.type">
                  <el-option v-for="type in PARAMETER_TYPES" :key="type" :value="type" :label="type" />
                </el-select>
                <el-input v-model="parameter.className" placeholder="orders" />
                <el-input v-model="parameter.description" />
                <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeParameter(index)" />
              </div>
            </div>
            <el-button text :icon="Plus" @click="addParameter">{{ ot("actionWizardAddParameter") }}</el-button>
          </template>

          <template v-else-if="step === 2">
            <el-alert :title="ot('actionWizardDerived')" type="info" :closable="false" show-icon />
            <div class="rows">
              <div class="row row-head rule-row">
                <span>{{ ot("actionWizardRuleKind") }}</span>
                <span>{{ ot("actionWizardRuleObject") }}</span>
                <span>{{ ot("actionWizardRuleField") }}</span>
                <span>{{ ot("actionWizardRuleValue") }}</span>
                <span />
              </div>
              <div v-for="(rule, index) in intent.rules" :key="index" class="row rule-row">
                <el-select v-model="rule.kind">
                  <el-option v-for="kind in RULE_KINDS" :key="kind" :value="kind" :label="kind" />
                </el-select>
                <el-input v-model="rule.object" placeholder="orders" />
                <el-input v-model="rule.field" placeholder="status" />
                <el-input v-model="rule.value" placeholder="已发货 / order_id" />
                <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeRule(index)" />
              </div>
            </div>
            <el-button text :icon="Plus" @click="addRule">{{ ot("actionWizardAddRule") }}</el-button>
          </template>

          <template v-else-if="step === 3">
            <p class="hint">{{ ot("actionWizardCriteriaHint") }}</p>
            <template v-if="intent.criteria">
              <label class="field inline">
                <span>{{ ot("actionWizardCriteriaOperator") }}</span>
                <el-select v-model="intent.criteria.operator" class="small">
                  <el-option value="AND" label="AND" />
                  <el-option value="OR" label="OR" />
                </el-select>
              </label>
              <div v-for="(condition, index) in intent.criteria.conditions" :key="index" class="condition">
                <el-input v-model="condition.object" :placeholder="ot('actionWizardConditionClass')" />
                <el-input v-model="condition.field" :placeholder="ot('actionWizardConditionField')" />
                <el-select v-model="condition.operator" class="small">
                  <el-option v-for="operator in CONDITION_OPERATORS" :key="operator" :value="operator" :label="operator" />
                </el-select>
                <el-input v-model="condition.value" :placeholder="ot('actionWizardConditionValue')" />
                <el-input v-model="condition.message" :placeholder="ot('actionWizardConditionMessage')" />
                <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeCondition(index)" />
              </div>
              <div class="criteria-actions">
                <el-button text :icon="Plus" @click="addCondition">{{ ot("actionWizardAddCondition") }}</el-button>
                <el-button text @click="clearCriteria">{{ ot("actionWizardClearCriteria") }}</el-button>
              </div>
              <label class="field">
                <span>{{ ot("actionWizardUnrepresentable") }}</span>
                <el-input v-model="unrepresentableText" type="textarea" :rows="3" resize="none" />
              </label>
            </template>
            <template v-else>
              <p class="hint">{{ ot("actionWizardNoCriteria") }}</p>
              <el-button text :icon="Plus" @click="addCondition">{{ ot("actionWizardAddCondition") }}</el-button>
            </template>
          </template>

          <template v-else>
            <el-alert :title="ot('actionWizardReviewHint')" type="info" :closable="false" show-icon />
            <dl class="summary">
              <dt>{{ ot("actionWizardName") }}</dt>
              <dd>{{ intent.name || "—" }}</dd>
              <dt>{{ ot("actionWizardActionType") }}</dt>
              <dd>{{ intent.actionType }} · {{ intent.targetObject || "—" }}</dd>
              <dt>{{ ot("actionWizardStepParameters") }}</dt>
              <dd>{{ intent.parameters.length }}</dd>
              <dt>{{ ot("actionWizardStepRules") }}</dt>
              <dd>{{ intent.rules.length }}</dd>
              <dt>{{ ot("actionWizardStepCriteria") }}</dt>
              <dd>{{ intent.criteria ? intent.criteria.conditions.length : ot("actionWizardNoCriteria") }}</dd>
            </dl>
            <div v-if="draftDefinition" class="preview">
              <el-tag size="small" type="warning">{{ ot("actionWizardDerived") }}</el-tag>
              <span v-if="draftDefinition.codeHash" class="code-hash">{{ draftDefinition.codeHash.slice(0, 12) }}</span>
            </div>
            <el-alert
              v-if="draftEdited"
              :title="ot('actionWizardStale')"
              type="warning"
              :closable="false"
              show-icon
            />
            <el-alert v-if="!draft" :title="ot('actionWizardNoDraft')" type="info" :closable="false" show-icon />
          </template>
        </div>

        <footer class="wizard-actions">
          <el-button :disabled="step === 0" @click="step -= 1">{{ ot("actionWizardPrevious") }}</el-button>
          <el-button v-if="step < 4" type="primary" @click="next">{{ ot("actionWizardNext") }}</el-button>
          <template v-else>
            <el-button :icon="Sparkles" :loading="generating" @click="regenerate">
              {{ draft ? ot("actionWizardRegenerate") : ot("actionWizardFinish") }}
            </el-button>
            <el-button type="primary" :loading="saving" :disabled="!draft || draftEdited" @click="save">
              {{ ot("actionWizardSave") }}
            </el-button>
          </template>
        </footer>
      </aside>
    </div>
  </el-dialog>
</template>

<style scoped>
.action-create {
  display: flex;
  height: 70vh;
  min-height: 540px;
  margin: -10px 0;
}
.chat {
  display: flex;
  flex: 1.55;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--el-border-color-light);
}
.chat-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px 10px;
}
.chat-hint {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
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
  color: var(--el-text-color-primary);
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
.wizard {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 380px;
  background: var(--el-fill-color-lighter);
}
.steps {
  display: flex;
  gap: 2px;
  margin: 0;
  padding: 14px 16px 10px;
  list-style: none;
  overflow-x: auto;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  cursor: pointer;
  white-space: nowrap;
}
.steps li.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-weight: 600;
}
.steps li.done {
  color: var(--el-text-color-primary);
}
.dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--el-fill-color);
  font-size: 11px;
}
.steps li.active .dot {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
.step-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm, 13px);
}
.field.inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 1.05fr 0.85fr 0.85fr 1.3fr 32px;
  gap: 6px;
  align-items: center;
}
.row.rule-row {
  grid-template-columns: 1.15fr 0.9fr 0.8fr 1.1fr 32px;
}
.row-head {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
}
.condition {
  display: grid;
  grid-template-columns: 0.8fr 0.8fr 0.7fr 0.8fr 1fr 32px;
  gap: 6px;
  align-items: center;
}
.small {
  width: 96px;
}
.criteria-actions {
  display: flex;
  justify-content: space-between;
}
.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}
.summary {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px 12px;
  margin: 0;
}
.summary dt {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
.summary dd {
  margin: 0;
  color: var(--el-text-color-primary);
}
.preview {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code-hash {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs, 11px);
}
.wizard-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--el-border-color-light);
}
</style>

<style>
.action-create-dialog .el-dialog__body {
  padding: 10px 0 0;
}
</style>
