<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import MarkdownIt from "markdown-it";
import { ArrowLeft, History, Play, Plus, Save, Sparkles, Trash2 } from "lucide-vue-next";
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElLink,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  vLoading,
} from "element-plus";
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
const { loadSmartAssets, requestSmartAsset } = useManagerClient();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const testing = ref(false);
const record = ref<AssetRecord | null>(null);
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
  const values = testParameters();
  for (const parameter of draft.function.parameters || []) parameter.value = values[parameter.name];
  draft.bindings = serializedBindings();
  return draft;
}

const functionChoices = ref<SmartAsset[]>([]);
const showGeneration = ref(false);
const metricGenerationPrompt = ref("");
const metricGenerationVisible = ref(false);
const metricGenerating = ref(false);
const testVisible = ref(false);
const testTab = ref("markdown");
const testMarkdown = ref("");
const markdownView = ref("preview");
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const testMarkdownPreview = computed(() => markdown.render(testMarkdown.value));
const testJson = ref("");
const testResultUrl = ref("");
const taskResultsVisible = ref(false);
const taskResultLoading = ref(false);
const taskResults = ref<AssetRecord[]>([]);
const taskResultPage = ref(1);
const taskResultPageSize = ref(10);
const taskResultTotal = ref(0);
const selectedTaskResult = ref<AssetRecord | null>(null);

const meta = computed(() => {
  const titles = {
    metrics: ot("assetKindMetrics"),
    actions: ot("assetKindActions"),
    functions: ot("assetKindFunctions"),
    tasks: ot("assetKindTasks"),
  };
  return { title: titles[props.kind] };
});

const canDelete = computed(() => Boolean(record.value?.id) && record.value?.origin !== "SYSTEM");
const isTask = computed(() => props.kind === "tasks");
const isFunction = computed(() => props.kind === "functions");
const functionRecord = computed(() =>
  props.kind === "functions" ? record.value : record.value?.function || null
);
const metricParameters = computed(() =>
  Array.isArray(record.value?.function?.parameters) ? record.value.function.parameters : []
);
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
const taskResultPages = computed(() =>
  Math.max(1, Math.ceil(taskResultTotal.value / taskResultPageSize.value))
);

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
const effectLabels: Record<string, string> = {
  CREATE_OBJECT: "新建对象",
  UPDATE_OBJECT: "修改对象",
  DELETE_OBJECT: "删除对象",
  CREATE_EDGE: "建立关系",
  DELETE_EDGE: "删除关系",
  APPEND_VECTOR: "追加向量",
  UPDATE_VECTOR: "更新向量",
  DELETE_VECTOR: "删除向量",
  EXTERNAL_CALL: "外部调用",
};
const effectLabel = (kind: string) => effectLabels[kind] || kind;

