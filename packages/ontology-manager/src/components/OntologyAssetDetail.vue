<script setup lang="ts">
import ElDialog from "../ManagerDialog.vue";
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeft, Play, Plus, Save, Sparkles, Trash2 } from "lucide-vue-next";
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag,
  vLoading,
} from "element-plus";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { useManagerFeedback } from "../feedback";
import type { SmartAsset } from "../api";
import type { AssetTab } from "../workspace";
import ActionCodeExplainer from "./codeExplainer/ActionCodeExplainer.vue";
import ActionCreateDialog from "./actionCreation/ActionCreateDialog.vue";
import BusinessMeaning from "./codeExplainer/BusinessMeaning.vue";
import { normalizeBusinessMeaning, normalizeCodeSegments } from "./codeExplainer/codeSegments";
import { useManagerClient, useOntologyText } from "../context";

type AssetRecord = Record<string, any>;
type BindingDraft = { id?: string; name: string; description: string; questions: string; values: Record<string, string> };

const props = defineProps<{
  kind: AssetTab;
  asset?: SmartAsset | null;
  creating?: boolean;
}>();
const emit = defineEmits<{ back: []; saved: []; created: [] }>();

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { requestSmartAsset } = useManagerClient();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const testing = ref(false);
const record = ref<AssetRecord | null>(null);
const packageDraft = ref("");
const columnLabelsDraft = ref("{}");
const bindingDrafts = ref<BindingDraft[]>([]);
const testBinding = ref<number>(-1);
const testValues = ref<Record<string, string>>({});

function valueTexts(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
}
function parsedValues(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    try { return [key, JSON.parse(value)]; }
    catch { throw new Error(ot("metricInvalidParameter", { name: key })); }
  }));
}
function serializedBindings() {
  return bindingDrafts.value.map((binding) => ({
    ...(binding.id ? { id: binding.id } : {}), name: binding.name,
    description: binding.description, parameters: parsedValues(binding.values),
    matchQuestions: binding.questions.split(/\r?\n/).map((q) => q.trim()).filter(Boolean),
  }));
}
function addBinding() {
  bindingDrafts.value.push({ name: "", description: "", questions: "", values:
    Object.fromEntries(metricParameters.value.map((p: AssetRecord) => [p.name, "null"])) });
}
function testParameters() {
  return testBinding.value < 0 ? parsedValues(testValues.value)
    : parsedValues(bindingDrafts.value[testBinding.value]!.values);
}
function testMetricDraft() {
  const draft = JSON.parse(JSON.stringify(record.value)) as AssetRecord;
  if (packageDraft.value.trim()) prepareQueryPackage(draft.function);
  const values = testParameters();
  for (const parameter of draft.function.parameters || []) parameter.value = values[parameter.name];
  if (draft.function.queryPackage)
    for (const parameter of draft.function.queryPackage.manifest.parameterDefs) parameter.value = values[parameter.name];
  draft.bindings = serializedBindings();
  return draft;
}

const showGeneration = ref(false);
const metricGenerationPrompt = ref("");
const metricGenerationVisible = ref(false);
const metricGenerating = ref(false);
const testVisible = ref(false);
const testTab = ref("markdown");
const testMarkdown = ref("");
const markdownView = ref("preview");
const testJson = ref("");

const meta = computed(() => {
  const titles = {
    metrics: ot("assetKindMetrics"),
    actions: ot("assetKindActions"),
    functions: ot("assetKindFunctions"),
  };
  return { title: titles[props.kind] };
});

const canDelete = computed(() => Boolean(record.value?.id) && record.value?.origin !== "SYSTEM");
const isFunction = computed(() => props.kind === "functions");
const functionRecord = computed(() =>
  props.kind === "functions" ? record.value : record.value?.function || null
);
const readFunction = computed(() => functionRecord.value?.operation === "OPERATION_READ");
function prepareQueryPackage(fn: AssetRecord) {
  if (fn?.operation !== "OPERATION_READ") return;
  fn.queryPackage = JSON.parse(packageDraft.value);
  fn.code = null;
  fn.returnDef = { ...fn.returnDef, columnLabels: JSON.parse(columnLabelsDraft.value) };
  fn.parameters = fn.queryPackage.manifest.parameterDefs;
}
const metricParameters = computed(() => {
  if (readFunction.value && packageDraft.value) {
    try { return JSON.parse(packageDraft.value).manifest.parameterDefs as AssetRecord[]; }
    catch { /* Save and test report invalid source drafts. */ }
  }
  return Array.isArray(record.value?.function?.parameters) ? record.value.function.parameters : [];
});
const parameterTypes = [
  "TYPE_STRING",
  "TYPE_NUMBER",
  "TYPE_TIME",
  "TYPE_STRING_ARRAY",
  "TYPE_NUMBER_ARRAY",
  "TYPE_TIME_ARRAY",
];
const returnClassText = computed({
  get: () => (functionRecord.value?.returnDef?.classNames || []).join(", "),
  set: (value: string) => {
    if (!functionRecord.value) return;
    functionRecord.value.returnDef = functionRecord.value.returnDef || {};
    functionRecord.value.returnDef.classNames = value
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
  },
});
const matchQuestionText = computed({
  get: () => (record.value?.matchQuestions || []).join("\n"),
  set: (value: string) => {
    if (!record.value) return;
    record.value.matchQuestions = value
      .split(/\r?\n/)
      .map((item: string) => item.trim())
      .filter(Boolean);
  },
});

