<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { AgentSettingsNav, AgentSettingsPage, useAgentDefinitions } from "@ontomato/workbench-ui/features/agents";

/**
 * The agents' settings as one page of the platform: its own address (`/ontology/agents`, `/new`, `/:id`), the agents at
 * its side and the editor in it. The page is the platform's, not a product page asset: the ontology manager lists it
 * after its products and the agent platform's column opens it at its foot, so both entries are this one page.
 *
 * The editor is the workbench's own (`AgentSettingsPage`), mounted here with the platform's API, authentication, text and
 * page context around it. A saved or deleted agent changes the list beside it without a re-read, and an address asked
 * for by a message beside the conversation is followed here just the same.
 */
const props = defineProps<{
  /** At its own address the route names the agent; beside a conversation the page's address does. */
  agentId?: string | null;
  creating?: boolean;
}>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ensureLoaded, forget } = useAgentDefinitions();

const creating = computed(() => props.creating ?? route.name === platformRoutes.ontologyAgentNew.name);
const agentId = computed(() => {
  if (props.agentId !== undefined) return props.agentId;
  const id = route.params.agentId;
  return typeof id === "string" ? id : null;
});

function openList() {
  void router.push(platformRoutes.ontologyAgents.path);
}
function selectAgent(id: string) {
  void router.push(`${platformRoutes.ontologyAgents.path}/${encodeURIComponent(id)}`);
}
function createAgent() {
  void router.push(platformRoutes.ontologyAgentNew.path);
}

onMounted(() => void ensureLoaded());
watch(() => route.name, () => void ensureLoaded());
</script>

<template>
  <div class="ontology-agent-settings">
    <AgentSettingsNav
      standalone
      :agent-id="agentId"
      :creating="creating"
      :models="false"
      @select-agent="selectAgent"
      @create-agent="createAgent"
    />
    <AgentSettingsPage :agent-id="agentId" :creating="creating" @changed="openList" />
  </div>
</template>

<style scoped>
/* The page's own list beside its editor, like the agent platform's settings column and for the same reason. */
.ontology-agent-settings {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.ontology-agent-settings > :deep(.settings-nav) {
  width: var(--shell-list-panel);
  flex-shrink: 0;
  padding: 0 var(--spacing-md) var(--spacing-md);
  box-sizing: border-box;
  border-right: 1px solid var(--el-border-color);
}
</style>
