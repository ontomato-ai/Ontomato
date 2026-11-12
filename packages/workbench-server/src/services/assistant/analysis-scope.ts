import { assistantService } from "./service";
import type { AssistantOwner } from "./store";
import { scopeConditions } from "./scope-conditions";

export async function readAnalysisScope(session: string, artifactId: string, owner: AssistantOwner, locale = "en") {
  // Accepted dataset provenance, not model-generated labels, establishes the effective original scope.
  const dataset = await assistantService.dataset(session, artifactId, owner);
  return { question: dataset.payload.question, assumptions: dataset.payload.assumptions,
    truncation: dataset.payload.truncation,
    filters: scopeConditions(dataset.payload.sourceAnalysis ?? { filters: [] }, locale) };
}
