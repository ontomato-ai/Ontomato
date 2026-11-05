<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ElAlert, ElButton, ElSkeleton, vLoading } from "element-plus";
import { ArrowLeft, Settings2, RefreshCw } from "lucide-vue-next";
import { createObjectView, objectViewDocumentSchema, type ObjectReference, type ObjectViewDocument } from "@ontomato/contracts/object-views";
import { useManagerClient, useOntologyText } from "../context";
const { ot } = useOntologyText();
import ObjectViewRuntime from "./ObjectViewRuntime.vue";
import { computed } from "vue";
import { instanceName, type InstanceNameAttribute } from "./instance-name";
const props = defineProps<{ reference: ObjectReference }>();
const emit = defineEmits<{ open: [reference: ObjectReference]; edit: []; back: [] }>();
const client = useManagerClient();
const document = ref<ObjectViewDocument>();
const object = ref<Record<string, unknown>>({});
const error = ref("");
const loading = ref(false);
const nameAttributes = ref<InstanceNameAttribute[]>([]);
const displayName = computed(() => {
  const configured = nameAttributes.value.find(attr => attr.name === document.value?.titleField && attr.enable !== false && (attr.businessKey || attr.bizzkeyBool || attr.bizzkey || attr.bizzKey));
  return instanceName(configured ? [configured] : nameAttributes.value, object.value);
});
let request = 0;
onBeforeUnmount(() => { request++; });
async function load() {
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const [state, result] = await Promise.all([
      client.objectViewRequest("read", props.reference.className, "full"),
      client.queryInstanceInfo(`${props.reference.className}:${props.reference.primaryKey}`, props.reference.className),
    ]);
    if (current !== request) return;
    document.value = state.versions[0] ? objectViewDocumentSchema.parse(state.versions[0].document) : createObjectView(props.reference.className);
    if (!state.versions[0]) document.value.tabs[0].sections[0].widgets[0].title = ot('ovKindProperties');
    object.value = (result.data || {}) as Record<string, unknown>;
    nameAttributes.value = (result.classDef as { attrs?: InstanceNameAttribute[] } | undefined)?.attrs || [];
  } catch (reason) { if (current === request) error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { if (current === request) loading.value = false; }
}
async function refreshObject() {
  const current = ++request;
  try {
    const result = await client.queryInstanceInfo(`${props.reference.className}:${props.reference.primaryKey}`, props.reference.className);
    if (current === request) object.value = (result.data || {}) as Record<string, unknown>;
  } catch (reason) { if (current === request) error.value = reason instanceof Error ? reason.message : String(reason); }
}
watch(() => JSON.stringify([props.reference.className, props.reference.primaryKey]), () => {
  document.value = undefined;
  object.value = {};
  nameAttributes.value = [];
  void load();
}, { immediate: true });
</script>
<template>
  <section class="object-view-page">
    <div v-loading="loading && !!document" class="object-page-content" :aria-busy="loading">
    <header class="object-header">
      <div class="object-heading"><el-button text :icon="ArrowLeft" @click="emit('back')">{{ ot('ovBack') }}</el-button><span class="title-divider" /><div class="object-title"><h2>{{ displayName }}</h2><small>{{ document?.title || reference.className }}</small></div></div>
      <div class="object-actions"><el-button text :icon="RefreshCw" :disabled="loading" @click="load">{{ ot('ovRefresh') }}</el-button><el-button type="primary" plain :icon="Settings2" :title="ot('ovConfigureObject')" :aria-label="ot('ovConfigureObject')" @click="emit('edit')">{{ ot('ovConfigure') }}</el-button></div>
    </header>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <div v-if="loading && !document" class="page-skeleton" role="status" :aria-label="ot('ovLoading')"><el-skeleton :rows="10" animated /></div>
    <ObjectViewRuntime v-else-if="document" :document="document" :object="object" :reference="reference" @open="emit('open', $event)" @refresh="refreshObject" />
    </div>
  </section>
</template>
<style scoped>
.object-view-page { height: 100%; min-width: 0; overflow: auto; box-sizing: border-box; container: object-page / inline-size; background: var(--el-bg-color); }
.object-page-content { min-width: 0; }
.page-skeleton { min-height: 420px; padding: var(--spacing-xl) var(--spacing-2xl); }
.object-header { display: flex; min-height: 64px; box-sizing: border-box; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--spacing-md); padding: var(--spacing-sm) var(--spacing-2xl); border-bottom: 1px solid var(--el-border-color); background: var(--el-bg-color); }
.object-heading { display: flex; align-items: center; min-width: 0; flex: 1 1 200px; }
.title-divider { width: 1px; height: 22px; flex-shrink: 0; margin-inline: var(--spacing-md); background: var(--el-border-color); }
.object-title { display: grid; gap: 1px; min-width: 0; }
.object-title h2 { margin: 0; font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 20px; overflow-wrap: anywhere; color: var(--el-text-color-primary); }
.object-title small { font-size: var(--text-xs); line-height: 18px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.object-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--spacing-sm); }
.object-actions :deep(.el-button + .el-button) { margin-inline-start: 0; }
.object-page-content > .el-alert, .object-page-content > p { margin: var(--spacing-lg) var(--spacing-2xl); }
.object-page-content > .object-view-runtime { padding: var(--spacing-xl) var(--spacing-2xl); }
@container ontology-manager (max-width: 768px) { .object-header { padding-inline: var(--spacing-lg); } .object-page-content > .object-view-runtime { padding: var(--spacing-lg); } }
@container object-page (max-width: 520px) { .object-actions { flex-basis: 100%; justify-content: flex-end; } }
</style>
