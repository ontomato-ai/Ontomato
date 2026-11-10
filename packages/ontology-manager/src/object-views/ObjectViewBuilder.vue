<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2, Upload } from "lucide-vue-next";
import { ElAlert, ElButton, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from "element-plus";
import { createObjectView, createViewWidget, objectViewDocumentSchema, type ObjectReference, type ObjectViewDocument, type ObjectViewState, type ViewWidget } from "@ontomato/contracts/object-views";
import { randomId } from "@ontomato/contracts/random-id";
import { useManagerClient, useOntologyText } from "../context";
import { widgetMessageKeys } from "./messages";
import { useManagerFeedback } from "../feedback";
import type { OntologyObject, OntologyRelation, SmartAsset } from "../api";
import ObjectViewRuntime from "./ObjectViewRuntime.vue";
import ViewBindingEditor from "./ViewBindingEditor.vue";
import { instanceName } from "./instance-name";

const props = defineProps<{ className: string; initialPrimaryKey?: string }>();
const emit = defineEmits<{ back: []; open: [reference: ObjectReference] }>();
const client = useManagerClient();
const { ot } = useOntologyText();
const { confirm } = useManagerFeedback();
const form = "full" as const;
const document = ref<ObjectViewDocument>(createObjectView(props.className));
const saved = ref("");
const dirty = computed(() => JSON.stringify(document.value) !== saved.value);
const state = ref<ObjectViewState>({ revision: 0, publishedRevision: null, versions: [] });
const objectType = ref<OntologyObject>();
const relations = ref<OntologyRelation[]>([]);
const metrics = ref<SmartAsset[]>([]);
const actions = ref<SmartAsset[]>([]);
const skills = ref<Array<{ id: string; title?: string }>>([]);
const busy = ref(false);
const loaded = ref(false);
const error = ref("");
const preview = ref(false);
const mobilePane = ref<"components" | "canvas" | "settings">("canvas");
const previewKey = ref(props.initialPrimaryKey || "");
const previewOptions = ref<Array<{ value: string; label: string }>>([]);
const selectedPreviewOption = ref<{ value: string; label: string }>();
const searchingObjects = ref(false);
const objectOptions = computed(() => selectedPreviewOption.value && !previewOptions.value.some(option => option.value === selectedPreviewOption.value?.value)
  ? [selectedPreviewOption.value, ...previewOptions.value] : previewOptions.value);
const previewObject = ref<Record<string, unknown>>({});
const previewReference = ref<ObjectReference>({ className: props.className, primaryKey: "" });
const selectedTab = ref("");
const selectedSection = ref("");
const selectedWidget = ref("");
const description = ref("");
const historyRevision = ref<number>();
const parameterName = ref("");
const variableName = ref("");
const variableValue = ref("");
const tab = computed(() => document.value.tabs.find(item => item.id === selectedTab.value) || document.value.tabs[0]);
const section = computed(() => tab.value?.sections.find(item => item.id === selectedSection.value) || tab.value?.sections[0]);
const widget = computed(() => section.value?.widgets.find(item => item.id === selectedWidget.value));
const kinds: ViewWidget["kind"][] = ["text", "properties", "metric", "table", "chart", "links", "input", "action", "button"];
const reference = computed(() => previewReference.value);
const bindingVariables = computed(() => [...new Set([
  ...Object.keys(document.value.variables),
  ...document.value.tabs.flatMap(tab => tab.sections.flatMap(section => section.widgets.map(widget => widget.variable))).filter(Boolean),
])]);
const bindingContext = computed(() => ({ variables: bindingVariables.value, defaultVariables: Object.keys(document.value.variables), properties: objectType.value?.attrs.filter(attr => attr.enable !== false) || [] }));
const queryBinding = computed(() => widget.value && ["metric", "table", "chart"].includes(widget.value.kind) && !!widget.value.resourceId);
const relationOptions = computed(() => relations.value.filter(item => (widget.value?.direction === "incoming" ? item.toclass : item.fromclass) === props.className));
let generation = 0;
let dragging = "";
let sampleRequest = 0;
let objectSearchRequest = 0;

async function load() {
  const current = ++generation;
  busy.value = true;
  loaded.value = false;
  error.value = "";
  try {
    const [result, ontology, metricAssets, actionAssets] = await Promise.all([
      client.objectViewRequest("edit", props.className, form), client.loadOntology(), client.loadSmartAssets("metrics"), client.loadSmartAssets("actions"),
    ]);
    if (current !== generation) return;
    state.value = result;
    objectType.value = ontology.objects.find(item => item.className === props.className);
    relations.value = ontology.relations;
    metrics.value = metricAssets.filter(item => item.status === "PUBLISHED");
    actions.value = actionAssets.filter(item => item.status === "PUBLISHED");
    document.value = result.versions[0] ? objectViewDocumentSchema.parse(result.versions[0].document) : createObjectView(props.className, objectType.value?.showName);
    if (!result.versions[0]) document.value.tabs[0].sections[0].widgets[0].title = ot('ovKindProperties');
    saved.value = JSON.stringify(document.value);
    selectedTab.value = document.value.tabs[0].id;
    selectedSection.value = document.value.tabs[0].sections[0].id;
    selectedWidget.value = "";
    historyRevision.value = undefined;
    loaded.value = true;
    if (previewKey.value) void sample();
    void client.loadViewSkills().then(result => { if (current === generation) skills.value = result; }).catch(() => {});
  } catch (reason) { if (current === generation) error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { if (current === generation) busy.value = false; }
}
watch(() => props.className, () => { sampleRequest++; objectSearchRequest++; searchingObjects.value = false; previewOptions.value = []; selectedPreviewOption.value = undefined; previewKey.value = props.initialPrimaryKey || ""; previewObject.value = {}; previewReference.value = { className: props.className, primaryKey: "" }; void load(); }, { immediate: true });
async function searchPreviewObjects(keyword: string) {
  const current = ++objectSearchRequest;
  const className = props.className;
  searchingObjects.value = true;
  try {
    const result = await client.loadObjectData(className, 1, 25, keyword.trim() || undefined);
    if (current !== objectSearchRequest || className !== props.className) return;
    const key = objectType.value?.attrs.find(attr => attr.primaryKey)?.name;
    const rows: Record<string, unknown>[] = result.rows;
    previewOptions.value = key ? rows.filter(row => row[key] != null).map(row => ({
      value: String(row[key]), label: instanceName(objectType.value?.attrs || [], row),
    })) : [];
  } catch (reason) {
    if (current === objectSearchRequest) { previewOptions.value = []; error.value = reason instanceof Error ? reason.message : String(reason); }
  } finally { if (current === objectSearchRequest) searchingObjects.value = false; }
}
function selectPreviewObject(value: string) {
  sampleRequest++;
  selectedPreviewOption.value = objectOptions.value.find(option => option.value === value);
}
async function sample() {
  const current = ++sampleRequest;
  const className = props.className;
  let primaryKey = previewKey.value;
  error.value = "";
  try {
    if (!primaryKey) {
      const result = await client.loadObjectData(className, 1, 1);
      const key = objectType.value?.attrs.find(attr => attr.primaryKey)?.name;
      if (!key || result.rows[0]?.[key] == null) throw new Error(ot("ovNoPreview"));
      primaryKey = String(result.rows[0][key]);
    }
    const result = await client.queryInstanceInfo(`${className}:${primaryKey}`, className);
    if (current !== sampleRequest || className !== props.className) return;
    previewKey.value = primaryKey;
    previewObject.value = (result.data || {}) as Record<string, unknown>;
    selectedPreviewOption.value = { value: primaryKey, label: instanceName(objectType.value?.attrs || [], previewObject.value) };
    previewReference.value = { className, primaryKey };
  } catch (reason) { if (current === sampleRequest) error.value = reason instanceof Error ? reason.message : String(reason); }
}
async function save(publish = false) {
  if (busy.value || !loaded.value) return;
  busy.value = true;
  error.value = "";
  try {
    const validated = objectViewDocumentSchema.parse(document.value);
    state.value = await client.saveObjectView(validated, form, state.value.revision, description.value);
    saved.value = JSON.stringify(validated);
    description.value = "";
    if (publish) state.value = await client.objectViewRequest("publish", props.className, form, { revision: state.value.revision, expectedRevision: state.value.revision });
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function publishVersion() {
  if (!historyRevision.value || busy.value || !loaded.value) return;
  error.value = "";
  busy.value = true;
  try { state.value = await client.objectViewRequest("publish", props.className, form, { revision: historyRevision.value, expectedRevision: state.value.revision }); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function restoreVersion() {
  const version = state.value.versions.find(item => item.revision === historyRevision.value);
  if (!version) return;
  if (dirty.value) { try { await confirm(ot("ovRestoreConfirm"), ot("ovRestoreVersion")); } catch { return; } }
  document.value = objectViewDocumentSchema.parse(version.document);
  selectedTab.value = document.value.tabs[0].id;
  selectedSection.value = document.value.tabs[0].sections[0].id;
  selectedWidget.value = "";
}
function addWidget(kind: ViewWidget["kind"]) {
  if (!section.value) return;
  const item = createViewWidget(kind);
  item.title = ot(widgetMessageKeys[kind]);
  section.value.widgets.push(item);
  selectedWidget.value = item.id;
  mobilePane.value = "canvas";
}
function widgetSummary(item: ViewWidget) {
  if (item.kind === "text") return item.text;
  if (item.kind === "properties") return item.fields.join(", ") || ot("ovAllProperties");
  if (item.resourceId) return (item.kind === "action" ? actions.value : metrics.value).find(asset => asset.id === item.resourceId)?.name || ot("ovResourceUnavailable");
  if (item.relation) return relations.value.find(relation => relation.relationship === item.relation)?.showName || relations.value.find(relation => relation.relationship === item.relation)?.desc || item.relation;
  return ot("ovSelectConfigure");
}
function addTab() {
  const item = { id: randomId(), title: ot("ovNewTab"), sections: [{ id: randomId(), title: "", widgets: [] }] };
  document.value.tabs.push(item);
  selectedTab.value = item.id;
  selectedSection.value = item.sections[0].id;
  selectedWidget.value = "";
}
function addSection() {
  const item = { id: randomId(), title: ot("ovNewSection"), widgets: [] };
  tab.value.sections.push(item);
  selectedSection.value = item.id;
  selectedWidget.value = "";
}
function moveWidget(id: string, targetSection: string, index: number) {
  const sections = document.value.tabs.flatMap(item => item.sections);
  const origin = sections.find(item => item.widgets.some(candidate => candidate.id === id));
  const target = sections.find(item => item.id === targetSection);
  if (!origin || !target) return;
  const from = origin.widgets.findIndex(item => item.id === id);
  const [item] = origin.widgets.splice(from, 1);
  target.widgets.splice(Math.max(0, Math.min(index, target.widgets.length)), 0, item);
  selectedSection.value = target.id;
  selectedWidget.value = item.id;
}
function removeWidget() {
  if (!section.value || !widget.value) return;
  const index = section.value.widgets.findIndex(item => item.id === widget.value?.id);
  if (index >= 0) section.value.widgets.splice(index, 1);
  selectedWidget.value = "";
}
function drop(target: string, index: number) { moveWidget(dragging, target, index); dragging = ""; }
function addParameter() {
  const name = parameterName.value.trim();
  if (!name || !widget.value || ["__proto__", "constructor", "prototype"].includes(name)) return;
  widget.value.parameters[name] = { source: "object", path: objectType.value?.attrs.find(attr => attr.primaryKey)?.name || "" };
  parameterName.value = "";
}
function addVariable() {
  const name = variableName.value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) return;
  document.value.variables[name] = variableValue.value;
  variableName.value = "";
  variableValue.value = "";
}
async function back() {
  if (!await canLeave()) return;
  emit("back");
}
async function canLeave() {
  if (busy.value) return false;
  if (loaded.value && dirty.value) { try { await confirm(ot("ovDiscard"), ot("ovLeaveEditor")); } catch { return false; } }
  return true;
}
defineExpose({ canLeave });
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = ""; } }
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => { generation++; sampleRequest++; objectSearchRequest++; window.removeEventListener("beforeunload", beforeUnload); });
</script>
<template>
  <div class="view-builder">
    <header class="builder-header">
      <div class="builder-heading"><el-button text :icon="ArrowLeft" @click="back">{{ ot('ovBack') }}</el-button><span class="builder-title-divider" /><div class="builder-title"><strong>{{ ot('ovTitle') }}</strong><span :title="objectType?.showName || className">{{ objectType?.showName || className }}</span></div>
      </div>
      <div class="builder-actions"><span class="version-status">v{{ state.revision }} · {{ ot('ovPublished') }} {{ state.publishedRevision ?? '—' }} {{ dirty ? '· ' + ot('ovUnsaved') : '' }}</span>
        <el-switch v-model="preview" :active-text="ot('ovPreview')" /><el-button type="primary" plain :icon="Save" :disabled="!loaded" :loading="busy" @click="save()">{{ ot('ovSaveDraft') }}</el-button><el-button type="primary" :icon="Upload" :disabled="!loaded" :loading="busy" @click="save(true)">{{ ot('ovSavePublish') }}</el-button>
      </div>
    </header>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <nav class="pane-navigation" :aria-label="ot('ovEditorPanels')"><el-button v-for="pane in (['components', 'canvas', 'settings'] as const)" :key="pane" :type="mobilePane === pane ? 'primary' : 'default'" :aria-pressed="mobilePane === pane" @click="mobilePane = pane">{{ ot(({ components: 'ovComponents', canvas: 'ovCanvas', settings: 'ovSettings' } as const)[pane]) }}</el-button></nav>
    <div class="builder-body" :data-pane="mobilePane" :inert="busy || !loaded">
      <aside class="palette">
        <h3>{{ ot('ovComponents') }}</h3><el-button v-for="kind in kinds" :key="kind" :disabled="busy || preview" @click="addWidget(kind)">{{ ot(widgetMessageKeys[kind]) }}</el-button>
        <h3>{{ ot('ovObjectPreview') }}</h3>
        <el-select v-model="previewKey" class="preview-object-select" filterable remote clearable :remote-method="searchPreviewObjects" :loading="searchingObjects" :placeholder="ot('ovSearchObjects')" :aria-label="ot('ovSearchObjects')" @visible-change="$event && searchPreviewObjects('')" @change="selectPreviewObject">
          <el-option v-for="option in objectOptions" :key="option.value" :value="option.value" :label="option.label" :title="option.label" />
        </el-select>
        <el-button :disabled="busy" @click="sample">{{ ot('ovLoadObject') }}</el-button>
        <h3>{{ ot('ovVariables') }}</h3>
        <div v-for="(value, name) in document.variables" :key="name" class="variable-item">
          <div class="variable-heading">
            <span class="variable-name" :title="name">{{ name }}</span>
            <el-button class="variable-remove" link :icon="Trash2" :title="ot('ovRemove')" :aria-label="`${ot('ovRemove')} ${name}`" @click="delete document.variables[name]" />
          </div>
          <el-input :model-value="String(value ?? '')" :aria-label="name" @update:model-value="document.variables[name] = $event" />
        </div>
        <el-input v-model="variableName" :placeholder="ot('ovVariableName')" /><el-input v-model="variableValue" :placeholder="ot('ovDefaultValue')" /><el-button @click="addVariable">{{ ot('ovAddVariable') }}</el-button>
        <h3>{{ ot('ovVersions') }}</h3><el-input v-model="description" :placeholder="ot('ovVersionDescription')" />
        <el-select v-model="historyRevision" :placeholder="ot('ovChooseVersion')"><el-option v-for="version in state.versions" :key="version.revision" :value="version.revision" :label="`v${version.revision} · ${version.description || version.author}`" /></el-select>
        <el-button :disabled="!historyRevision || busy" @click="restoreVersion">{{ ot('ovLoadVersion') }}</el-button><el-button type="primary" plain :disabled="!historyRevision || busy" @click="publishVersion">{{ ot('ovPublishVersion') }}</el-button>
      </aside>
      <main class="canvas">
        <ObjectViewRuntime v-if="preview" :document="document" :object="previewObject" :reference="reference" preview @refresh="sample" @open="emit('open', $event)" />
        <template v-else>
          <div class="tab-bar"><el-button v-for="item in document.tabs" :key="item.id" :type="item.id === tab.id ? 'primary' : 'default'" @click="selectedTab = item.id; selectedSection = item.sections[0].id">{{ item.title }}</el-button><el-button @click="addTab">{{ ot('ovAddTab') }}</el-button></div>
          <div class="layout-controls"><el-input v-model="tab.title" :placeholder="ot('ovTabTitle')" /><el-button :disabled="document.tabs.length === 1" @click="document.tabs.splice(document.tabs.indexOf(tab), 1)">{{ ot('ovDeleteTab') }}</el-button><el-button @click="addSection">{{ ot('ovAddSection') }}</el-button></div>
          <section v-for="item in tab.sections" :key="item.id" :class="['canvas-section', { selected: section.id === item.id }]" @click.self="selectedSection = item.id" @dragover.prevent @drop.stop.prevent="drop(item.id, item.widgets.length)">
            <div class="layout-controls"><el-input v-model="item.title" :placeholder="ot('ovSectionTitle')" @focus="selectedSection = item.id" /><el-button :disabled="tab.sections.length === 1" @click="tab.sections.splice(tab.sections.indexOf(item), 1)">{{ ot('ovDeleteSection') }}</el-button></div>
            <div class="canvas-grid">
              <article v-for="(itemWidget, index) in item.widgets" :key="itemWidget.id" :class="['canvas-widget', { selected: widget?.id === itemWidget.id }]" :style="{ gridColumn: 'span ' + itemWidget.span }" draggable="true" @dragstart="dragging = itemWidget.id" @dragover.prevent @drop.stop.prevent="drop(item.id, index)" @click="selectedWidget = itemWidget.id; selectedSection = item.id">
                <div class="widget-tools"><span>{{ ot(widgetMessageKeys[itemWidget.kind]) }}</span><el-button text size="small" :icon="ArrowUp" :title="ot('ovMoveUp')" :aria-label="ot('ovMoveUp')" :disabled="index === 0" @click.stop="moveWidget(itemWidget.id, item.id, index - 1)" /><el-button text size="small" :icon="ArrowDown" :title="ot('ovMoveDown')" :aria-label="ot('ovMoveDown')" :disabled="index === item.widgets.length - 1" @click.stop="moveWidget(itemWidget.id, item.id, index + 1)" /><el-button class="configure-widget" text size="small" @click.stop="selectedWidget = itemWidget.id; selectedSection = item.id; mobilePane = 'settings'">{{ ot('ovEdit') }}</el-button></div>
                <strong>{{ itemWidget.title }}</strong><p>{{ widgetSummary(itemWidget) }}</p>
              </article>
            </div><p v-if="!item.widgets.length" @click="selectedSection = item.id">{{ ot('ovEmptySection') }}</p>
          </section>
        </template>
      </main>
      <aside class="inspector">
        <h3>{{ ot('ovViewSettings') }}</h3><label>{{ ot('ovName') }}<el-input v-model="document.title" /></label><label>{{ ot('ovTitleProperty') }}<el-select v-model="document.titleField" clearable><el-option v-for="attr in objectType?.attrs.filter(item => item.enable !== false && item.bizzkeyBool)" :key="attr.name" :value="attr.name" :label="attr.showName" /></el-select></label>
        <template v-if="widget && !preview">
          <h3>{{ ot('ovWidgetSettings', { kind: ot(widgetMessageKeys[widget.kind]) }) }}</h3><label>{{ ot('ovName') }}<el-input v-model="widget.title" /></label>
          <div class="widget-dimensions"><label>{{ ot('ovWidth') }}<el-input-number v-model="widget.span" controls-position="right" :min="1" :max="12" /></label><label>{{ ot('ovHeight') }}<el-input-number v-model="widget.height" controls-position="right" :min="80" :max="1200" /></label></div>
          <label v-if="['properties', 'table', 'links'].includes(widget.kind)">{{ ot('ovFields') }}<el-select v-if="widget.kind === 'properties'" v-model="widget.fields" multiple clearable><el-option v-for="attr in objectType?.attrs" :key="attr.name" :value="attr.name" :label="attr.showName" /></el-select><el-input v-else :model-value="widget.fields.join(', ')" :placeholder="ot('ovFieldNames')" @update:model-value="widget.fields = $event.split(',').map(value => value.trim()).filter(Boolean)" /></label>
          <label v-if="['text', 'button', 'action', 'input'].includes(widget.kind)">{{ ot('ovText') }}<el-input v-model="widget.text" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" /></label>
          <label v-if="['metric', 'table', 'chart'].includes(widget.kind)">{{ ot('ovMetricView') }}<el-select v-model="widget.resourceId" clearable filterable><el-option v-for="asset in metrics" :key="asset.id" :value="asset.id!" :label="asset.name" /></el-select></label>
          <label v-if="widget.kind === 'action'">{{ ot('ovAction') }}<el-select v-model="widget.resourceId" filterable><el-option v-for="asset in actions" :key="asset.id" :value="asset.id!" :label="asset.name" /></el-select></label>
          <label v-if="widget.kind === 'chart'">{{ ot('ovVisualizationSkill') }}<el-select v-model="widget.skillId" filterable><el-option v-for="skill in skills" :key="skill.id" :value="skill.id" :label="skill.title || skill.id" /></el-select></label>
          <section v-if="widget.resourceId" class="parameter-settings">
            <h4>{{ ot('ovParameterBindings') }}</h4>
            <div v-for="(_, name) in widget.parameters" :key="name" class="parameter">
              <div class="parameter-heading"><span>{{ name }}</span><el-button class="parameter-remove" link :icon="Trash2" :title="ot('ovRemove')" :aria-label="`${ot('ovRemove')} ${name}`" @click="delete widget.parameters[name]" /></div>
              <ViewBindingEditor v-model="widget.parameters[name]" v-bind="bindingContext" />
            </div>
            <div class="parameter-add"><el-input v-model="parameterName" :placeholder="ot('ovParameterName')" :aria-label="ot('ovParameterName')" @keyup.enter="addParameter" /><el-button :icon="Plus" @click="addParameter">{{ ot('ovAddParameter') }}</el-button></div>
          </section>
          <label v-if="['metric','table','chart'].includes(widget.kind)">{{ ot('ovResultPath') }}<el-input v-model="widget.resultPath" :placeholder="ot('ovResultPathHint')" /></label>
          <section v-if="['metric','table','chart','button','text'].includes(widget.kind)" class="binding-settings" :aria-label="ot('ovBindValue')">
            <div class="settings-heading"><h4>{{ ot('ovBindValue') }}</h4><el-switch :model-value="!!widget.binding" :aria-label="ot('ovBindValue')" @update:model-value="widget.binding = $event ? { source: 'object', path: objectType?.attrs.find(attr => attr.primaryKey)?.name || '' } : undefined" /></div>
            <p v-if="queryBinding" class="settings-hint">{{ ot(widget.kind === 'metric' ? 'ovMetricBindingHint' : 'ovQueryBindingHint') }}</p>
            <ViewBindingEditor v-if="widget.binding" v-model="widget.binding" v-bind="bindingContext" />
          </section>
          <template v-if="widget.kind === 'chart'"><label>{{ ot('ovChartType') }}<el-select v-model="widget.chartType"><el-option :label="ot('ovBar')" value="bar" /><el-option :label="ot('ovLine')" value="line" /><el-option :label="ot('ovDonut')" value="donut" /><el-option :label="ot('ovTimeline')" value="timeline" /><el-option :label="ot('ovGraph')" value="graph" /><el-option :label="ot('ovMap')" value="leaflet-map" /></el-select></label><label v-if="widget.chartType !== 'graph'">{{ ot('ovLabelField') }}<el-input v-model="widget.labelField" /></label></template>
          <template v-if="widget.kind === 'chart' && widget.chartType === 'leaflet-map'"><label>{{ ot('ovLatitudeField') }}<el-input v-model="widget.latitudeField" /></label><label>{{ ot('ovLongitudeField') }}<el-input v-model="widget.longitudeField" /></label></template>
          <template v-if="widget.kind === 'chart' && widget.chartType === 'timeline'"><label>{{ ot('ovDateField') }}<el-input v-model="widget.dateField" /></label><label>{{ ot('ovDescriptionField') }}<el-input v-model="widget.descriptionField" /></label></template>
          <label v-if="['metric','chart','table'].includes(widget.kind)">{{ ot('ovValueField') }}<el-input v-model="widget.valueField" /></label>
          <template v-if="widget.kind === 'links'"><label>{{ ot('ovDirection') }}<el-select v-model="widget.direction" @change="widget!.relation = ''"><el-option :label="ot('ovOutgoing')" value="outgoing" /><el-option :label="ot('ovIncoming')" value="incoming" /></el-select></label><label>{{ ot('ovRelationship') }}<el-select v-model="widget.relation"><el-option v-for="relation in relationOptions" :key="relation.relationship" :value="relation.relationship" :label="relation.showName" /></el-select></label></template>
          <label v-if="['input','table','links','button'].includes(widget.kind)">{{ ot('ovSelectionVariable') }}<el-input v-model="widget.variable" /></label>
          <label v-if="widget.kind === 'button'">{{ ot('ovClickEvent') }}<el-select v-model="widget.onClick"><el-option :label="ot('ovRefreshData')" value="refresh" /><el-option :label="ot('ovSetVariable')" value="setVariable" /><el-option :label="ot('ovOpenObject')" value="openObject" /></el-select></label>
          <label v-if="['table','button'].includes(widget.kind) || widget.kind === 'chart' && widget.chartType === 'timeline'">{{ ot('ovTargetType') }}<el-input v-model="widget.targetClass" /></label>
          <section class="binding-settings" :aria-label="ot('ovVisibility')">
            <div class="settings-heading"><h4>{{ ot('ovVisibility') }}</h4><el-switch :model-value="!!widget.visibleWhen" :aria-label="ot('ovVisibility')" @update:model-value="widget.visibleWhen = $event ? { binding: { source: 'object', path: objectType?.attrs.find(attr => attr.primaryKey)?.name || '' }, operator: 'present', value: '' } : undefined" /></div>
            <p class="settings-hint">{{ ot(widget.visibleWhen ? 'ovConditionHint' : 'ovAlwaysVisible') }}</p>
            <div v-if="widget.visibleWhen" class="condition-fields">
              <ViewBindingEditor v-model="widget.visibleWhen.binding" v-bind="bindingContext" />
              <label>{{ ot('ovConditionOperator') }}<el-select v-model="widget.visibleWhen.operator" :aria-label="ot('ovConditionOperator')"><el-option v-for="operator in (['eq','ne','present','empty'] as const)" :key="operator" :value="operator" :label="ot(({ eq: 'ovEqual', ne: 'ovNotEqual', present: 'ovPresent', empty: 'ovEmpty' } as const)[operator])" /></el-select></label>
              <label v-if="['eq','ne'].includes(widget.visibleWhen.operator)">{{ ot('ovComparisonValue') }}<el-input v-model="widget.visibleWhen.value" :aria-label="ot('ovComparisonValue')" /></label>
              <p class="settings-hint">{{ ot(['eq','ne'].includes(widget.visibleWhen.operator) ? 'ovComparisonHint' : 'ovPresenceHint') }}</p>
            </div>
          </section>
          <div class="inspector-footer"><el-button type="danger" plain @click="removeWidget">{{ ot('ovDeleteComponent') }}</el-button></div>
        </template>
        <p v-else-if="!preview" class="inspector-hint">{{ ot('ovInspectorHint') }}</p>
      </aside>
    </div>
  </div>
</template>
<style scoped>
.view-builder {
  height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column;
  overflow: hidden; container: view-builder / inline-size; background: var(--el-bg-color);
}
.view-builder :deep(.el-button + .el-button) { margin-inline-start: 0; }
.builder-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--el-border-color); flex-shrink: 0; }
.builder-heading, .builder-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-width: 0; }
.builder-heading { flex: 1 1 300px; }
.builder-title-divider { width: 1px; height: 22px; background: var(--el-border-color); }
.builder-title { display: grid; gap: 4px; min-width: 0; max-width: 240px; }
.builder-title strong { font-size: var(--text-sm); line-height: 20px; }
.builder-title span { font-size: var(--text-xs); color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.version-status { font-size: var(--text-xs); color: var(--el-text-color-secondary); line-height: 20px; }
.builder-body { display: grid; grid-template-columns: 200px minmax(0, 1fr) 300px; flex: 1; min-height: 0; min-width: 0; }
.palette, .inspector { min-width: 0; overflow: auto; padding: 20px 16px; scrollbar-gutter: stable; }
.palette { border-inline-end: 1px solid var(--el-border-color); }
.inspector { border-inline-start: 1px solid var(--el-border-color); font-size: var(--text-sm); line-height: 20px; --el-font-size-base: var(--text-sm); }
.inspector :deep(.el-input), .inspector :deep(.el-select), .inspector :deep(.el-input-number), .inspector :deep(.el-textarea) { min-width: 0; max-width: 100%; font-size: var(--text-sm); }
.inspector :deep(.el-input__wrapper), .inspector :deep(.el-select__wrapper) { min-height: 32px; box-sizing: border-box; }
.inspector :deep(.el-textarea__inner) { font-family: inherit; font-size: var(--text-sm); line-height: 22px; padding: 8px 12px; }
.inspector :deep(.el-button) { min-height: 32px; font-size: var(--text-sm); }
.palette h3, .inspector h3 { margin: 24px 0 12px; padding-top: 20px; border-top: 1px solid var(--el-border-color-lighter); font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 20px; }
.palette h3:first-child, .inspector h3:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.palette > .el-button { display: flex; justify-content: flex-start; width: 100%; height: auto; min-height: 32px; padding: 6px 12px; margin: 0 0 8px; text-align: start; white-space: normal; text-transform: capitalize; }
.palette > .el-button :deep(> span) { min-width: 0; line-height: 18px; overflow-wrap: anywhere; }
.palette > .el-input, .palette > .el-select { width: 100%; margin-bottom: 8px; }
.variable-item { display: grid; gap: 6px; min-width: 0; margin-bottom: 16px; }
.variable-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.variable-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); line-height: 20px; }
.variable-remove.el-button { flex-shrink: 0; width: 28px; height: 28px; padding: 6px; color: var(--el-text-color-secondary); }
.canvas { min-width: 0; overflow: auto; padding: 24px; background: var(--el-fill-color-light); scrollbar-gutter: stable; }
.tab-bar { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding: 2px 2px 12px; margin-bottom: 12px; }
.tab-bar > .el-button { flex-shrink: 0; max-width: 240px; overflow: hidden; }
.layout-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.layout-controls .el-input { flex: 1 1 140px; min-width: 0; }
.canvas-section { padding: 16px; margin-bottom: 20px; border: 1px dashed var(--el-border-color-dark); border-radius: var(--radius-sm, 4px); transition: border-color .15s; }
.canvas-grid { display: grid; grid-template-columns: repeat(12,minmax(0,1fr)); gap: 16px; min-height: 80px; align-items: stretch; }
.canvas-widget { padding: 16px; min-width: 0; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm, 4px); background: var(--el-bg-color); cursor: grab; overflow-wrap: anywhere; transition: border-color .15s, box-shadow .15s; }
.canvas-widget:hover { border-color: var(--el-color-primary-light-5); }
.canvas-section.selected, .canvas-widget.selected { border-color: var(--el-color-primary); }
.canvas-widget.selected { box-shadow: 0 0 0 1px var(--el-color-primary); }
.canvas-widget strong { display: block; font-size: var(--text-sm); line-height: 22px; }
.canvas-widget p, .canvas-section > p, .inspector-hint { margin: 8px 0 0; color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 20px; overflow-wrap: anywhere; }
.widget-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: var(--text-xs); color: var(--el-text-color-secondary); margin-bottom: 12px; }
.widget-tools > span { flex: 1; text-transform: capitalize; }
.widget-tools .el-button { padding: 4px 6px; }
.configure-widget { display: none; }
.palette label { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-bottom: 16px; font-size: var(--text-xs); line-height: 20px; overflow-wrap: anywhere; }
.inspector label { display: flex; flex-direction: column; align-items: stretch; gap: 6px; min-width: 0; margin: 0 0 16px; font-size: var(--text-sm); line-height: 20px; color: var(--el-text-color-regular); overflow-wrap: anywhere; }
.inspector label > .el-input, .inspector label > .el-select, .inspector label > .el-input-number { width: 100%; }
.widget-dimensions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.parameter-settings { min-width: 0; margin-bottom: 20px; }
.parameter-add { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.parameter-add > .el-input { flex: 1 1 120px; min-width: 0; }
.parameter-add > .el-button { max-width: 100%; height: auto; padding: 5px 12px; line-height: 20px; white-space: normal; }
.parameter-add > .el-button :deep(> span) { min-width: 0; line-height: 20px; overflow-wrap: anywhere; }
.inspector-footer { padding-top: 20px; margin-top: 4px; border-top: 1px solid var(--el-border-color-lighter); }
.inspector-footer > .el-button { width: 100%; height: auto; padding: 5px 12px; line-height: 20px; white-space: normal; }
.parameter { display: grid; gap: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: var(--radius-sm, 4px); }
.parameter-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.parameter-heading > span { min-width: 0; font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 20px; overflow-wrap: anywhere; }
.parameter-remove.el-button { flex-shrink: 0; width: 28px; min-height: 28px; height: 28px; padding: 6px; color: var(--el-text-color-secondary); }
.inspector h4 { margin: 0 0 12px; font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 20px; }
.binding-settings { display: grid; gap: 12px; min-width: 0; padding: 16px 0; margin-bottom: 4px; border-top: 1px solid var(--el-border-color-lighter); }
.settings-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-heading h4 { margin: 0; }
.settings-hint { margin: 0; font-size: var(--text-xs); line-height: 20px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.condition-fields { display: grid; gap: 12px; min-width: 0; }
.condition-fields > label { margin: 0; }
.pane-navigation { display: none; }
@container view-builder (max-width: 1080px) {
  .builder-body { grid-template-columns: 168px minmax(0,1fr) 264px; }
  .canvas { padding: 16px; }
  .builder-header { padding: 16px; }
  .builder-actions { flex: 1 1 100%; justify-content: flex-end; }
  .version-status { margin-inline-end: auto; }
}
@container view-builder (max-width: 820px) {
  .pane-navigation { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--el-border-color); flex-shrink: 0; }
  .pane-navigation .el-button { text-transform: capitalize; flex: 1; }
  .builder-body { grid-template-columns: minmax(0,1fr); }
  .builder-body > .palette, .builder-body > .inspector, .builder-body > .canvas { display: none; }
  .builder-body[data-pane="components"] > .palette, .builder-body[data-pane="settings"] > .inspector, .builder-body[data-pane="canvas"] > .canvas { display: block; }
  .palette, .inspector { border: 0; padding: 20px; }
  .configure-widget { display: inline-flex; }
}
@container view-builder (max-width: 480px) {
  .builder-header { gap: 12px; padding: 12px; }
  .builder-heading, .builder-actions { gap: 8px; }
  .version-status { flex-basis: 100%; }
  .builder-title { flex: 1; max-width: none; }
  .canvas { padding: 12px; }
  .canvas-section, .canvas-widget { padding: 12px; }
  .canvas-widget { grid-column: span 12 !important; }
}
</style>
