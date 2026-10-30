<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { ViewWidget } from "@ontomato/contracts/object-views";
import { useManagerClient, useOntologyText, useManagerContext } from "../context";
const props = defineProps<{ widget: ViewWidget; rows: Record<string, unknown>[]; value: unknown }>();
const client = useManagerClient();
const context = useManagerContext();
const { ot } = useOntologyText();
const html = ref("");
const error = ref("");
const loading = ref(false);
const empty = computed(() => {
  if (props.widget.chartType !== "graph") return props.rows.length === 0;
  const value = props.value;
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const nodes = (value as { nodes?: unknown }).nodes;
    return Object.keys(value).length === 0 || (Array.isArray(nodes) && nodes.length === 0);
  }
  return false;
});
let request = 0;
onBeforeUnmount(() => { request++; });
const displayedHtml = computed(() => client.viewSkillHtml(html.value));
watch(() => JSON.stringify([props.widget, props.value, props.rows, context.locale]), async () => {
  const current = ++request;
  html.value = ""; error.value = ""; loading.value = false;
  if (empty.value) return;
  loading.value = true;
  try {
    const widget = props.widget;
    const result = await client.renderViewSkill(widget.skillId, {
      data: widget.chartType === "graph" ? props.value : props.rows,
      chartType: widget.chartType === "graph" ? "network-graph" : widget.chartType,
      title: widget.title, xField: widget.labelField, yField: widget.valueField,
      showTitle: false,
      dateField: widget.dateField, descriptionField: widget.descriptionField,
      latitudeField: widget.latitudeField, longitudeField: widget.longitudeField,
      labelField: widget.labelField, valueField: widget.valueField,
      nameField: "label", typeField: "group", relationField: "label",
    });
    if (current === request) html.value = result;
  } catch (reason) {
    if (current === request) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally { if (current === request) loading.value = false; }
}, { immediate: true });
</script>
<template>
  <div class="skill-visualization" :aria-busy="loading" :style="{ minHeight: widget.height + 'px' }">
    <div v-if="empty" class="visualization-empty" role="status">{{ ot('ovNoChartData') }}</div>
    <div v-if="loading" class="visualization-loading" role="status"><span class="loading-indicator" aria-hidden="true" />{{ ot('ovLoading') }}</div>
    <p v-if="error" class="visualization-error" role="alert">{{ error }}</p>
    <iframe v-if="html" :srcdoc="displayedHtml" :title="widget.title" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" :style="{ height: widget.height + 'px', minHeight: widget.height + 'px' }" />
  </div>
</template>
<style scoped>
.skill-visualization { min-width: 0; flex: 1; display: flex; flex-direction: column; background: var(--el-bg-color); }
iframe { display: block; width: 100%; border: 0; flex: 1; background: var(--el-bg-color); }
.visualization-loading { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--el-text-color-secondary); }
.visualization-empty { flex: 1; display: grid; place-items: center; padding: 24px; color: var(--el-text-color-secondary); text-align: center; }
.loading-indicator { width: 14px; height: 14px; border: 2px solid var(--el-border-color); border-top-color: var(--el-color-primary); border-radius: 50%; animation: visualization-spin .8s linear infinite; }
.visualization-error { color: var(--el-color-danger); overflow-wrap: anywhere; }
@keyframes visualization-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading-indicator { animation: none; } }
</style>
