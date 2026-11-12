<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Eye } from "lucide-vue-next";
import { ElButton, ElForm, ElInput, ElTable, ElTableColumn, ElAlert, ElSkeleton, vLoading } from "element-plus";
import { FormFields } from "@ontomato/foundation-ui/form";
import ElDialog from "../ManagerDialog.vue";
import { formFieldKey, type FormField } from "@ontomato/contracts/form-fields";
import { readViewPath, resolveViewBinding, resolveViewParameters, type ViewWidget, type ObjectReference } from "@ontomato/contracts/object-views";
import type { MetricViewDataSlots } from "../app-components/types";
import { useManagerClient, useOntologyText } from "../context";
import ObjectViewVisualization from "./ObjectViewVisualization.vue";
import { useManagerFeedback } from "../feedback";
const { ot } = useOntologyText();

/** What the runtime's MetricViewData hands to a component bound to a MetricView. */
type MetricViewDataState = Parameters<MetricViewDataSlots["default"]>[0];
const props = defineProps<{ widget: ViewWidget; object: Record<string, unknown>; reference: ObjectReference; variables: Record<string, unknown>; refresh: number; preview?: boolean; metricView?: MetricViewDataState }>();
const emit = defineEmits<{ variable: [name: string, value: unknown]; refresh: []; open: [reference: ObjectReference] }>();
const client = useManagerClient();
const { message } = useManagerFeedback();
const data = ref<unknown>();
const error = ref("");
const loading = ref(false);
const dataLoaded = ref(false);
const isDataWidget = computed(() => ["metric", "table", "chart", "links"].includes(props.widget.kind));
const actionOpen = ref(false);
/** The Action's fields as the data engine declares them, the draft of their text and the errors on them. */
const actionFields = shallowRef<FormField[]>([]);
const actionValues = ref<Record<string, string>>({});
const actionErrors = ref<Record<string, string>>({});
const offset = ref(0);
const hasMore = ref(false);
const linkTarget = ref({ className: "", primaryKey: "" });
const fieldLabels = ref<Record<string, string>>({});
watch(() => [props.reference.className, props.widget.kind, props.widget.relation, props.widget.direction], async () => {
  fieldLabels.value = {};
  if (!["properties", "links", "action"].includes(props.widget.kind)) return;
  const className = props.reference.className;
  try {
    const ontology = await client.loadOntology();
    if (className !== props.reference.className) return;
    const relation = ontology.relations.find(item => item.relationship === props.widget.relation);
    const target = props.widget.kind === "links" && relation ? (props.widget.direction === "incoming" ? relation.fromclass : relation.toclass) : className;
    fieldLabels.value = Object.fromEntries((ontology.objects.find(item => item.className === target)?.attrs || []).map(attr => [attr.name, attr.showName || attr.name]));
  } catch { /* Raw field names remain available when metadata cannot be loaded. */ }
}, { immediate: true });
let request = 0;
let actionRequest = 0;
onBeforeUnmount(() => { request++; actionRequest++; });
const parameters = computed(() => resolveViewParameters(props.widget.parameters, props.object, props.variables));
/** What this view binds to the Action's parameters; a binding that resolves to nothing is still bound, as null. */
const actionBindings = computed(() => Object.fromEntries(Object.entries(parameters.value).map(([name, value]) => [name, value ?? null])));
// Another object, Action or binding opens a new form: no draft carries over.
watch(() => JSON.stringify([props.reference.className, props.reference.primaryKey, props.widget.resourceId, actionBindings.value]), () => {
  actionRequest++;
  actionOpen.value = false;
  actionValues.value = {};
});
/** The view's own display of the Action's fields: its labels, and its choices in place of free text. */
const actionFormFields = computed(() => actionFields.value.map((field): FormField => {
  const label = props.widget.fieldLabels[field.key] || field.label;
  const options = props.widget.fieldOptions[field.key];
  return options
    ? {
      key: field.key, label, required: field.required, defaultValue: null, help: field.help, type: "select", refreshOnChange: false,
      options: options.map(option => ({ ...option, description: null, disabled: false, disabledReason: null })),
    }
    : { ...field, label };
}));
const bindingValue = computed(() => resolveViewBinding(props.widget.binding, props.object, props.variables));
// After a failed read the component shows no result rather than the one read for earlier parameters.
const selectedData = computed(() => props.metricView?.error ? undefined : readViewPath(props.metricView?.data, props.widget.resultPath));
// Shown loading and failure: the bound MetricView's read, otherwise the component's own relation read and Action.
const busy = computed(() => props.metricView?.loading ?? loading.value);
const loaded = computed(() => props.metricView ? props.metricView.data !== undefined : dataLoaded.value);
const failure = computed(() => props.metricView?.error ? `${props.widget.title || props.widget.resourceId}: ${props.metricView.error.message}` : error.value);
const rows = computed<Record<string, unknown>[]>(() => {
  const value = props.widget.kind === "links" ? data.value : selectedData.value ?? bindingValue.value;
  return Array.isArray(value) ? value.filter(row => row !== null && typeof row === "object") : [];
});
const fields = computed(() => props.widget.fields.length ? props.widget.fields : Object.keys(rows.value[0] || {}));
const propertyFields = computed(() => props.widget.fields.length ? props.widget.fields : Object.keys(props.object));
function format(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 10);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function displayField(field: string, value: unknown) {
  // An empty list is as empty as a missing value (the visualization reads it the same way).
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
  const options = props.widget.fieldOptions[field];
  if (!options || value == null || value === "") return format(value);
  return options.find(option => option.value === String(value))?.label || ot("ovUnrecognizedOption");
}

