import { computed, ref } from "vue";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import type { AssistantAgentDefinition as AgentDefinition } from "@ontomato/contracts/assistant-chat";
import {
  agentDefinitionsApi,
  loadModelOptions,
  loadOntologyScope,
  type ObjectClassOption,
  type ObjectRelationOption,
} from "./api";

/**
 * The business agents of this installation, read once per page load.
 *
 * The agent platform's settings navigation (in its column) and the editor (in the main area) are two places in one
 * screen: they read the same list here, so a name saved in the editor is the name the column shows and neither has to
 * re-read the agents to find out. The built-in operations agent is not part of it: its one setting — the model the
 * diagnosis runs on — is the operations application's own page.
 */
const agents = ref<AgentDefinition[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const classes = ref<ObjectClassOption[]>([]);
const relations = ref<ObjectRelationOption[]>([]);
const outlineLoading = ref(true);
const modelOptions = ref<ModelOptions | null>(null);
const modelOptionsFailed = ref(false);
let started = false;

async function load(): Promise<void> {
  loading.value = true;
  loadFailed.value = false;
  try {
    agents.value = await agentDefinitionsApi.list();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

async function reloadModelOptions(): Promise<void> {
  modelOptionsFailed.value = false;
  try {
    modelOptions.value = await loadModelOptions();
  } catch {
    modelOptionsFailed.value = true;
  }
}

/** Reads the agents, the models and the data scope the editor's pickers offer; a second call reads nothing again. */
async function ensureLoaded(): Promise<void> {
  if (started) return;
  started = true;
  void load();
  void reloadModelOptions();
  try {
    const scope = await loadOntologyScope();
    classes.value = scope.classes;
    relations.value = scope.relations;
  } catch {
    classes.value = [];
    relations.value = [];
  } finally {
    outlineLoading.value = false;
  }
}

/** A saved definition replaces its entry (or joins the list), so the column and the editor agree without a re-read. */
function remember(agent: AgentDefinition): void {
  const index = agents.value.findIndex((known) => known.id === agent.id);
  if (index >= 0) agents.value = agents.value.map((known, at) => (at === index ? agent : known));
  else agents.value = [...agents.value, agent];
}

function forget(id: string): void {
  agents.value = agents.value.filter((agent) => agent.id !== id);
}

export function useAgentDefinitions() {
  return {
    agents,
    loading,
    loadFailed,
    classes,
    relations,
    outlineLoading,
    modelOptions,
    modelOptionsFailed,
    first: computed(() => agents.value[0] ?? null),
    find: (id: string | null) => agents.value.find((agent) => agent.id === id) ?? null,
    ensureLoaded,
    load,
    reloadModelOptions,
    remember,
    forget,
  };
}
