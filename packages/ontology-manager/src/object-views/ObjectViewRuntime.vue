<script setup lang="ts">
import { ref, watch } from "vue";
import { ElTabs, ElTabPane } from "element-plus";
import { resolveViewParameters, viewConditionMatches, type ObjectViewDocument, type ObjectReference, type ViewWidget } from "@ontomato/contracts/object-views";
import MetricViewData from "../app-components/MetricViewData.vue";
import ObjectViewWidget from "./ObjectViewWidget.vue";
const props = defineProps<{ document: ObjectViewDocument; object: Record<string, unknown>; reference: ObjectReference; preview?: boolean }>();
const emit = defineEmits<{ open: [reference: ObjectReference]; refresh: [] }>();
const variables = ref<Record<string, unknown>>({});
const refresh = ref(0);
const activeTab = ref("");
watch(() => props.document, document => {
  variables.value = { ...document.variables };
  if (!document.tabs.some(tab => tab.id === activeTab.value)) activeTab.value = document.tabs[0]?.id || "";
}, { immediate: true });
watch(() => JSON.stringify([props.reference.className, props.reference.primaryKey]), () => { variables.value = { ...props.document.variables }; });
function reload() { refresh.value++; emit("refresh"); }
/** Keep fixed-value text separate so Java can interpret it against the current definition. */
function metricParameters(widget: ViewWidget) {
  return resolveViewParameters(Object.fromEntries(Object.entries(widget.parameters)
    .filter(([, binding]) => !(binding.source === "literal" && typeof binding.value === "string"))), props.object, variables.value);
}
function metricParameterTexts(widget: ViewWidget) {
  return Object.fromEntries(Object.entries(widget.parameters)
    .filter((entry): entry is [string, { source: "literal"; value: string }] => entry[1].source === "literal" && typeof entry[1].value === "string")
    .map(([name, binding]) => [name, binding.value]));
}
function readsMetricView(widget: ViewWidget) { return ["metric", "table", "chart"].includes(widget.kind) && !!widget.resourceId; }
</script>
<template>
  <div class="object-view-runtime">
    <el-tabs v-model="activeTab">
      <el-tab-pane v-for="tab in document.tabs" :key="tab.id" :name="tab.id" :label="tab.title" lazy>
        <section v-for="section in tab.sections" :key="section.id" class="view-section">
          <h3 v-if="section.title">{{ section.title }}</h3>
          <div class="view-grid">
            <template v-for="widget in section.widgets" :key="widget.id">
              <article v-if="viewConditionMatches(widget.visibleWhen, object, variables)" :style="{ gridColumn: 'span ' + widget.span }" :class="['widget-card', { 'chart-card': widget.kind === 'chart' }]" :data-kind="widget.kind">
                <h4 v-if="widget.title">{{ widget.title }}</h4>
                <MetricViewData v-if="readsMetricView(widget)" v-slot="read" :metric-view-id="widget.resourceId" :parameters="metricParameters(widget)" :parameter-texts="metricParameterTexts(widget)">
                  <ObjectViewWidget :widget="widget" :object="object" :reference="reference" :variables="variables" :refresh="refresh" :preview="preview" :metric-view="read" @variable="(name, value) => variables[name] = value" @refresh="reload" @open="emit('open', $event)" />
                </MetricViewData>
                <ObjectViewWidget v-else :widget="widget" :object="object" :reference="reference" :variables="variables" :refresh="refresh" :preview="preview" @variable="(name, value) => variables[name] = value" @refresh="reload" @open="emit('open', $event)" />
              </article>
            </template>
          </div>
        </section>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<style scoped>
.object-view-runtime { min-width: 0; container: view-runtime / inline-size; }
.object-view-runtime :deep(.el-tabs__header) { margin: 0 0 var(--manager-module-gap); }
.object-view-runtime :deep(.el-tabs__nav-wrap::after) { height: 1px; background: var(--el-border-color); }
.object-view-runtime :deep(.el-tabs__item) { height: 40px; max-width: 240px; font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; }
.view-section { margin-bottom: var(--manager-module-gap); }
.view-section:last-child { margin-bottom: 0; }
.view-section h3 { margin: 0 0 12px; font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 22px; overflow-wrap: anywhere; }
.view-grid { display: grid; grid-template-columns: repeat(12,minmax(0,1fr)); gap: var(--manager-module-gap); align-items: stretch; }
.widget-card { box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: var(--radius-md); padding: var(--manager-module-padding); min-width: 0; max-width: 100%; background: var(--el-bg-color); container: view-card / inline-size; }
.widget-card h4 { margin: 0 0 var(--manager-content-gap); font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: var(--leading-sm); overflow-wrap: anywhere; }
.chart-card { display: flex; flex-direction: column; }
.chart-card > :deep(.view-widget) { flex: 1; display: flex; flex-direction: column; }
@container view-runtime (max-width: 600px) { .widget-card { grid-column: span 12 !important; padding: 16px; } }
@container view-runtime (min-width: 601px) and (max-width: 800px) { .widget-card:not(:has(.metric)) { grid-column: span 12 !important; } }
</style>
