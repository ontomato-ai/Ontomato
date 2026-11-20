<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { pageDraftLink, withoutPageDraftQuery } from "@ontomato/agent-shell-ui";
import { AgentSettingsNav, AgentSettingsPage, agentSettingsAddressKey, useAgentDefinitions } from "@ontomato/workbench-ui/features/agents";

/**
 * The agents' settings as one page of the platform: its own address (`/new`, `/:id` under its prefix), the agents at its
 * side and the editor in it. The page is the platform's, not a product page asset, and two applications show it: the
 * ontology manager lists it after its products at `/ontology/agents`, and the agent platform shows it in its own shell at
 * `/agents/settings`. The page stays under the prefix it was opened at, so each application keeps the reader in it.
 *
 * The editor is the workbench's own (`AgentSettingsPage`), mounted here with the platform's API, authentication, text and
 * page context around it. Beside a conversation the page has no address of its own in the browser — the agent platform's
 * `?page=` carries it — so the address and every move (another agent, a new one, the list, a saved draft's handoff)
 * come in as props and the host turns them into that parameter. At its own address the page is the address.
 */
const props = withDefaults(
  defineProps<{
    /** In the agent platform's shell: the page's address, as the shell carries it (beside a conversation, or full). */
    address?: string | null;
    /** In the agent platform's shell: where the page moves to, as the shell would carry it. */
    navigate?: (address: string) => void;
  }>(),
  { address: null, navigate: undefined },
);

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ensureLoaded } = useAgentDefinitions();

/**
 * The page's own address: the conversation's parameter, or the browser's. It is what the page is — which agent it shows,
 * whether it is a new one — so the two below are read from it and nowhere else. A prop carrying them again would be a
 * second source, and Vue hands an absent boolean prop to the component as `false` rather than as nothing.
 */
const address = computed(() => (props.address !== null ? props.address : route.fullPath));
const query = computed(() => Object.fromEntries(new URLSearchParams(address.value.split("?")[1] ?? "")));
const path = computed(() => address.value.split("?")[0]!);

/** The prefix the page was opened at: the agent platform's or the ontology manager's. Every move stays under it. */
const base = computed(() =>
  path.value === platformRoutes.agents.path || path.value.startsWith(`${platformRoutes.agents.path}/`)
    ? platformRoutes.agents.path
    : platformRoutes.ontologyAgents.path,
);

/** The agent the address names: `/new` is a new one, the bare list no agent at all. */
const agentId = computed(() => {
  const segment = path.value.slice(base.value.length + 1);
  return segment && segment !== "new" ? decodeURIComponent(segment) : null;
});
const creating = computed(() => path.value === `${base.value}/new`);

/** The page's address without its draft handoff: what the address reopens once the reader saved. */
const savedAddress = computed(() =>
  `${path.value}${Object.keys(withoutPageDraftQuery(query.value)).length ? `?${new URLSearchParams(withoutPageDraftQuery(query.value) as Record<string, string>)}` : ""}`,
);

/**
 * Where the page moves to: beside a conversation the host's parameter (it turns the address into `?page=`); at its own
 * address the router, which needs the path and its query rather than an address string. A saved draft's handoff is not a
 * step back, so it replaces the address rather than adding one.
 */
function openAddress(next: string) {
  if (props.navigate) return props.navigate(next);
  const [path, search] = next.split("?");
  void router.replace({ path: path!, query: Object.fromEntries(new URLSearchParams(search ?? "")) });
}

/** A different page of the same settings (one agent, a new one, the list) keeps the rest of the address's query. */
function pageAt(path: string) {
  const rest = Object.entries(query.value).filter(([key]) => !["draftSessionId", "draftRunId", "draftPath"].includes(key));
  openAddress(`${path}${rest.length ? `?${new URLSearchParams(rest as [string, string][])}` : ""}`);
}

function openList() {
  pageAt(base.value);
}
function agentAddress(id: string) {
  return `${base.value}/${encodeURIComponent(id)}`;
}
function selectAgent(id: string) {
  pageAt(agentAddress(id));
}
function createAgent() {
  pageAt(`${base.value}/new`);
}

provide(agentSettingsAddressKey, {
  address,
  draft: computed(() => pageDraftLink(query.value)),
  savedAddress,
  agentAddress: (id) => `${agentAddress(id)}${address.value.slice(path.value.length)}`,
  go: openAddress,
});

onMounted(() => void ensureLoaded());
watch(() => route.name, () => void ensureLoaded());
</script>

<template>
  <div class="ontology-agent-settings">
    <AgentSettingsNav
      standalone
      :heading="props.address === null"
      :agent-id="agentId"
      :creating="creating"
      :models="false"
      @select-agent="selectAgent"
      @create-agent="createAgent"
    />
    <AgentSettingsPage :agent-id="agentId" :creating="creating" @created="selectAgent" @deleted="openList" />
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
/* The list beside the editor keeps the platform's list width; the editor takes what is left of the page. */
.ontology-agent-settings > :deep(.settings-nav) {
  flex: 0 0 var(--shell-list-panel);
  width: var(--shell-list-panel);
  padding: var(--spacing-xs) var(--spacing-sm) var(--spacing-md);
  box-sizing: border-box;
  border-inline-end: 1px solid var(--el-border-color);
}
</style>
