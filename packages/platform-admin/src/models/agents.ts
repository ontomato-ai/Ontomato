import { inject, type InjectionKey, type Ref } from "vue";
import type { OntologyAgentModel } from "@ontomato/contracts/model-settings";

/*
 * The ontology service agents as the model library's pages read them: only to say who uses a model and whom a renamed
 * model leaves without one. Their choices are made and saved on each application's own model page (see
 * `ontologyAgentModelPages` in the platform shell); null until they are read.
 */
export const ontologyAgentsKey: InjectionKey<Readonly<Ref<OntologyAgentModel[] | null>>> = Symbol("ontology-agents");

export function useOntologyAgents(): Readonly<Ref<OntologyAgentModel[] | null>> {
  const agents = inject(ontologyAgentsKey);
  if (!agents) throw new Error("Model panels must be mounted inside the model configuration page");
  return agents;
}
