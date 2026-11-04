<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AgentsListView from "./AgentsListView.vue";
import CapabilityLibrary from "./CapabilityLibrary.vue";
import { showsAgentTab } from "../permissions";

/**
 * The agents page of the function area: one entry with two tabs. The agents tab lists the business agents and the
 * built-in operations agent; the capability library tab lists the skills and external tools the agents can use. Each tab
 * follows its own capability codes, and the page is only entered when at least one of them applies.
 */
const props = defineProps<{
  can: (permission: string) => boolean;
  /** A tab named by the address (link to the capability library); the visible tabs still follow the codes. */
  initialTab?: "agents" | "capabilities" | null;
}>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

const showAgents = computed(() => showsAgentTab(props.can, "agents"));
const showCapabilities = computed(() => showsAgentTab(props.can, "capabilities"));

function firstVisibleTab(): "agents" | "capabilities" {
  if (props.initialTab === "agents" && showAgents.value) return "agents";
  if (props.initialTab === "capabilities" && showCapabilities.value) return "capabilities";
  return showAgents.value ? "agents" : "capabilities";
}

const tab = ref<"agents" | "capabilities">(firstVisibleTab());
</script>

<template>
  <el-tabs v-if="showAgents && showCapabilities" v-model="tab" class="agents-page">
    <el-tab-pane name="agents" :label="t('agents.agentsTab')">
      <AgentsListView :show-system-agents="props.can('observer')" @changed="emit('changed')" />
    </el-tab-pane>
    <el-tab-pane name="capabilities" :label="t('agents.capabilityLibrary')">
      <CapabilityLibrary />
    </el-tab-pane>
  </el-tabs>
  <AgentsListView v-else-if="showAgents" :show-system-agents="props.can('observer')" @changed="emit('changed')" />
  <CapabilityLibrary v-else-if="showCapabilities" />
</template>

<style scoped>
/* The page scrolls as a whole (the shell's feature area does the scrolling), so the tabs grow with their content. */
.agents-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 0 24px;
}
.agents-page :deep(.el-tabs__header) {
  margin: 0;
  flex-shrink: 0;
}
.agents-page :deep(.el-tabs__content) {
  flex: 1;
}
.agents-page :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: var(--el-border-color-light);
}
</style>