const RULE_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "create", label: "Create", kinds: ["CREATE_OBJECT"] },
  { key: "modify", label: "Modify", kinds: ["UPDATE_OBJECT"] },
  { key: "delete", label: "Delete", kinds: ["DELETE_OBJECT"] },
  { key: "link", label: "Link", kinds: ["CREATE_EDGE", "DELETE_EDGE"] },
  { key: "vector", label: "Vector", kinds: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"] },
  { key: "other", label: "Other", kinds: ["EXTERNAL_CALL"] },
];
const ruleGroups = computed(() => {
  const effects = actionDefinition.value?.effects || [];
  return RULE_GROUPS.map((group) => ({
    ...group,
    items: effects.filter((effect: any) => group.kinds.includes(effect.kind)),
  })).filter((group) => group.items.length > 0);
});
const ruleLabel = (kind: string) => effectLabels[kind] || kind;
const ruleTarget = (rule: any) => {
  if (rule.relation)
    return `${rule.sourceClass || "?"} → ${rule.targetClass || "?"}（${rule.relation}）`;
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
    return `${condition.from || condition.objectParameter || "?"} 存在关系 ${condition.relation}`;
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
    if (props.kind === "tasks")
      functionChoices.value = await loadSmartAssets("functions").catch(() => []);
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
    if (props.kind === "tasks")
      functionChoices.value = await loadSmartAssets("functions").catch(() => []);
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
  if (isTask.value && (!record.value.cron?.trim() || !record.value.function?.id)) {
    message.warning(ot("assetTaskFieldsRequired"));
    return;
  }
  saving.value = true;
  try {
    const isAction = props.kind === "actions";
    const codeChanged = isAction && codeDirty.value;
    // Recalculation happens synchronously in the save request, so actions with code changes first warn that it may take a while.
    if (codeChanged) message.info(ot("explainerRegenerating"));
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

async function runTask() {
  if (!record.value?.id) return;
  try {
    await requestSmartAsset("tasks", "runOnce", { id: record.value.id });
    message.success(ot("taskRunSubmitted"));
    await openTaskResults();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskRunFailed"));
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

async function openTaskResults() {
  if (!record.value?.id) return;
  taskResultsVisible.value = true;
  taskResultPage.value = 1;
  selectedTaskResult.value = null;
  await loadTaskResults();
}

async function loadTaskResults() {
  if (!record.value?.id) return;
  taskResultLoading.value = true;
  try {
    const response = await requestSmartAsset("tasks", "queryResultPageByTaskId", {
      id: record.value.id,
      pageNum: taskResultPage.value,
      pageSize: taskResultPageSize.value,
    });
    const payload = response?.data ?? response ?? {};
    taskResults.value = Array.isArray(payload.data) ? payload.data : [];
    taskResultTotal.value = Number(payload.totalRows || 0);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskResultsLoadFailed"));
  } finally {
    taskResultLoading.value = false;
  }
}

async function viewTaskResult(result: AssetRecord) {
  try {
    const response = await requestSmartAsset("tasks", "queryResultById", { resultId: result.id });
    selectedTaskResult.value = response?.data ?? response;
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskResultLoadFailed"));
  }
}

function openMetricTest() {
  markdownView.value = "preview";
  testMarkdown.value = "";
  testJson.value = "";
  testResultUrl.value = "";
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
    testResultUrl.value = typeof response?.data?.url === "string" ? response.data.url : "";
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
    :class="['asset-detail', { 'task-detail': isTask }, { 'with-explainer-tab': showExplainerTab }]"
  >
    <header class="detail-titlebar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("assetBackTo", { title: meta.title }) }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ record?.name || ot("assetNew", { title: meta.title }) }}</strong>
        <small>{{ meta.title }}</small>
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

    <nav v-if="record && showExplainerTab" class="detail-tabs" role="tablist">
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
      class="explainer-pane"
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

    <div v-if="record" v-show="!showExplainerTab || activeTab === 'definition'" class="detail-body">
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
              <el-option
                v-if="!isTask"
                :label="ot('assetStatusPendingReview')"
                value="PENDING_REVIEW"
              />
              <el-option v-if="!isTask" :label="ot('published')" value="PUBLISHED" />
              <el-option v-if="!isTask" :label="ot('unused')" value="UNUSED" />
              <el-option v-if="isTask" :label="ot('running')" value="RUNNING" />
              <el-option v-if="isTask" :label="ot('stopped')" value="STOPPED" />
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
          <el-form-item v-if="isTask" :label="ot('taskCron')">
            <el-input v-model="record.cron" :placeholder="ot('taskCronPlaceholder')" />
          </el-form-item>
          <el-form-item v-if="isTask" :label="ot('taskLinkedFunction')">
            <el-select
              v-model="record.function"
              value-key="id"
              filterable
              :placeholder="ot('taskSelectFunction')"
            >
              <el-option
                v-for="item in functionChoices"
                :key="item.id"
                :label="item.name"
                :value="item"
              />
            </el-select>
          </el-form-item>
        </el-form>

      <section v-if="kind === 'actions' && actionDefinition" class="action-definition" @click="onParamClick">
        <div class="section-title">
          <div>
            <span class="eyebrow">结构化定义</span>
            <h2>Rules（规则）</h2>
          </div>
          <el-tag size="small" type="info">派生 · 未验证</el-tag>
        </div>
        <p class="text-muted">
          从代码解释投影出的规则清单，仅用于阅读；平台不执行这些规则，运行时仍以 Python 代码为准。
        </p>
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
              <span class="rule-key">字段</span>
              <span class="rule-values">
                <span v-for="item in rule.assignments" :key="item.field" class="assignment">
                  {{ item.field }} ← <span v-html="renderValueFrom(item.valueFrom)"></span>
                </span>
              </span>
            </div>
            <div v-if="rule.guards" class="rule-line">
              <span class="rule-key">条件</span>
              <code class="rule-guard">{{ guardText(rule.guards) }}</code>
            </div>
            <div
              v-if="rule.objectIdFrom || rule.sourceObjectIdFrom || rule.targetObjectIdFrom"
              class="rule-line"
            >
              <span class="rule-key">定位</span>
              <span class="rule-values">
                <span v-if="rule.objectIdFrom">
                  object ← <span v-html="renderValueFrom(rule.objectIdFrom)"></span>
                </span>
                <span v-if="rule.sourceObjectIdFrom">
                  source ← <span v-html="renderValueFrom(rule.sourceObjectIdFrom)"></span>
                </span>
                <span v-if="rule.targetObjectIdFrom">
                  target ← <span v-html="renderValueFrom(rule.targetObjectIdFrom)"></span>
                </span>
              </span>
            </div>
          </div>
        </div>
        <table class="param-table">
          <thead>
            <tr><th>参数</th><th>类型</th><th>说明</th></tr>
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
          <h4>Submission criteria</h4>
          <p class="desc">动作开始前统一判定；任一条失败则整个动作不执行。</p>
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
            <div v-else class="empty">已声明，但没有条件。</div>
            <div v-if="criteriaUnrepresentable.length" class="criteria-custom">
              <b>自定义校验（未结构化）</b>
              <div v-for="(item, index) in criteriaUnrepresentable" :key="index">
                {{ item.description }}
                <span v-if="item.reason" class="muted">（{{ item.reason }}）</span>
              </div>
            </div>
          </template>
          <div v-else class="empty">未声明。当前 Action 没有结构化前置条件。</div>
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

      <section v-if="!isTask" class="logic-section">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("assetExecutionDefinition") }}</span>
            <h2>{{ isFunction ? ot("assetFunctionLogic") : ot("taskLinkedFunction") }}</h2>
          </div>
        </div>
        <el-form label-position="top" class="asset-form">
          <el-form-item v-if="functionRecord" :label="ot('assetFunctionName')">
            <el-input v-model="functionRecord.name" />
          </el-form-item>
          <template v-if="functionRecord">
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
                <el-input v-model="record.code" type="textarea" :rows="14" class="code-input" />
              </el-form-item>
            </template>
            <template v-else>
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="functionRecord.logic" type="textarea" :rows="3" />
              </el-form-item>
              <el-form-item :label="ot('explainerCode')">
                <el-input
                  v-model="functionRecord.code"
                  type="textarea"
                  :rows="14"
                  class="code-input"
                />
              </el-form-item>
            </template>
          </template>
        </el-form>
      </section>

      <section v-else class="task-execution-section">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("taskExecutionEyebrow") }}</span>
            <h2>{{ ot("taskExecutionTitle") }}</h2>
          </div>
        </div>
        <div class="task-summary">
          <div>
            <span>{{ ot("status") }}</span>
            <strong>{{ record.status === "RUNNING" ? ot("running") : ot("stopped") }}</strong>
          </div>
          <div>
            <span>{{ ot("taskSchedule") }}</span>
            <strong>{{ record.cron || ot("taskNotConfigured") }}</strong>
          </div>
          <div>
            <span>{{ ot("taskLinkedFunction") }}</span>
            <strong>{{ record.function?.name || ot("taskNotSelected") }}</strong>
          </div>
        </div>
        <div class="task-actions">
          <el-button v-if="record.id" type="primary" :icon="Play" @click="runTask">
            {{ ot("taskRunOnce") }}
          </el-button>
          <el-button v-if="record.id" :icon="History" @click="openTaskResults">
            {{ ot("taskViewResults") }}
          </el-button>
        </div>
        <p class="task-hint">{{ ot("taskRunOnceHint") }}</p>
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
            <div v-if="testMarkdown" v-html="testMarkdownPreview" />
            <p v-else class="markdown-placeholder">{{ ot('metricTestResultPlaceholder') }}</p>
          </div>
          <el-input
            v-else
            v-model="testMarkdown"
            type="textarea"
            :rows="14"
            readonly
            :placeholder="ot('metricTestResultPlaceholder')"
            class="code-input"
          />
          <el-link v-if="testResultUrl" :href="testResultUrl" target="_blank" type="primary">
            {{ ot("metricOpenFullResult") }}
          </el-link>
        </el-tab-pane>
        <el-tab-pane :label="ot('metricJsonTest')" name="json">
          <el-input
            v-model="testJson"
            type="textarea"
            :rows="14"
            readonly
            :placeholder="ot('metricJsonResultPlaceholder')"
            class="code-input"
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

    <el-dialog
      v-model="taskResultsVisible"
      :lock-scroll="false"
      :title="ot('taskResultsTitle')"
      width="min(960px, calc(100cqw - 32px))"
      class="task-results-dialog"
    >
      <div class="task-results-content">
        <el-table
          v-loading="taskResultLoading"
          :data="taskResults"
          border
          stripe
          class="task-results-table"
        >
          <el-table-column :label="ot('taskResultTime')" width="190">
            <template #default="{ row }">
              {{ row.executeTimestamp ? new Date(row.executeTimestamp).toLocaleString() : "-" }}
            </template>
          </el-table-column>
          <el-table-column :label="ot('status')" width="90">
            <template #default="{ row }">
              <el-tag :type="row.error ? 'danger' : 'success'">
                {{ row.error ? ot("taskResultFailed") : ot("taskResultSucceeded") }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="spendTime" :label="ot('taskResultElapsed')" width="100" />
          <el-table-column :label="ot('taskResultActions')" width="90">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewTaskResult(row)">
                {{ ot("taskResultView") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="taskResultTotal"
          v-model:current-page="taskResultPage"
          v-model:page-size="taskResultPageSize"
          class="task-pagination"
          layout="total, prev, pager, next"
          :total="taskResultTotal"
          :page-count="taskResultPages"
          @current-change="loadTaskResults"
        />
        <el-alert
          v-if="selectedTaskResult"
          class="task-result-preview"
          :title="selectedTaskResult.error || ot('taskResultOutput')"
          :type="selectedTaskResult.error ? 'error' : 'success'"
          :closable="false"
        >
          <pre>{{
            selectedTaskResult.error || selectedTaskResult.result || ot("taskResultNoOutput")
          }}</pre>
        </el-alert>
      </div>
      <template #footer>
        <el-button @click="taskResultsVisible = false">{{ ot("close") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.metric-binding {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 16px;
  margin-top: 12px;
}

.markdown-view-toggle { margin-bottom: var(--spacing-md); }
.metric-markdown-preview {
  min-height: 300px;
  max-height: 55vh;
  overflow: auto;
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.markdown-placeholder { color: var(--el-text-color-placeholder); margin: 0; }
.metric-markdown-preview :deep(h1),
.metric-markdown-preview :deep(h2),
.metric-markdown-preview :deep(h3) { margin: 1em 0 0.5em; line-height: 1.4; color: inherit; }
.metric-markdown-preview :deep(h1) { font-size: var(--text-2xl); }
.metric-markdown-preview :deep(h2) { font-size: var(--text-xl); }
.metric-markdown-preview :deep(h3) { font-size: var(--text-lg); }
.metric-markdown-preview :deep(table) { border-collapse: collapse; width: 100%; margin: 1em 0; }
.metric-markdown-preview :deep(th),
.metric-markdown-preview :deep(td) { padding: 8px 12px; border: 1px solid var(--el-border-color); text-align: left; }
.metric-markdown-preview :deep(th) { background: var(--el-fill-color-light); }
.metric-markdown-preview :deep(pre) { overflow: auto; padding: var(--spacing-md); background: var(--el-fill-color-light); border-radius: var(--radius-sm); }
.metric-markdown-preview :deep(code) { font-family: var(--font-mono); background: var(--el-fill-color-light); }
.metric-markdown-preview :deep(blockquote) { margin-left: 0; padding-left: var(--spacing-md); border-left: 3px solid var(--el-border-color); color: var(--el-text-color-secondary); }
.metric-markdown-preview :deep(a) { color: var(--el-color-primary); }
.metric-markdown-preview :deep(img) { max-width: 100%; }
.asset-detail {
  min-height: 100%;
  background: var(--el-bg-color);
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
  padding: var(--spacing-sm) var(--spacing-2xl) 0;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
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
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}
.explainer-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-2xl) var(--spacing-xl);
}
.detail-titlebar {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-2xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.title-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--spacing-xs);
  background: var(--el-border-color);
}
.title-copy {
  min-width: 0;
}
.title-copy strong,
.title-copy small {
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
.title-copy small {
  margin-top: 1px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.title-spacer {
  flex: 1;
}
.detail-body {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(460px, 1.4fr);
  gap: var(--spacing-xl);
  padding: var(--spacing-xl) var(--spacing-2xl);
}
.action-definition {
  margin-top: var(--spacing-xl);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-lighter);
}

.action-definition :deep(.param-link) {
  color: var(--el-color-primary);
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
  color: var(--el-color-primary-dark-2);
}

.param-chip {
  font-family: var(--el-font-family-mono);
  font-size: 12px;
  font-weight: 500;
}

.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 10px;
}

.param-table th {
  text-align: left;
  color: var(--el-text-color-secondary);
  font-weight: 500;
  padding: 7px 9px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.param-table td {
  padding: 7px 9px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.param-flash td {
  animation: param-flash 1.2s ease;
}

@keyframes param-flash {
  0% { box-shadow: inset 0 0 0 2px #f59e0b; }
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
  padding: 9px 11px;
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
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.rule-group {
  margin-top: 14px;
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
  border-radius: 10px;
  padding: 0 6px;
}

.rule-row {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
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
  font-family: var(--el-font-family-mono);
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
.logic-section,
.task-execution-section {
  min-width: 0;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.section-title {
  display: flex;
  justify-content: space-between;
}
h1,
h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.asset-form {
  margin-top: var(--spacing-xl);
}
.asset-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.asset-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
.asset-form :deep(.el-select) {
  width: 100%;
}
.code-input :deep(textarea) {
  font-family: var(--font-mono);
}
.test-parameters {
  margin: var(--spacing-lg) 0;
}
.parameter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin: var(--spacing-sm) 0 var(--spacing-xs);
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
.task-pagination {
  margin-top: var(--spacing-lg);
}
.task-result-preview {
  margin-top: var(--spacing-lg);
}
.task-result-preview :deep(pre) {
  max-height: 260px;
  margin: var(--spacing-sm) 0 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
}
.task-detail .detail-body {
  grid-template-columns: minmax(360px, 0.95fr) minmax(360px, 1.05fr);
}
.task-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
}
.task-summary span,
.task-summary strong {
  display: block;
}
.task-summary span {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.task-summary strong {
  margin-top: 4px;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}
.task-hint {
  margin: var(--spacing-lg) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
}
.task-results-content {
  max-height: min(62cqh, 560px);
  overflow: auto;
  padding-right: var(--spacing-xs);
}
.task-results-table {
  min-width: 560px;
}
.task-results-dialog :deep(.el-dialog) {
  max-width: calc(100cqw - var(--spacing-xl));
  margin: 0 auto;
}
.task-results-dialog :deep(.el-dialog__body) {
  padding-top: var(--spacing-md);
  padding-bottom: var(--spacing-md);
}
@container ontology-manager (max-width: 980px) {
  .detail-body {
    grid-template-columns: 1fr;
  }
  .task-detail .detail-body {
    grid-template-columns: 1fr;
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
  .detail-titlebar {
    padding: 0 var(--spacing-md);
  }
  .detail-tabs {
    padding: var(--spacing-sm) var(--spacing-md) 0;
  }
  .explainer-pane {
    padding: var(--spacing-md);
  }
  .title-divider,
  .title-copy small {
    display: none;
  }
  .detail-body {
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }
  .task-summary {
    grid-template-columns: 1fr;
  }
  .task-results-content {
    max-height: 58cqh;
  }
  .detail-titlebar :deep(.el-button:not(:first-child)) {
    padding-left: var(--spacing-sm);
    padding-right: var(--spacing-sm);
    font-size: 0;
  }
  .detail-titlebar :deep(.el-button:not(:first-child) .el-icon) {
    margin: 0;
    font-size: 16px;
  }
}
</style>