// The explanation tab belongs only to actions with segments; other assets and actions without segments show no tab bar.
const activeTab = ref<"definition" | "explainer">("definition");
const savedCodeSnapshot = ref("");

const editedCode = computed(() => {
  const code = record.value?.function?.code;
  return typeof code === "string" ? code : "";
});

const explainerState = computed(() => {
  if (props.kind !== "actions") return null;
  const raw = record.value?.codeSegments;
  if (raw === null || raw === undefined) return null;
  return normalizeCodeSegments(raw);
});

// Show the tab whenever there is an explanation: a normalized one is non-empty; an invalid format shows an error in the tab.
const showExplainerTab = computed(() => explainerState.value !== null);

const explainerSegments = computed(() => {
  const state = explainerState.value;
  return state && state.ok ? state.segments : [];
});

// When the editor has unsaved changes relative to the saved code, the explanation tab warns and still renders the saved version.
const codeDirty = computed(() => editedCode.value !== savedCodeSnapshot.value);

// Business meaning reflects the saved code and is read-only; its dirty state reuses the explanation tab's check instead of a separate one.
const businessMeaning = computed(() =>
  props.kind === "actions" ? normalizeBusinessMeaning(record.value?.businessMeaning) : null
);

// Derived, read-only projection attached by the action API. It is not an execution definition.
const actionDefinition = computed(() =>
  props.kind === "actions" ? record.value?.definition ?? null : null
);

