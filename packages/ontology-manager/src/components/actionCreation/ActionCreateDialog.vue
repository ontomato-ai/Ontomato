<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElDialog,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTag,
} from "element-plus";
import { Plus, Send, Sparkles, Trash2 } from "lucide-vue-next";
import { useManagerClient, useOntologyText } from "../../context";
import { useManagerFeedback } from "../../feedback";
import type { MessageKey } from "../../i18n";
import type { OntologyObject, OntologyRelation } from "../../api";
import {
  compileStructuredSpec,
  defaultOperation,
  emptyIntent,
  intentFromAction,
  intentInstruction,
  operationsFor,
  suggestedParameters,
  validateStep,
  type ActionIntent,
  type OperationFamily,
  type OperationKind,
} from "./intent";

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

const intent = ref<ActionIntent>(emptyIntent());
const step = ref(0);
const messages = ref<ChatMessage[]>([]);
const prompt = ref("");
const generating = ref(false);
const saving = ref(false);
const draft = ref<any>(null);
const snapshot = ref("");
const messagesEl = ref<HTMLElement | null>(null);
const ontology = ref<{ objects: OntologyObject[]; relations: OntologyRelation[] }>({
  objects: [],
  relations: [],
});
const ontologyLoading = ref(false);

const FAMILIES: OperationFamily[] = ["OBJECT", "RELATION", "VECTOR", "EXTERNAL"];
const FAMILY_LABEL: Record<OperationFamily, MessageKey> = {
  OBJECT: "actionWizardFamilyObject",
  RELATION: "actionWizardFamilyRelation",
  VECTOR: "actionWizardFamilyVector",
  EXTERNAL: "actionWizardFamilyExternal",
};
const FAMILY_HINT: Record<OperationFamily, MessageKey> = {
  OBJECT: "actionWizardFamilyObjectHint",
  RELATION: "actionWizardFamilyRelationHint",
  VECTOR: "actionWizardFamilyVectorHint",
  EXTERNAL: "actionWizardFamilyExternalHint",
};
const OP_LABEL: Record<OperationKind, MessageKey> = {
  CREATE_OBJECT: "actionWizardOpCreateObject",
  UPDATE_OBJECT: "actionWizardOpUpdateObject",
  DELETE_OBJECT: "actionWizardOpDeleteObject",
  CREATE_EDGE: "actionWizardOpCreateEdge",
  DELETE_EDGE: "actionWizardOpDeleteEdge",
  APPEND_VECTOR: "actionWizardOpAppendVector",
  UPDATE_VECTOR: "actionWizardOpUpdateVector",
  DELETE_VECTOR: "actionWizardOpDeleteVector",
  EXTERNAL_CALL: "actionWizardOpExternal",
};
const OP_HINT: Record<OperationKind, MessageKey> = {
  CREATE_OBJECT: "actionWizardOpCreateObjectHint",
  UPDATE_OBJECT: "actionWizardOpUpdateObjectHint",
  DELETE_OBJECT: "actionWizardOpDeleteObjectHint",
  CREATE_EDGE: "actionWizardOpCreateEdgeHint",
  DELETE_EDGE: "actionWizardOpDeleteEdgeHint",
  APPEND_VECTOR: "actionWizardOpAppendVectorHint",
  UPDATE_VECTOR: "actionWizardOpUpdateVectorHint",
  DELETE_VECTOR: "actionWizardOpDeleteVectorHint",
  EXTERNAL_CALL: "actionWizardOpExternalHint",
};

const STEP_KEYS = [
  { title: "actionWizardStepObject", hint: "actionWizardHintObject" },
  { title: "actionWizardStepOperation", hint: "actionWizardHintOperation" },
  { title: "actionWizardStepParameters", hint: "actionWizardHintParameters" },
  { title: "actionWizardStepConditions", hint: "actionWizardHintConditions" },
  { title: "actionWizardStepRules", hint: "actionWizardHintRules" },
  { title: "actionWizardStepReview", hint: "actionWizardHintReview" },
] as const satisfies ReadonlyArray<{ title: MessageKey; hint: MessageKey }>;

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
const CONDITION_OPERATORS = ["IS", "IS_NOT", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "CONTAINS"];