/** Reads a page of linked objects; a bound MetricView is read by the runtime's MetricViewData. */
async function load() {
  const current = ++request;
  error.value = "";
  if (props.widget.kind !== "links") { loading.value = false; return; }
  loading.value = true;
  data.value = undefined;
  hasMore.value = false;
  try {
    if (!props.widget.relation || !props.reference.primaryKey) return;
    const result = await client.loadViewLinks(props.reference.className, props.reference.primaryKey, props.widget.relation, props.widget.direction, offset.value);
    if (current !== request) return;
    data.value = result.rows;
    hasMore.value = result.hasMore;
    linkTarget.value = { className: result.targetClass, primaryKey: result.targetPk };
  } catch (reason) {
    if (current === request) error.value = `${props.widget.title || props.widget.relation}: ${reason instanceof Error ? reason.message : String(reason)}`;
  } finally { if (current === request) { loading.value = false; dataLoaded.value = true; } }
}
watch(() => JSON.stringify([props.reference.className, props.reference.primaryKey, props.widget, parameters.value, props.refresh]), () => { offset.value = 0; void load(); }, { immediate: true });
// A refresh, after an Action or from a button, reads the bound MetricView again.
watch(() => props.refresh, () => { void props.metricView?.reload(); });
function page(delta: number) { offset.value = Math.max(0, offset.value + delta); void load(); }
function selectRow(row: Record<string, unknown>) {
  if (props.widget.variable) emit("variable", props.widget.variable, row);
}
function openRow(row: Record<string, unknown>) {
  const className = props.widget.kind === "links" ? linkTarget.value.className : props.widget.targetClass;
  const key = props.widget.kind === "links" ? linkTarget.value.primaryKey : props.widget.valueField;
  if (className && row[key] != null) emit("open", { className, primaryKey: String(row[key]) });
}
function click() {
  if (props.widget.onClick === "refresh") emit("refresh");
  else if (props.widget.onClick === "setVariable" && props.widget.variable) emit("variable", props.widget.variable, bindingValue.value);
  else if (props.widget.onClick === "openObject" && props.widget.targetClass && bindingValue.value != null) emit("open", { className: props.widget.targetClass, primaryKey: String(bindingValue.value) });
}
/** The view's choices a field holds no option of; read-only fields keep their bound value. */
function unchosen(values: Record<string, string>) {
  return Object.keys(values).filter(name => props.widget.fieldOptions[name] && !props.widget.readOnlyParameters.includes(name)
    && !props.widget.fieldOptions[name].some(option => option.value === values[name]));
}
function enterAction(key: string, value: string) {
  actionValues.value[key] = value;
  delete actionErrors.value[key];
}
// The data engine interprets the text and answers the field errors or the typed parameters, which then execute.
async function execute() {
  if (loading.value || props.preview) return;
  actionErrors.value = Object.fromEntries(unchosen(actionValues.value).map(name => [name, ot("ovChooseOption")]));
  if (Object.keys(actionErrors.value).length) return;
  const current = ++actionRequest;
  loading.value = true;
  error.value = "";
  try {
    const form = await client.actions.form({
      id: props.widget.resourceId, parameters: actionBindings.value, values: actionValues.value, readOnlyParameters: props.widget.readOnlyParameters,
    });
    if (current !== actionRequest) return;
    actionErrors.value = Object.fromEntries(form.errors.map(fieldError => [formFieldKey(fieldError.field, "/values/")!, fieldError.message]));
    if (!form.parameters) return;
    await client.actions.execute({ id: props.widget.resourceId, parameters: form.parameters });
    if (current !== actionRequest) return;
    actionOpen.value = false;
    message.success(ot("ovActionSucceeded"));
    emit("refresh");
  } catch (reason) { if (current === actionRequest) error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { if (current === actionRequest) loading.value = false; }
}
async function openAction() {
  if (loading.value || props.preview) return;
  const current = ++actionRequest;
  error.value = "";
  try {
    const form = await client.actions.form({
      id: props.widget.resourceId, parameters: actionBindings.value, readOnlyParameters: props.widget.readOnlyParameters,
    });
    if (current !== actionRequest) return;
    actionFields.value = form.fields;
    // A bound value that is none of the view's choices starts unchosen.
    const unmatched = unchosen(form.values);
    actionValues.value = Object.fromEntries(Object.entries(form.values).map(([name, text]) => [name, unmatched.includes(name) ? "" : text]));
    actionErrors.value = {};
    actionOpen.value = true;
  } catch (reason) { if (current === actionRequest) error.value = reason instanceof Error ? reason.message : String(reason); }
}
</script>
<template>
  <div v-loading="busy && loaded && isDataWidget" class="view-widget" :aria-busy="busy" :style="isDataWidget && busy && !loaded ? { minHeight: widget.kind === 'metric' ? '40px' : Math.min(widget.height, 160) + 'px' } : undefined">
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" />
    <el-skeleton v-if="busy && !loaded && isDataWidget" :rows="widget.kind === 'metric' ? 1 : 4" animated :aria-label="ot('ovLoading')" />
    <p v-else-if="widget.kind === 'text'" class="view-text">{{ widget.text }}{{ widget.binding ? format(bindingValue) : '' }}</p>
    <dl v-else-if="widget.kind === 'properties'" class="properties">
      <template v-for="field in propertyFields" :key="field"><dt>{{ widget.fieldLabels[field] || fieldLabels[field] || field }}</dt><dd>{{ displayField(field, object[field]) }}</dd></template>
    </dl>
    <strong v-else-if="widget.kind === 'metric'" class="metric">{{ format(widget.resourceId ? readViewPath(Array.isArray(selectedData) ? selectedData[0] : selectedData, widget.valueField) : bindingValue) }}</strong>
    <template v-else-if="widget.kind === 'table' || widget.kind === 'links'">
      <el-table class="object-view-table" :data="rows" :max-height="widget.height" highlight-current-row @row-click="selectRow" @row-dblclick="openRow">
        <el-table-column v-for="field in fields" :key="field" :prop="field" :label="widget.fieldLabels[field] || fieldLabels[field] || field" min-width="130" show-overflow-tooltip><template #default="scope">{{ displayField(field, scope.row[field]) }}</template></el-table-column>
        <el-table-column v-if="widget.kind === 'links' || widget.targetClass" :label="ot('ovOperations')" min-width="140" align="center"><template #default="scope"><el-button class="object-view-row-action" type="primary" link :icon="Eye" :title="ot('ovOpenView')" @click.stop="openRow(scope.row)">{{ ot('ovViewDetails') }}</el-button></template></el-table-column>
      </el-table>
      <div v-if="widget.kind === 'links' && (hasMore || offset > 0)" class="pages"><el-button :disabled="loading || offset === 0" @click="page(-50)">{{ ot('ovPrevious') }}</el-button><span>{{ rows.length ? offset + 1 : 0 }}–{{ offset + rows.length }}</span><el-button :disabled="loading || !hasMore" @click="page(50)">{{ ot('ovNext') }}</el-button></div>
    </template>
    <template v-else-if="widget.kind === 'chart' && !failure">
      <ObjectViewVisualization :widget="widget" :rows="rows" :value="selectedData ?? bindingValue" />
    </template>
    <el-input v-else-if="widget.kind === 'input'" :model-value="format(variables[widget.variable] ?? '')" :placeholder="widget.text" @update:model-value="emit('variable', widget.variable, $event)" />
    <el-button v-else-if="widget.kind === 'button'" @click="click">{{ widget.text || widget.title }}</el-button>
    <el-button v-else-if="widget.kind === 'action'" type="primary" :disabled="preview || !widget.resourceId" @click="openAction">{{ widget.text || widget.title }}</el-button>
    <el-dialog v-model="actionOpen" class="object-action-dialog" :title="widget.title" width="min(480px, calc(100% - 32px))" :append-to-body="false">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <dl v-if="widget.contextFields.length" class="action-context properties"><template v-for="field in widget.contextFields" :key="field"><dt>{{ widget.fieldLabels[field] || fieldLabels[field] || field }}</dt><dd>{{ displayField(field, object[field]) }}</dd></template></dl>
      <el-form label-position="top" @submit.prevent="execute">
        <FormFields :fields="actionFormFields" :values="actionValues" :errors="actionErrors" :disabled="loading" :choose-placeholder="ot('ovChooseOption')" :read-only="widget.readOnlyParameters" @input="enterAction" @choose="(field, value) => enterAction(field.key, value)" />
      </el-form>
      <template #footer><el-button @click="actionOpen = false">{{ ot('ovCancel') }}</el-button><el-button type="primary" :loading="loading" @click="execute">{{ ot('ovSubmit') }}</el-button></template>
    </el-dialog>
  </div>
</template>
<style scoped>
.view-widget { min-width: 0; max-width: 100%; font-size: var(--text-sm); line-height: var(--leading-sm); }
.view-widget > .el-input { width: 100%; }
.view-widget > .el-button { max-width: 100%; height: auto; white-space: normal; }
.view-widget > .el-button :deep(> span) { min-width: 0; overflow-wrap: anywhere; }
.object-view-table { width: 100%; }
.object-view-table :deep(th.el-table__cell), .object-view-table :deep(td.el-table__cell) { font-size: var(--text-sm); line-height: 20px; }
.object-view-row-action { min-height: 28px; padding: 4px 8px; font-size: var(--text-sm); line-height: 20px; white-space: nowrap; flex-shrink: 0; }
.object-view-row-action :deep(> span) { line-height: 20px; }
.view-widget :deep(.el-button + .el-button) { margin-inline-start: 0; }
.view-widget > .el-alert { margin-bottom: 12px; overflow-wrap: anywhere; }
.view-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.properties { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,2fr); column-gap: 16px; row-gap: 12px; margin: 0; }
.properties dt, .properties dd { min-width: 0; overflow-wrap: anywhere; }
.properties dt { color: var(--el-text-color-secondary); }
.properties dd { margin: 0; white-space: pre-wrap; }
.metric { display: block; font-size: var(--text-3xl); font-weight: var(--font-semibold); line-height: 1.25; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pages { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: center; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--el-border-color-lighter); }
.pages span { font-size: var(--text-xs); color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.bars { display: grid; gap: 12px; overflow: auto; }
.bar-row { display: grid; grid-template-columns: minmax(0, 100px) minmax(24px, 1fr) minmax(0, 64px); gap: 12px; align-items: center; }
.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-value { text-align: end; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.bar-track { background: var(--el-fill-color); height: 12px; border-radius: 2px; overflow: hidden; }
.bar-track i { display: block; background: var(--el-color-primary); height: 100%; border-radius: inherit; }
svg { display: block; width: 100%; color: var(--el-color-primary); }
.action-context { padding: var(--manager-content-gap); margin-bottom: var(--manager-module-gap); border-radius: var(--radius-sm); background: var(--el-fill-color-light); }
.widget-state { display: grid; place-items: center; min-height: 96px; margin: 0; padding: 16px; color: var(--el-text-color-secondary); text-align: center; }
@container view-card (max-width: 260px) {
  .properties { grid-template-columns: minmax(0, 1fr); row-gap: 4px; }
  .properties dd + dt { margin-top: 8px; }
  .bar-row { grid-template-columns: minmax(0, 72px) minmax(16px, 1fr) minmax(0, 48px); gap: 8px; }
  .metric { font-size: var(--text-2xl); }
}
</style>