const parameterNames = computed(() =>
  (actionDefinition.value?.parameters || []).map((parameter: any) => parameter.name)
);
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch
  );
}
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderValueFrom(valueFrom: string) {
  const text = escapeHtml(valueFrom || "");
  const names = parameterNames.value.slice().sort((a: string, b: string) => b.length - a.length);
  if (!names.length) return text;
  const pattern = new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "g");
  return text.replace(
    pattern,
    (name) =>
      `<span class="param-link" data-param="${name}" title="查看参数说明">${name}</span>`
  );
}
function onParamClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest("[data-param]");
  if (!target) return;
  const name = target.getAttribute("data-param");
  const row = name ? document.getElementById(`param-row-${name}`) : null;
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("param-flash");
  window.setTimeout(() => row.classList.remove("param-flash"), 1400);
}
const businessMeaningForDisplay = computed(() => {
  const meaning = businessMeaning.value;
  if (!meaning) return null;
  const hasRules = (actionDefinition.value?.effects || []).length > 0;
  if (!hasRules) return meaning;
  return meaning.negativeEffect ? { ...meaning, operations: [] } : null;
});
function effectLabel(kind: string) {
  switch (kind) {
    case "CREATE_OBJECT": return ot("actionDefinitionCreateObject");
    case "UPDATE_OBJECT": return ot("actionDefinitionUpdateObject");
    case "DELETE_OBJECT": return ot("actionDefinitionDeleteObject");
    case "CREATE_EDGE": return ot("actionDefinitionCreateEdge");
    case "DELETE_EDGE": return ot("actionDefinitionDeleteEdge");
    case "APPEND_VECTOR": return ot("actionDefinitionAppendVector");
    case "UPDATE_VECTOR": return ot("actionDefinitionUpdateVector");
    case "DELETE_VECTOR": return ot("actionDefinitionDeleteVector");
    case "EXTERNAL_CALL": return ot("actionDefinitionExternal");
    default: return kind;
  }
}
const ruleGroups = computed(() => {
  const groups = [
    { key: "create", label: ot("actionDefinitionGroupCreate"), kinds: ["CREATE_OBJECT"] },
    { key: "modify", label: ot("actionDefinitionGroupUpdate"), kinds: ["UPDATE_OBJECT"] },
    { key: "delete", label: ot("actionDefinitionGroupDelete"), kinds: ["DELETE_OBJECT"] },
    { key: "link", label: ot("actionDefinitionGroupLink"), kinds: ["CREATE_EDGE", "DELETE_EDGE"] },
    { key: "vector", label: ot("actionDefinitionGroupVector"), kinds: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"] },
    { key: "other", label: ot("actionDefinitionGroupOther"), kinds: ["EXTERNAL_CALL"] },
  ];
  const effects = actionDefinition.value?.effects || [];
  return groups.map((group) => ({
    ...group,
    items: effects.filter((effect: any) => group.kinds.includes(effect.kind)),
  })).filter((group) => group.items.length > 0);
});
const ruleLabel = (kind: string) => effectLabel(kind);
const ruleTarget = (rule: any) => {
  if (rule.relation)
    return ot("actionDefinitionRelationTarget", {
      source: rule.sourceClass || "?",
      target: rule.targetClass || "?",
      relation: rule.relation,
    });
  return rule.className || "—";
};
const submissionCriteria = computed(() => actionDefinition.value?.submissionCriteria ?? null);
const criteriaConditions = computed(() => submissionCriteria.value?.conditions || []);
const criteriaOperator = computed(() => submissionCriteria.value?.operator || "AND");
const criteriaUnrepresentable = computed(() => submissionCriteria.value?.unrepresentable || []);
function criterionText(condition: any): string {
  if (!condition) return "";
  if (condition.kind === "PROPERTY")
    return `${condition.className || condition.objectParameter || "?"}.${condition.field} ${condition.operator} ${JSON.stringify(condition.value)}`;
  if (condition.kind === "LINK_EXISTS")
    return ot("actionDefinitionLinkExists", {
      source: condition.from || condition.objectParameter || "?",
      relation: condition.relation,
    });
  return condition.description || condition.kind || "—";
}
function criterionMessage(condition: any): string {
  return condition?.message || condition?.failureMessage || "";
}
function guardText(condition: any): string {
  if (!condition) return "";
  if (condition.properties) return guardText(condition.properties);
  if (condition.operator === "logic") {
    const and = (condition.and || []).map(guardText).filter(Boolean);
    const or = (condition.or || []).map(guardText).filter(Boolean);
    if (and.length) return and.join(" 且 ");
    if (or.length) return or.join(" 或 ");
    return "";
  }
  if (!condition.field) return "";
  const value = condition.value === undefined ? "" : ` ${JSON.stringify(condition.value)}`;
  return `${condition.field} ${condition.operator}${value}`;
}

// The snapshot syncs only when record is reassigned (not deep): new load paths are not missed and editor changes do not trigger it.
watch(
  () => record.value,
  () => {
    savedCodeSnapshot.value = editedCode.value;
    const fn = functionRecord.value;
    packageDraft.value = fn?.queryPackage ? JSON.stringify(fn.queryPackage, null, 2) : "";
    const labels = fn?.returnDef?.columnLabels ?? Object.fromEntries((fn?.returnDef?.sourceAnalysis?.nodes ?? [])
      .filter((node: AssetRecord) => node.kind === "output").map((node: AssetRecord) => [node.key, node.label]));
    columnLabelsDraft.value = JSON.stringify(labels, null, 2);
    bindingDrafts.value = (record.value?.bindings || []).map((binding: AssetRecord) => ({
      id: binding.id, name: binding.name, description: binding.description || "",
      questions: (binding.matchQuestions || []).join("\n"), values: valueTexts(binding.parameters),
    }));
  }
);

function createRecord(kind: AssetTab): AssetRecord {
  if (kind === "metrics") {
    return {
      name: "",
      description: "",
      origin: "USER",
      bindings: [],
      status: "PENDING_REVIEW",
      matchQuestions: [],
      function: {
        name: "",
        origin: "USER",
        operation: "OPERATION_READ",
        description: "",
        parameters: [],
        returnDef: { isVoid: false, outKeyRefs: [], value: {}, classNames: [] },
        code: "",
        logic: "",
      },
    };
  }
  if (kind === "functions") {
    return {
      name: "",
      description: "",
      origin: "USER",
      operation: "OPERATION_READ",
      parameters: [],
      returnDef: { isVoid: false, outKeyRefs: [], value: {}, classNames: [] },
      code: "",
      logic: "",
    };
  }
  return {
    name: "",
    description: "",
    status: "STOPPED",
    cron: "",
    function: null,
  };
}

async function loadDetail() {
  if (props.creating && props.kind !== "actions") {
    record.value = createRecord(props.kind);
    return;
  }
  if (props.creating && props.kind === "actions") {
    showGeneration.value = true;
    return;
  }
  if (!props.asset?.id) {
    record.value = props.asset ? structuredClone(props.asset) : null;
    return;
  }
  loading.value = true;
  try {
    const response = await requestSmartAsset(props.kind, "queryById", { id: props.asset.id });
    record.value = structuredClone(response?.data ?? response);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetLoadDetailFailed"));
    record.value = null;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!record.value) return;
  if (!record.value.name?.trim()) {
    message.warning(ot("assetNameRequired"));
    return;
  }
  saving.value = true;
  try {
    const isAction = props.kind === "actions";
    const codeChanged = isAction && codeDirty.value;
    // Recalculation happens synchronously in the save request, so actions with code changes first warn that it may take a while.
    if (codeChanged) message.info(ot("explainerRegenerating"));
    if (readFunction.value) prepareQueryPackage(functionRecord.value!);
    const payload = props.kind === "metrics" ? { ...record.value, bindings: serializedBindings() } : record.value;
    await requestSmartAsset(props.kind, "save", payload);
    message.success(ot("assetSaved", { title: meta.value.title }));
    if (props.creating) {
      emit("created");
    } else if (isAction) {
      // Existing actions stay on the detail page: tell the parent to refresh the catalog, then reload this record.
      emit("saved");
      await loadDetail();
      if (codeChanged && explainerSegments.value.length === 0) {
        message.warning(ot("explainerNotGenerated"));
      }
      return;
    } else {
      emit("saved");
    }
    emit("back");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!record.value?.id) return;
  try {
    await confirm(
      ot("assetDeleteConfirm", { name: record.value.name }),
      ot("assetDeleteConfirmTitle")
    );
    deleting.value = true;
    await requestSmartAsset(props.kind, "delete", { id: record.value.id });
    message.success(ot("assetDeleted", { title: meta.value.title }));
    emit("saved");
    emit("back");
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("assetDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

function addParameter() {
  if (!functionRecord.value) return;
  functionRecord.value.parameters = functionRecord.value.parameters || [];
  functionRecord.value.parameters.push({
    name: "",
    type: "TYPE_STRING",
    description: "",
    sample: "",
    value: "",
    classNames: [],
  });
}

function removeParameter(index: string | number) {
  functionRecord.value?.parameters?.splice(Number(index), 1);
}

function parameterClassNamesText(parameter: AssetRecord) {
  return Array.isArray(parameter.classNames) ? parameter.classNames.join(", ") : "";
}

function updateParameterClassNames(parameter: AssetRecord, value: string) {
  parameter.classNames = value
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean);
}

function openMetricTest() {
  markdownView.value = "preview";
  testMarkdown.value = "";
  testJson.value = "";
  testTab.value = "markdown";
  testBinding.value = -1;
  testValues.value = valueTexts(Object.fromEntries(metricParameters.value.map((p: AssetRecord) => [p.name, p.value ?? null])));
  testVisible.value = true;
}

async function testMetricView() {
  if (!record.value) return;
  testing.value = true;
  try {
    const response = await requestSmartAsset("metrics", "test", testMetricDraft());
    testMarkdown.value = response?.data?.md || ot("metricTestNoResult");
    markdownView.value = "preview";
    testTab.value = "markdown";
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricTestFailed"));
  } finally {
    testing.value = false;
  }
}

async function testExecuteMetricView() {
  if (!record.value) return;
  if (record.value.status !== "PUBLISHED") {
    message.warning(ot("metricJsonTestPublishedOnly"));
    return;
  }
  testing.value = true;
  try {
    const response = await requestSmartAsset("metrics", "testExecute", {
      metricView: testMetricDraft(), param: testParameters(),
    });
    testJson.value = JSON.stringify(response?.data ?? null, null, 2);
    testTab.value = "json";
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricJsonTestFailed"));
  } finally {
    testing.value = false;
  }
}

function onActionCreated() {
  emit("created");
  emit("back");
}

async function generateMetricView() {
  const question = metricGenerationPrompt.value.trim();
  if (!question) {
    message.warning(ot("metricPromptRequired"));
    return;
  }
  metricGenerating.value = true;
  try {
    const response = await requestSmartAsset("metrics", "generateFromNatureLanguage", {
      question,
      persistence: false,
    });
    const generated = response?.data ?? response;
    if (!generated) throw new Error(ot("metricNotGenerated"));
    const draft: AssetRecord = structuredClone(generated);
    if (!Array.isArray(draft.matchQuestions) || !draft.matchQuestions.length) {
      draft.matchQuestions = [question];
    }
    record.value = draft;
    metricGenerationVisible.value = false;
    message.success(ot("metricDraftGenerated"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricGenerateFailed"));
  } finally {
    metricGenerating.value = false;
  }
}

watch([() => props.kind, () => props.asset?.id, () => props.creating], () => void loadDetail());
onMounted(() => void loadDetail());
</script>

<template>
  <section
    v-loading="loading"
    :class="['asset-detail', { 'with-explainer-tab': showExplainerTab }]"
  >
    <header class="detail-titlebar platform-page-gutter">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("assetBackTo", { title: meta.title }) }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ record?.name || ot("assetNew", { title: meta.title }) }}</strong>
      </span>
      <span class="title-spacer"></span>
      <el-button v-if="kind === 'metrics' && record" :icon="Play" @click="openMetricTest">
        {{ ot("assetTest") }}
      </el-button>
      <el-button
        v-if="kind === 'metrics' && creating"
        :icon="Sparkles"
        @click="metricGenerationVisible = true"
      >
        {{ ot("assetGenerateFromNl") }}
      </el-button>
      <el-button
        v-if="canDelete"
        type="danger"
        plain
        :icon="Trash2"
        :loading="deleting"
        @click="remove"
      >
        {{ ot("delete") }}
      </el-button>
      <el-button v-if="record" type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("save") }}
      </el-button>
    </header>

    <nav v-if="record && showExplainerTab" class="detail-tabs platform-page-gutter" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'definition'"
        :class="['detail-tab', { 'is-active': activeTab === 'definition' }]"
        @click="activeTab = 'definition'"
      >
        {{ ot("assetTabDefinition") }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'explainer'"
        :class="['detail-tab', { 'is-active': activeTab === 'explainer' }]"
        @click="activeTab = 'explainer'"
      >
        {{ ot("assetTabCodeExplainer") }}
      </button>
    </nav>

    <div
      v-if="record && showExplainerTab"
      v-show="activeTab === 'explainer'"
      class="explainer-pane platform-page-gutter"
      role="tabpanel"
    >
      <el-alert
        v-if="codeDirty"
        :title="ot('explainerStale')"
        type="warning"
        show-icon
        :closable="false"
      />
      <el-alert
        v-if="explainerState && !explainerState.ok"
        :title="ot('explainerInvalid')"
        type="error"
        show-icon
        :closable="false"
      />
      <ActionCodeExplainer v-else :code="savedCodeSnapshot" :segments="explainerSegments" />
    </div>

    <div
      v-if="record"
      v-show="!showExplainerTab || activeTab === 'definition'"
      class="detail-body platform-page-gutter"
      :class="{ 'metric-detail-body': kind === 'metrics' }"
    >
      <div class="definition-column">
      <section class="definition-section">
        <div class="section-title">
          <div>
            <h1>{{ meta.title }}</h1>
          </div>
        </div>
        <el-form label-position="top" class="asset-form">
          <el-form-item :label="ot('assetFieldName')">
            <el-input v-model="record.name" />
          </el-form-item>
          <el-form-item :label="ot('description')">
            <el-input v-model="record.description" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item v-if="!isFunction" :label="ot('status')">
            <el-select v-model="record.status">
              <el-option :label="ot('assetStatusPendingReview')" value="PENDING_REVIEW" />
              <el-option :label="ot('published')" value="PUBLISHED" />
              <el-option :label="ot('unused')" value="UNUSED" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="kind === 'metrics'" :label="ot('assetMatchQuestions')">
            <el-input
              v-model="matchQuestionText"
              type="textarea"
              :rows="3"
              :placeholder="ot('assetMatchQuestionsPlaceholder')"
            />
          </el-form-item>
          <el-form-item v-if="isFunction" :label="ot('assetOperationType')">
            <el-radio-group v-model="record.operation" :disabled="Boolean(record.id)">
              <el-radio value="OPERATION_READ">{{ ot("assetOperationRead") }}</el-radio>
              <el-radio value="OPERATION_WRITE">{{ ot("assetOperationWrite") }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>

      <section v-if="kind === 'actions' && actionDefinition" class="action-definition" @click="onParamClick">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("actionDefinitionTitle") }}</span>
            <h2>{{ ot("actionDefinitionRules") }}</h2>
          </div>
          <el-tag size="small" type="info">{{ ot("actionDefinitionDerivedUnverified") }}</el-tag>
        </div>
        <p class="text-muted">{{ ot("actionDefinitionRulesHint") }}</p>
        <div class="definition-objects">
          <el-tag v-for="name in actionDefinition.objects || []" :key="name" size="small">
            {{ name }}
          </el-tag>
        </div>
        <div v-for="group in ruleGroups" :key="group.key" class="rule-group">
          <h3 class="rule-group-title">
            {{ group.label }}
            <span class="rule-count">{{ group.items.length }}</span>
          </h3>
          <div v-for="(rule, index) in group.items" :key="index" class="rule-row">
            <div class="rule-head">
              <el-tag size="small">{{ ruleLabel(rule.kind) }}</el-tag>
              <span class="rule-target">{{ ruleTarget(rule) }}</span>
            </div>
            <div v-if="(rule.assignments || []).length" class="rule-line">
              <span class="rule-key">{{ ot("actionDefinitionFields") }}</span>
              <span class="rule-values">
                <span v-for="item in rule.assignments" :key="item.field" class="assignment">
                  {{ item.field }} ← <span v-html="renderValueFrom(item.valueFrom)"></span>
                </span>
              </span>
            </div>
            <div v-if="rule.guards" class="rule-line">
              <span class="rule-key">{{ ot("actionDefinitionConditions") }}</span>
              <code class="rule-guard">{{ guardText(rule.guards) }}</code>
            </div>
            <div
              v-if="rule.objectIdFrom || rule.sourceObjectIdFrom || rule.targetObjectIdFrom"
              class="rule-line"
            >
              <span class="rule-key">{{ ot("actionDefinitionLocate") }}</span>
              <span class="rule-values">
                <span v-if="rule.objectIdFrom">
                  {{ ot("actionDefinitionObject") }} ← <span v-html="renderValueFrom(rule.objectIdFrom)"></span>
                </span>
                <span v-if="rule.sourceObjectIdFrom">
                  {{ ot("actionDefinitionSource") }} ← <span v-html="renderValueFrom(rule.sourceObjectIdFrom)"></span>
                </span>
                <span v-if="rule.targetObjectIdFrom">
                  {{ ot("actionDefinitionRuleTarget") }} ← <span v-html="renderValueFrom(rule.targetObjectIdFrom)"></span>
                </span>
              </span>
            </div>
          </div>
        </div>
        <table class="param-table">
          <thead>
            <tr><th>{{ ot("actionDefinitionParameters") }}</th><th>{{ ot("actionDefinitionType") }}</th><th>{{ ot("actionDefinitionDescription") }}</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="parameter in actionDefinition.parameters || []"
              :id="`param-row-${parameter.name}`"
              :key="parameter.name"
            >
              <td><span class="param-chip">{{ parameter.name }}</span></td>
              <td>{{ parameter.type }}</td>
              <td>{{ parameter.description }}</td>
            </tr>
          </tbody>
        </table>

        <div class="group criteria-block">
          <h4>{{ ot("actionDefinitionSubmissionCriteria") }}</h4>
          <p class="desc">{{ ot("actionDefinitionCriteriaHint") }}</p>
          <template v-if="submissionCriteria">
            <div v-if="criteriaConditions.length" class="criteria-list">
              <div v-for="(condition, index) in criteriaConditions" :key="index" class="criteria-row">
                <div class="criteria-main">
                  <span class="kt">{{ criteriaOperator }}</span>
                  <code class="rule-guard">{{ criterionText(condition) }}</code>
                </div>
                <div v-if="criterionMessage(condition)" class="criteria-msg">
                  {{ criterionMessage(condition) }}
                </div>
              </div>
            </div>
            <div v-else class="empty">{{ ot("actionDefinitionNoConditions") }}</div>
            <div v-if="criteriaUnrepresentable.length" class="criteria-custom">
              <b>{{ ot("actionDefinitionCustomChecks") }}</b>
              <div v-for="(item, index) in criteriaUnrepresentable" :key="index">
                {{ item.description }}
                <span v-if="item.reason" class="muted">（{{ item.reason }}）</span>
              </div>
            </div>
          </template>
          <div v-else class="empty">{{ ot("actionDefinitionNoCriteria") }}</div>
        </div>
      </section>


        <BusinessMeaning
          v-if="kind === 'actions' && businessMeaning"
          :meaning="businessMeaningForDisplay"
          :stale="codeDirty"
        />
      </section>

      <section v-if="kind === 'metrics'" class="definition-section metric-bindings">
        <div class="parameter-header">
          <h2>{{ ot("metricBindings") }}</h2>
          <el-button :icon="Plus" @click="addBinding">{{ ot("metricAddBinding") }}</el-button>
        </div>
        <p>{{ ot("metricBindingsHint") }}</p>
        <p class="text-muted">{{ ot("metricJsonValuesHint") }}</p>
        <section v-for="(binding, index) in bindingDrafts" :key="binding.id || index" class="metric-binding">
          <el-form label-position="top">
            <el-form-item :label="ot('assetFieldName')">
              <el-input v-model="binding.name" :aria-label="ot('metricBindingName')" />
            </el-form-item>
            <el-form-item :label="ot('description')">
              <el-input v-model="binding.description" />
            </el-form-item>
            <el-form-item :label="ot('assetMatchQuestions')">
              <el-input v-model="binding.questions" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item
              v-for="parameter in metricParameters"
              :key="parameter.name"
              :label="`${parameter.name} (${parameter.type})`"
            >
              <el-input
                v-model="binding.values[parameter.name]"
                :aria-label="parameter.name"
                :placeholder="JSON.stringify(parameter.sample ?? null)"
              />
            </el-form-item>
          </el-form>
          <el-button :icon="Trash2" @click="bindingDrafts.splice(index, 1)">{{ ot("metricRemoveBinding") }}</el-button>
        </section>
      </section>

      </div>

      <section class="logic-section">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("assetExecutionDefinition") }}</span>
            <h2>{{ ot("assetFunctionLogic") }}</h2>
          </div>
        </div>
        <el-form label-position="top" class="asset-form logic-form">
          <el-form-item v-if="functionRecord" :label="ot('assetFunctionName')">
            <el-input v-model="functionRecord.name" />
          </el-form-item>
          <template v-if="functionRecord">
            <template v-if="readFunction">
              <el-alert v-if="!functionRecord.queryPackage && functionRecord.code" :title="ot('assetLegacyPackageHint')" type="info" :closable="false" />
              <el-form-item :label="ot('assetQueryPackage')">
                <CodeEditor v-model="packageDraft" class="asset-code" language="json" :min-height="360" />
              </el-form-item>
              <el-form-item :label="ot('assetColumnLabels')">
                <CodeEditor v-model="columnLabelsDraft" class="asset-code" language="json" :min-height="88" />
              </el-form-item>
              <CodeEditor
                v-if="!functionRecord.queryPackage && functionRecord.code"
                :model-value="functionRecord.code"
                language="python"
                readonly
                :min-height="180"
              />
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="functionRecord.logic" type="textarea" :rows="3" />
              </el-form-item>
            </template>
            <template v-else>
            <div class="parameter-header">
              <span class="field-label">{{ ot("assetInputParameters") }}</span>
              <el-button size="small" :icon="Plus" @click="addParameter">
                {{ ot("assetAddParameter") }}
              </el-button>
            </div>
            <div
              v-for="(parameter, index) in functionRecord.parameters || []"
              :key="index"
              class="parameter-row"
            >
              <el-input v-model="parameter.name" :placeholder="ot('assetParameterName')" />
              <el-select v-model="parameter.type" :placeholder="ot('assetParameterType')">
                <el-option v-for="type in parameterTypes" :key="type" :label="type" :value="type" />
              </el-select>
              <el-input v-model="parameter.description" :placeholder="ot('description')" />
              <el-input v-model="parameter.sample" :placeholder="ot('assetParameterSample')" />
              <el-input
                :model-value="parameterClassNamesText(parameter)"
                :placeholder="ot('assetParameterClasses')"
                @update:model-value="updateParameterClassNames(parameter, $event)"
              />
              <el-button link type="danger" :icon="Trash2" @click="removeParameter(index)" />
            </div>
            <el-form-item :label="ot('assetReturnClasses')">
              <el-input
                v-model="returnClassText"
                :placeholder="ot('assetReturnClassesPlaceholder')"
              />
            </el-form-item>
            <template v-if="isFunction">
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="record.logic" type="textarea" :rows="3" />
              </el-form-item>
              <el-form-item :label="ot('explainerCode')">
                <CodeEditor v-model="record.code" class="asset-code" language="python" :min-height="300" />
              </el-form-item>
            </template>
            <template v-else>
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="functionRecord.logic" type="textarea" :rows="3" />
              </el-form-item>
              <el-form-item :label="ot('explainerCode')">
                <CodeEditor v-model="functionRecord.code" class="asset-code" language="python" :min-height="300" />
              </el-form-item>
            </template>
            </template>
          </template>
        </el-form>
      </section>

    </div>

    <ActionCreateDialog
      v-model="showGeneration"
      @created="onActionCreated"
      @back="emit('back')"
    />

    <el-dialog
      v-model="metricGenerationVisible"
      :lock-scroll="false"
      :title="ot('metricGenerateTitle')"
      width="560px"
    >
      <el-input
        v-model="metricGenerationPrompt"
        type="textarea"
        :rows="4"
        :placeholder="ot('metricPromptPlaceholder')"
      />
      <template #footer>
        <el-button @click="metricGenerationVisible = false">{{ ot("cancel") }}</el-button>
        <el-button type="primary" :loading="metricGenerating" @click="generateMetricView">
          {{ ot("metricGenerateDraft") }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="testVisible"
      :lock-scroll="false"
      :title="ot('metricTestTitle')"
      width="min(900px, 94cqw)"
    >
      <el-alert :title="ot('metricTestHint')" type="info" :closable="false" />
      <el-select v-model="testBinding" :aria-label="ot('metricChooseBinding')">
        <el-option :value="-1" :label="ot('metricExplicitParameters')" />
        <el-option v-for="(binding, index) in bindingDrafts" :key="index" :value="index" :label="binding.name" />
      </el-select>
      <p>{{ ot("metricJsonValuesHint") }}</p>
      <el-form v-if="metricParameters.length && testBinding < 0" label-position="top" class="test-parameters">
        <el-form-item
          v-for="parameter in metricParameters"
          :key="parameter.name"
          :label="parameter.name || ot('metricUnnamedParameter')"
        >
          <el-input
            v-model="testValues[parameter.name]"
            :placeholder="parameter.description || ot('metricParameterValue')"
          />
        </el-form-item>
      </el-form>
      <el-tabs v-model="testTab">
        <el-tab-pane :label="ot('metricMarkdownTest')" name="markdown">
          <el-radio-group v-model="markdownView" class="markdown-view-toggle" :aria-label="ot('metricMarkdownTest')" size="small">
            <el-radio value="preview">{{ ot('metricMarkdownPreview') }}</el-radio>
            <el-radio value="source">{{ ot('metricMarkdownSource') }}</el-radio>
          </el-radio-group>
          <div v-if="markdownView === 'preview'" class="metric-markdown-preview">
            <MarkdownView v-if="testMarkdown" :content="testMarkdown" />
            <p v-else class="markdown-placeholder">{{ ot('metricTestResultPlaceholder') }}</p>
          </div>
          <CodeEditor
            v-else
            :model-value="testMarkdown"
            language="markdown"
            readonly
            :min-height="300"
            :placeholder="ot('metricTestResultPlaceholder')"
          />
        </el-tab-pane>
        <el-tab-pane :label="ot('metricJsonTest')" name="json">
          <CodeEditor
            :model-value="testJson"
            language="json"
            readonly
            :min-height="300"
            :placeholder="ot('metricJsonResultPlaceholder')"
          />
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="testVisible = false">{{ ot("close") }}</el-button>
        <el-button type="primary" :icon="Play" :loading="testing" @click="testMetricView">
          {{ ot("metricTestMarkdown") }}
        </el-button>
        <el-button :icon="Play" :loading="testing" @click="testExecuteMetricView">
          {{ ot("metricTestJson") }}
        </el-button>
      </template>
    </el-dialog>

  </section>
</template>

<style scoped>
.metric-binding {
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  padding: var(--surface-padding);
  margin: 0;
}

.markdown-view-toggle { margin-bottom: var(--spacing-md); }
.metric-markdown-preview {
  min-height: 300px;
  max-height: 55vh;
  overflow: auto;
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.markdown-placeholder { color: var(--el-text-color-placeholder); margin: 0; }
/*
 * The page paints no background of its own: it sits on the application's area, the darkest band in dark mode
 * (DESIGN.md "Colour roles"); its sections keep their own surfaces. The title row, the tabs and the panes under them take
 * the page gutter (`platform-page-gutter`), so they start where the other pages' titles do.
 */
.asset-detail {
  min-height: 100%;
}
.asset-detail.with-explainer-tab {
  display: flex;
  height: 100%;
  flex-direction: column;
}
.detail-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color);
}
.detail-tab {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
}
.detail-tab.is-active {
  border-bottom-color: var(--el-color-primary);
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
.explainer-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  padding-block: var(--spacing-md) var(--spacing-lg);
}
.detail-titlebar {
  display: flex;
  flex-wrap: wrap;
  min-height: var(--page-header-height);
  flex: 0 0 auto;
  align-items: center;
  gap: var(--spacing-sm);
  padding-block: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color);
}
.title-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--spacing-xs);
  background: var(--el-border-color);
}
.title-copy {
  min-width: 0;
  max-width: 100%;
}
.title-copy strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-copy strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.title-spacer {
  flex: 1;
}
.detail-body {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(460px, 1.4fr);
  gap: var(--manager-module-gap);
  padding-block: var(--manager-module-gap);
  align-items: start;
}
.definition-column {
  display: contents;
}
.metric-detail-body > .definition-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--manager-module-gap);
}
.action-definition {
  margin-top: var(--manager-content-gap);
  padding-top: var(--manager-content-gap);
  border-top: 1px solid var(--el-border-color-lighter);
}