const classes = computed(() => ontology.value.objects);
const relations = computed(() => {
  const primary = intent.value.primaryClass;
  return ontology.value.relations.filter(
    (relation) => !primary || relation.fromclass === primary || relation.toclass === primary
  );
});
const selectedClass = computed(() =>
  classes.value.find((item) => item.className === intent.value.primaryClass)
);
const attributes = computed(() =>
  (selectedClass.value?.attrs ?? []).filter((attribute) => attribute.enable !== false)
);
const vectorAttributes = computed(() =>
  attributes.value.filter((attribute) => /vector|file/i.test(attribute.type))
);
const parameterNames = computed(() => intent.value.parameters.map((parameter) => parameter.name).filter(Boolean));

const stepTitle = computed(() => ot(STEP_KEYS[step.value].title));
const stepHint = computed(() => ot(STEP_KEYS[step.value].hint));

const draftEdited = computed(
  () => Boolean(draft.value) && JSON.stringify(intent.value) !== snapshot.value
);
const draftDefinition = computed(() => draft.value?.definition ?? null);

const unrepresentableText = computed({
  get: () => intent.value.unrepresentable.join("\n"),
  set: (value: string) => {
    intent.value.unrepresentable = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
  async (open) => {
    if (!open) return;
    reset();
    if (!classes.value.length && !ontologyLoading.value) {
      ontologyLoading.value = true;
      try {
        ontology.value = await loadOntology();
      } catch {
        // The wizard still accepts free-text class names when metadata is unavailable.
      } finally {
        ontologyLoading.value = false;
      }
    }
  }
);

function scrollBottom() {
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function selectFamily(family: OperationFamily) {
  intent.value.family = family;
  intent.value.operation = defaultOperation(family);
  if (family === "RELATION") {
    intent.value.relationRules.sourceClass = intent.value.primaryClass;
  }
}

function selectClass(className: string) {
  intent.value.primaryClass = className;
  for (const condition of intent.value.conditions) condition.className = className;
}

function selectRelation(relationship: string) {
  const relation = relations.value.find((item) => item.relationship === relationship);
  intent.value.relationRules.relation = relationship;
  intent.value.relationRules.sourceClass = relation?.fromclass || intent.value.primaryClass;
  intent.value.relationRules.targetClass = relation?.toclass || "";
}

function addParameter(parameter?: Partial<ActionIntent["parameters"][number]>) {
  intent.value.parameters.push({
    name: parameter?.name ?? "",
    type: parameter?.type ?? "STRING",
    className: parameter?.className ?? intent.value.primaryClass,
    description: parameter?.description ?? "",
  });
}

function suggestParameters() {
  for (const suggestion of suggestedParameters(intent.value)) {
    if (!intent.value.parameters.some((parameter) => parameter.name === suggestion.name)) {
      intent.value.parameters.push(suggestion);
    }
  }
}

function removeParameter(index: number) {
  intent.value.parameters.splice(index, 1);
}

function addCondition() {
  intent.value.conditions.push({
    className: intent.value.primaryClass,
    field: "",
    operator: "IS",
    value: "",
    message: "",
  });
}

function removeCondition(index: number) {
  intent.value.conditions.splice(index, 1);
}

function clearConditions() {
  intent.value.conditions = [];
  intent.value.unrepresentable = [];
}

function addAssignment() {
  intent.value.objectRules.assignments.push({ field: "", source: "CONSTANT", value: "" });
}

function removeAssignment(index: number) {
  intent.value.objectRules.assignments.splice(index, 1);
}

function go(target: number) {
  if (target < step.value) step.value = target;
}

function next() {
  if (!validateStep(step.value, intent.value)) {
    message.warning(ot("actionWizardIncomplete"));
    return;
  }
  if (step.value < STEP_KEYS.length - 1) step.value += 1;
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
        rules:
          intent.value.objectRules.assignments.length ||
          (intent.value.relationRules.relation ? 1 : 0) ||
          (intent.value.vectorRules.attribute ? 1 : 0) ||
          (intent.value.external.service ? 1 : 0),
        parameters: intent.value.parameters.length,
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

async function sendExample(text: string) {
  if (generating.value) return;
  prompt.value = text;
  await send();
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
          <div v-if="messages.length === 1 && !generating" class="examples">
            <button type="button" @click="sendExample(ot('actionWizardExample1'))">
              {{ ot("actionWizardExample1") }}
            </button>
            <button type="button" @click="sendExample(ot('actionWizardExample2'))">
              {{ ot("actionWizardExample2") }}
            </button>
            <button type="button" @click="sendExample(ot('actionWizardExample3'))">
              {{ ot("actionWizardExample3") }}
            </button>
          </div>
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
            v-for="(item, index) in STEP_KEYS"
            :key="item.title"
            :class="{ active: step === index, done: step > index }"
            @click="go(index)"
          >
            <span class="dot">{{ index + 1 }}</span>
            <span class="step-label">{{ ot(item.title) }}</span>
          </li>
        </ol>

        <div class="step-area">
          <header class="step-header">
            <h3>{{ stepTitle }}</h3>
            <p>{{ stepHint }}</p>
            <div class="path">
              <el-tag v-if="intent.primaryClass" size="small" effect="plain">{{ intent.primaryClass }}</el-tag>
              <el-tag size="small" effect="plain">{{ ot(FAMILY_LABEL[intent.family]) }}</el-tag>
              <el-tag size="small" effect="plain">{{ ot(OP_LABEL[intent.operation]) }}</el-tag>
              <el-tag v-if="intent.parameters.length" size="small" effect="plain">
                {{ intent.parameters.length }} {{ ot("actionWizardStepParameters") }}
              </el-tag>
              <el-tag v-if="intent.conditions.length" size="small" effect="plain">
                {{ intent.conditions.length }} {{ ot("actionWizardStepConditions") }}
              </el-tag>
            </div>
          </header>

          <div class="step-body">
            <template v-if="step === 0">
              <label class="field">
                <span>{{ ot("actionWizardObjectClass") }}</span>
                <el-select
                  v-model="intent.primaryClass"
                  filterable
                  allow-create
                  :loading="ontologyLoading"
                  :placeholder="ot('actionWizardObjectClassPlaceholder')"
                  @change="selectClass"
                >
                  <el-option
                    v-for="item in classes"
                    :key="item.className"
                    :value="item.className"
                    :label="`${item.showName} (${item.className})`"
                  />
                </el-select>
              </label>
              <div v-if="selectedClass" class="class-summary">
                <p>{{ selectedClass.classDesc }}</p>
                <span>{{ attributes.length }} {{ ot("actionWizardAttributeCount") }}</span>
              </div>
              <label class="field">
                <span>{{ ot("actionWizardName") }}</span>
                <el-input v-model="intent.name" :placeholder="ot('actionWizardNamePlaceholder')" />
              </label>
              <label class="field">
                <span>{{ ot("actionWizardDescription") }}</span>
                <el-input v-model="intent.description" type="textarea" :rows="3" resize="none" />
              </label>
            </template>

            <template v-else-if="step === 1">
              <div class="family-grid">
                <button
                  v-for="family in FAMILIES"
                  :key="family"
                  type="button"
                  :class="['family-card', { active: intent.family === family }]"
                  @click="selectFamily(family)"
                >
                  <strong>{{ ot(FAMILY_LABEL[family]) }}</strong>
                  <span>{{ ot(FAMILY_HINT[family]) }}</span>
                </button>
              </div>
              <div class="operation-list">
                <button
                  v-for="operation in operationsFor(intent.family)"
                  :key="operation"
                  type="button"
                  :class="['operation-card', { active: intent.operation === operation }]"
                  @click="intent.operation = operation"
                >
                  <strong>{{ ot(OP_LABEL[operation]) }}</strong>
                  <span>{{ ot(OP_HINT[operation]) }}</span>
                </button>
              </div>
            </template>

            <template v-else-if="step === 2">
              <p class="hint">{{ ot("actionWizardParametersExplain") }}</p>
              <el-button text :icon="Sparkles" @click="suggestParameters">
                {{ ot("actionWizardSuggestParameters") }}
              </el-button>
              <div class="rows">
                <div class="row row-head param-row">
                  <span>{{ ot("actionWizardParameterName") }}</span>
                  <span>{{ ot("actionWizardParameterType") }}</span>
                  <span>{{ ot("actionWizardParameterClass") }}</span>
                  <span>{{ ot("actionWizardDescription") }}</span>
                  <span />
                </div>
                <div v-for="(parameter, index) in intent.parameters" :key="index" class="row param-row">
                  <el-input v-model="parameter.name" placeholder="order_id" />
                  <el-select v-model="parameter.type">
                    <el-option v-for="type in PARAMETER_TYPES" :key="type" :value="type" :label="type" />
                  </el-select>
                  <el-input v-model="parameter.className" :placeholder="intent.primaryClass" />
                  <el-input v-model="parameter.description" />
                  <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeParameter(index)" />
                </div>
              </div>
              <el-button text :icon="Plus" @click="addParameter()">{{ ot("actionWizardAddParameter") }}</el-button>
            </template>

            <template v-else-if="step === 3">
              <p class="hint">{{ ot("actionWizardCriteriaHint") }}</p>
              <label class="field inline">
                <span>{{ ot("actionWizardCriteriaOperator") }}</span>
                <el-select v-model="intent.criteriaOperator" class="small">
                  <el-option value="AND" label="AND" />
                  <el-option value="OR" label="OR" />
                </el-select>
              </label>
              <div v-for="(condition, index) in intent.conditions" :key="index" class="condition">
                <el-select v-model="condition.field" filterable allow-create :placeholder="ot('actionWizardConditionField')">
                  <el-option
                    v-for="attribute in attributes"
                    :key="attribute.name"
                    :value="attribute.name"
                    :label="`${attribute.showName} (${attribute.name})`"
                  />
                </el-select>
                <el-select v-model="condition.operator" class="small">
                  <el-option v-for="operator in CONDITION_OPERATORS" :key="operator" :value="operator" :label="operator" />
                </el-select>
                <el-input v-model="condition.value" :placeholder="ot('actionWizardConditionValue')" />
                <el-input v-model="condition.message" :placeholder="ot('actionWizardConditionMessage')" />
                <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeCondition(index)" />
              </div>
              <div class="criteria-actions">
                <el-button text :icon="Plus" @click="addCondition">{{ ot("actionWizardAddCondition") }}</el-button>
                <el-button text @click="clearConditions">{{ ot("actionWizardClearCriteria") }}</el-button>
              </div>
              <label class="field">
                <span>{{ ot("actionWizardUnrepresentable") }}</span>
                <el-input v-model="unrepresentableText" type="textarea" :rows="3" resize="none" />
              </label>
            </template>

            <template v-else-if="step === 4">
              <template v-if="intent.family === 'OBJECT'">
                <label v-if="intent.operation !== 'CREATE_OBJECT'" class="field">
                  <span>{{ ot("actionWizardLocator") }}</span>
                  <el-select v-model="intent.objectRules.locator" filterable allow-create :placeholder="ot('actionWizardLocatorPlaceholder')">
                    <el-option v-for="name in parameterNames" :key="name" :value="name" :label="name" />
                  </el-select>
                  <small>{{ ot("actionWizardLocatorHint") }}</small>
                </label>
                <div class="rows">
                  <div class="row row-head assignment-row">
                    <span>{{ ot("actionWizardField") }}</span>
                    <span>{{ ot("actionWizardValueSource") }}</span>
                    <span>{{ ot("actionWizardRuleValue") }}</span>
                    <span />
                  </div>
                  <div v-for="(rule, index) in intent.objectRules.assignments" :key="index" class="row assignment-row">
                    <el-select v-model="rule.field" filterable allow-create :placeholder="ot('actionWizardField')">
                      <el-option
                        v-for="attribute in attributes"
                        :key="attribute.name"
                        :value="attribute.name"
                        :label="`${attribute.showName} (${attribute.name})`"
                      />
                    </el-select>
                    <el-select v-model="rule.source">
                      <el-option value="CONSTANT" :label="ot('actionWizardSourceConstant')" />
                      <el-option value="PARAMETER" :label="ot('actionWizardSourceParameter')" />
                      <el-option value="EXPRESSION" :label="ot('actionWizardSourceExpression')" />
                    </el-select>
                    <el-select
                      v-if="rule.source === 'PARAMETER'"
                      v-model="rule.value"
                      filterable
                      allow-create
                      :placeholder="ot('actionWizardRuleValue')"
                    >
                      <el-option v-for="name in parameterNames" :key="name" :value="name" :label="name" />
                    </el-select>
                    <el-input v-else v-model="rule.value" :placeholder="ot('actionWizardRuleValue')" />
                    <el-button text :icon="Trash2" :aria-label="ot('actionWizardRemove')" @click="removeAssignment(index)" />
                  </div>
                </div>
                <el-button text :icon="Plus" @click="addAssignment">{{ ot("actionWizardAddAssignment") }}</el-button>
                <label v-if="intent.operation === 'DELETE_OBJECT'" class="check">
                  <el-checkbox v-model="intent.objectRules.deleteRelations" />
                  <span>{{ ot("actionWizardDeleteRelations") }}</span>
                </label>
              </template>

              <template v-else-if="intent.family === 'RELATION'">
                <label class="field">
                  <span>{{ ot("actionWizardRelation") }}</span>
                  <el-select v-model="intent.relationRules.relation" filterable :placeholder="ot('actionWizardRelationPlaceholder')" @change="selectRelation">
                    <el-option
                      v-for="relation in relations"
                      :key="relation.relationship"
                      :value="relation.relationship"
                      :label="`${relation.showName} (${relation.relationship})`"
                    />
                  </el-select>
                </label>
                <div class="relation-grid">
                  <label class="field">
                    <span>{{ ot("actionWizardSourceObject") }}</span>
                    <el-input v-model="intent.relationRules.sourceClass" />
                    <el-select v-model="intent.relationRules.sourceId" filterable allow-create :placeholder="ot('actionWizardObjectId')">
                      <el-option v-for="name in parameterNames" :key="name" :value="name" :label="name" />
                    </el-select>
                  </label>
                  <label class="field">
                    <span>{{ ot("actionWizardTargetObject") }}</span>
                    <el-input v-model="intent.relationRules.targetClass" />
                    <el-select v-model="intent.relationRules.targetId" filterable allow-create :placeholder="ot('actionWizardObjectId')">
                      <el-option v-for="name in parameterNames" :key="name" :value="name" :label="name" />
                    </el-select>
                  </label>
                </div>
              </template>

              <template v-else-if="intent.family === 'VECTOR'">
                <label class="field">
                  <span>{{ ot("actionWizardVectorAttribute") }}</span>
                  <el-select v-model="intent.vectorRules.attribute" filterable allow-create :placeholder="ot('actionWizardVectorAttributePlaceholder')">
                    <el-option
                      v-for="attribute in vectorAttributes"
                      :key="attribute.name"
                      :value="attribute.name"
                      :label="`${attribute.showName} (${attribute.name})`"
                    />
                  </el-select>
                </label>
                <label class="field">
                  <span>{{ ot("actionWizardVectorSource") }}</span>
                  <el-radio-group v-model="intent.vectorRules.source">
                    <el-radio value="TEXT">{{ ot("actionWizardVectorText") }}</el-radio>
                    <el-radio value="FILE">{{ ot("actionWizardVectorFile") }}</el-radio>
                  </el-radio-group>
                </label>
                <label class="field">
                  <span>{{ ot("actionWizardVectorValue") }}</span>
                  <el-select v-model="intent.vectorRules.value" filterable allow-create :placeholder="ot('actionWizardRuleValue')">
                    <el-option v-for="name in parameterNames" :key="name" :value="name" :label="name" />
                  </el-select>
                </label>
              </template>

              <template v-else>
                <label class="field">
                  <span>{{ ot("actionWizardExternalService") }}</span>
                  <el-input v-model="intent.external.service" placeholder="inventory-service" />
                </label>
                <label class="field">
                  <span>{{ ot("actionWizardExternalAction") }}</span>
                  <el-input v-model="intent.external.action" placeholder="reserve" />
                </label>
                <label class="field">
                  <span>{{ ot("actionWizardExternalPayload") }}</span>
                  <el-input v-model="intent.external.payload" type="textarea" :rows="3" resize="none" />
                </label>
                <label class="field">
                  <span>{{ ot("actionWizardExternalOutput") }}</span>
                  <el-input v-model="intent.external.output" />
                </label>
              </template>

              <p class="hint">{{ ot("actionWizardRulesExplain") }}</p>
            </template>

            <template v-else>
              <el-alert :title="ot('actionWizardReviewHint')" type="info" :closable="false" show-icon />
              <dl class="summary">
                <dt>{{ ot("actionWizardStepObject") }}</dt>
                <dd>{{ intent.primaryClass || "—" }}{{ selectedClass ? ` · ${selectedClass.showName}` : "" }}</dd>
                <dt>{{ ot("actionWizardStepOperation") }}</dt>
                <dd>{{ ot(FAMILY_LABEL[intent.family]) }} · {{ ot(OP_LABEL[intent.operation]) }}</dd>
                <dt>{{ ot("actionWizardStepParameters") }}</dt>
                <dd>{{ intent.parameters.length ? intent.parameters.map((item) => item.name).join(", ") : "—" }}</dd>
                <dt>{{ ot("actionWizardStepConditions") }}</dt>
                <dd>
                  {{
                    intent.conditions.length
                      ? intent.conditions
                          .map((item) => `${item.className}.${item.field} ${item.operator} ${item.value}`)
                          .join(` ${intent.criteriaOperator} `)
                      : ot("actionWizardNoCriteria")
                  }}
                </dd>
                <dt>{{ ot("actionWizardStepRules") }}</dt>
                <dd>{{ ot("actionWizardRulesSummary", { count: intent.objectRules.assignments.length + (intent.relationRules.relation ? 1 : 0) + (intent.vectorRules.attribute ? 1 : 0) + (intent.external.service ? 1 : 0) }) }}</dd>
              </dl>
              <div v-if="draftDefinition" class="preview">
                <el-tag size="small" type="warning">{{ ot("actionWizardDerived") }}</el-tag>
                <span v-if="draftDefinition.codeHash" class="code-hash">{{ draftDefinition.codeHash.slice(0, 12) }}</span>
              </div>
              <el-alert v-if="draftEdited" :title="ot('actionWizardStale')" type="warning" :closable="false" show-icon />
              <el-alert v-if="!draft" :title="ot('actionWizardNoDraft')" type="info" :closable="false" show-icon />
            </template>
          </div>

          <footer class="wizard-actions">
            <el-button :disabled="step === 0" @click="step -= 1">{{ ot("actionWizardPrevious") }}</el-button>
            <el-button v-if="step < 5" type="primary" @click="next">{{ ot("actionWizardNext") }}</el-button>
            <template v-else>
              <el-button :icon="Sparkles" :loading="generating" @click="regenerate">
                {{ draft ? ot("actionWizardRegenerate") : ot("actionWizardFinish") }}
              </el-button>
              <el-button type="primary" :loading="saving" :disabled="!draft || draftEdited" @click="save">
                {{ ot("actionWizardSave") }}
              </el-button>
            </template>
          </footer>
        </div>
      </aside>
    </div>
  </el-dialog>
</template>

<style scoped>
.action-create {
  display: flex;
  height: 72vh;
  min-height: 560px;
  margin: -10px 0;
}
.chat {
  display: flex;
  flex: 1.4;
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
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.examples button {
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  background: transparent;
  color: var(--el-text-color-regular);
  padding: 5px 10px;
  font: inherit;
  font-size: var(--text-xs, 12px);
  cursor: pointer;
}
.examples button:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
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
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  flex: 1;
  min-width: 430px;
  background: var(--el-fill-color-lighter);
}
.steps {
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 16px 10px;
  list-style: none;
  border-right: 1px solid var(--el-border-color-light);
}
.steps li {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 9px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  cursor: pointer;
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
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--el-fill-color);
  font-size: 11px;
}
.steps li.active .dot {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
.step-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.step-header {
  padding: 14px 18px 8px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.step-header h3 {
  margin: 0 0 3px;
  font-size: var(--text-md, 15px);
}
.step-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}
.path {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.step-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.field small,
.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}
.class-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
.class-summary p {
  margin: 0;
}
.family-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.family-card,
.operation-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  text-align: start;
  font: inherit;
  cursor: pointer;
}
.family-card span,
.operation-card span {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
  line-height: 1.4;
}
.family-card.active,
.operation-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.operation-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.row {
  display: grid;
  gap: 6px;
  align-items: center;
}
.row-head {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
}
.param-row {
  grid-template-columns: 1fr 0.9fr 0.9fr 1.2fr 30px;
}
.assignment-row {
  grid-template-columns: 1.1fr 0.9fr 1.2fr 30px;
}
.condition {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 0.9fr 1fr 30px;
  gap: 6px;
  align-items: center;
}
.criteria-actions {
  display: flex;
  justify-content: space-between;
}
.relation-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm, 13px);
}
.small {
  width: 92px;
}
.summary {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 9px 12px;
  margin: 0;
}
.summary dt {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
.summary dd {
  margin: 0;
  overflow-wrap: anywhere;
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
