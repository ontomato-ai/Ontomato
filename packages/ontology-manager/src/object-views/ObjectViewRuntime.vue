<script setup lang="ts">
import { ref, watch } from "vue";
import { ElTabs, ElTabPane } from "element-plus";
import { viewConditionMatches, type ObjectViewDocument, type ObjectReference } from "@ontomato/contracts/object-views";
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
</script>
<template>
  <div class="object-view-runtime">
    <el-tabs v-model="activeTab">
      <el-tab-pane v-for="tab in document.tabs" :key="tab.id" :name="tab.id" :label="tab.title" lazy>
        <section v-for="section in tab.sections" :key="section.id" class="view-section">
          <h3 v-if="section.title">{{ section.title }}</h3>
          <div class="view-grid">
            <template v-for="widget in section.widgets" :key="widget.id">
              <article v-if="viewConditionMatches(widget.visibleWhen, object, variables)" :style="{ gridColumn: 'span ' + widget.span }" class="widget-card">
                <h4 v-if="widget.title">{{ widget.title }}</h4>
                <ObjectViewWidget :widget="widget" :object="object" :reference="reference" :variables="variables" :refresh="refresh" :preview="preview" @variable="(name, value) => variables[name] = value" @refresh="reload" @open="emit('open', $event)" />
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
.object-view-runtime :deep(.el-tabs__header) { margin: 0 0 var(--spacing-xl); }
.object-view-runtime :deep(.el-tabs__nav-wrap::after) { height: 1px; background: var(--el-border-color); }
.object-view-runtime :deep(.el-tabs__item) { height: 40px; max-width: 240px; font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; }
.view-section { margin-bottom: 24px; }
.view-section:last-child { margin-bottom: 0; }
.view-section h3 { margin: 0 0 12px; font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 22px; overflow-wrap: anywhere; }
.view-grid { display: grid; grid-template-columns: repeat(12,minmax(0,1fr)); gap: var(--spacing-xl); align-items: stretch; }
.widget-card { border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); padding: var(--spacing-lg); min-width: 0; background: var(--el-bg-color); container: view-card / inline-size; }
.widget-card h4 { margin: 0 0 var(--spacing-lg); padding-bottom: var(--spacing-sm); border-bottom: 1px solid var(--el-border-color-light); font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 22px; overflow-wrap: anywhere; }
@container view-runtime (max-width: 600px) { .widget-card { grid-column: span 12 !important; padding: 16px; } }
</style>