.action-definition :deep(.param-link) {
  color: var(--brand-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.action-definition :deep(.param-link::after) {
  content: "↗";
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.65;
}

.action-definition :deep(.param-link:hover) {
  color: var(--brand-link);
  text-decoration-thickness: 2px;
}

.param-chip {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
}

.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: var(--manager-content-gap);
}

.param-table th {
  text-align: left;
  color: var(--el-text-color-secondary);
  font-weight: 500;
  padding: var(--manager-control-gap) var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.param-table td {
  padding: var(--manager-control-gap) var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.param-flash td {
  animation: param-flash 1.2s ease;
}

@keyframes param-flash {
  0% { box-shadow: inset 0 0 0 2px var(--el-color-warning); }
  100% { box-shadow: none; }
}

.criteria-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.criteria-row {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: var(--manager-content-gap);
}

.criteria-main {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.criteria-msg {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.criteria-custom {
  margin-top: var(--manager-control-gap);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.rule-group {
  margin-top: var(--manager-content-gap);
}

.rule-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin: 0 0 8px;
}

.rule-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: var(--radius-md);
  padding: 0 6px;
}

.rule-row {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: var(--manager-content-gap);
  margin-bottom: var(--manager-control-gap);
}

.rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--manager-control-gap);
}

.rule-target {
  font-weight: 500;
}

.rule-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  margin-top: 4px;
}

.rule-key {
  color: var(--el-text-color-secondary);
  min-width: 32px;
}

.rule-values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rule-guard {
  font-family: var(--font-mono);
  background: var(--el-fill-color-light);
  padding: 1px 4px;
  border-radius: 3px;
}

.definition-objects {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 12px;
}

.assignment {
  flex: 1 1 100%;
  display: block;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.definition-section,
.logic-section {
  min-width: 0;
  padding: var(--manager-module-padding);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.metric-bindings {
  display: flex;
  flex-direction: column;
  gap: var(--manager-content-gap);
}
.metric-bindings > p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--component-gap);
}
h1,
h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.asset-form {
  margin-top: var(--manager-content-gap);
}
.asset-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.asset-form :deep(.el-form-item) {
  margin-bottom: var(--manager-module-gap);
}
.asset-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.logic-form {
  display: flex;
  flex-direction: column;
  gap: var(--manager-module-gap);
}
.logic-form :deep(.el-form-item),
.logic-form :deep(.el-form-item:last-child),
.logic-form > .parameter-header,
.logic-form > .parameter-row {
  margin: 0;
}
.metric-binding > .el-button {
  margin-top: var(--manager-content-gap);
}
.asset-form :deep(.el-select) {
  width: 100%;
}
.asset-code {
  width: 100%;
}
.test-parameters {
  margin: var(--spacing-lg) 0;
}
.parameter-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin: 0 0 var(--manager-control-gap);
}
.metric-bindings > .parameter-header {
  margin: 0;
}
.field-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.parameter-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) 28px;
  gap: var(--spacing-sm);
  align-items: center;
  min-width: 0;
  margin-bottom: var(--spacing-sm);
}
.parameter-row > * {
  min-width: 0;
  width: 100%;
}
.parameter-row :deep(.el-input),
.parameter-row :deep(.el-select) {
  min-width: 0;
  width: 100%;
}
.parameter-row > .el-button {
  width: 28px;
  min-width: 28px;
  justify-self: center;
}
@container ontology-manager (max-width: 980px) {
  .detail-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container ontology-manager (max-width: 900px) {
  .parameter-row {
    grid-template-columns: 1fr 1fr 28px;
  }
  .parameter-row .el-input:nth-child(3),
  .parameter-row .el-input:nth-child(4),
  .parameter-row .el-input:nth-child(5) {
    grid-column: span 1;
  }
}
@container ontology-manager (max-width: 640px) {
  .explainer-pane {
    padding-block: var(--spacing-md);
  }
  .title-divider {
    display: none;
  }
  .detail-body {
    padding-block: var(--spacing-md);
    gap: var(--manager-module-gap);
  }
}
</style>
