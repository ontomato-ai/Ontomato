<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import AgentEditor from "./AgentEditor.vue";
import CapabilityLibrary from "./CapabilityLibrary.vue";
import { useAgentDefinitions } from "../definitions";

/**
 * The agent settings' main area: the editor of the agent the address names, the editor of a new one, or the capability
 * library. The list is not here — it is the column's (DESIGN.md "Applications and shells").
 *
 * `/agents/settings` opens the first agent, `/agents/settings/<id>` that agent, `/agents/settings/new` a new one and
 * `/agents/settings/capabilities` the library, so every screen has an address to link, bookmark and reload.
 */
const props = defineProps<{
  /** The address's agent; null opens the first one. */
  agentId: string | null;
  creating: boolean;
  capabilities: boolean;
}>();
const emit = defineEmits<{
  changed: [];
  /** The editor's capability library button; the host owns the addresses, as for the column's library row. */
  openCapabilities: [];
}>();
const { t, locale } = useI18n();
const { agents, loading, classes, relations, outlineLoading, modelOptions, modelOptionsFailed, ensureLoaded, load, reloadModelOptions, remember, forget } =
  useAgentDefinitions();

const shown = computed(() => (props.agentId ? agents.value.find((agent) => agent.id === props.agentId) ?? null : agents.value[0] ?? null));
const editorKey = computed(() => (props.creating ? "new" : (shown.value?.id ?? "none")));

function saved(agent: Parameters<typeof remember>[0]) {
  remember(agent);
  emit("changed");
}

function deleted(id: string) {
  forget(id);
  emit("changed");
}

onMounted(() => {
  void ensureLoaded();
});
watch(locale, () => { void load(); });
</script>

<template>
  <div class="agent-settings-page">
    <CapabilityLibrary v-if="capabilities" />
    <AgentEditor
      v-else-if="creating || shown"
      :key="editorKey"
      class="agent-editor"
      :agent="creating ? null : shown"
      :classes="classes"
      :relations="relations"
      :outline-loading="outlineLoading"
      :model-options="modelOptions"
      :model-options-failed="modelOptionsFailed"
      @saved="saved"
      @deleted="deleted"
      @reload-model-options="reloadModelOptions()"
      @open-capabilities="emit('openCapabilities')"
    />
    <!-- The list is the column's: an empty main area means the column could not name an agent, not a second list. -->
    <p v-else-if="!loading" class="empty">{{ t("agents.empty") }}</p>
  </div>
</template>

<style scoped>
.agent-settings-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: auto;
}
/* The editor is the application's one page here: it keeps its own padding and scrolls with the area. */
.agent-editor {
  flex: 1;
  min-height: 0;
}
.empty {
  margin: 0;
  padding: 24px;
  color: var(--el-text-color-secondary);
}
</style>
