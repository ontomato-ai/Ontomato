import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assistantService } from "./service";
import type { AssistantOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { scopeConditions } from "./scope-conditions";

export const scopeChangeSchema = z.object({
  adjustment: z.string().trim().min(1).max(2000),
}).strict();
export async function readAnalysisScope(session: string, artifactId: string, owner: AssistantOwner, locale = "en") {
  // Accepted dataset provenance, not model-generated labels, establishes the effective original scope.
  const dataset = await assistantService.dataset(session, artifactId, owner);
  return { question: dataset.payload.question, assumptions: dataset.payload.assumptions,
    truncation: dataset.payload.truncation,
    filters: scopeConditions(dataset.payload.sourceAnalysis ?? { filters: [] }, locale) };
}
export async function adjustAnalysisScope(session: string, artifactId: string, owner: AssistantOwner, credentials: AssistantCredentials, input: z.infer<typeof scopeChangeSchema>, runId: string = randomUUID()) {
  const dataset = await assistantService.dataset(session, artifactId, owner);
  const scope = { question: dataset.payload.question, assumptions: dataset.payload.assumptions,
    truncation: dataset.payload.truncation, sourceAnalysis: dataset.payload.sourceAnalysis,
    columns: dataset.payload.columns, recipe: dataset.payload.recipe, selfCheck: dataset.payload.selfCheck };
  const artifact = await assistantService.artifact(session, artifactId, owner);
  const message = `调整范围并重新查询：\n原问题：${scope.question}\n调整要求：${input.adjustment}\n未提及的查询条件和输出要求保持不变。\n\n<agent-context>\nThis is a user-requested NEW read-only query, not filtering displayed rows and not a write authorization. The user may change multiple conditions, add conditions, or explicitly remove conditions in one request. Apply only the requested scope changes. Preserve every condition not mentioned, assumptions, time range, prior decisions, output fields, grouping, aggregation, and ordering unless the user explicitly requests a change. Use the accepted source analysis and recipe below as the original query, not just its natural-language question. Use ask for the complete new question. If the adjustment is ambiguous, contradictory, or unsupported by the ontology, clarify before querying. Do not rewrite the old dataset or silently expand the scope. Explain the changed scope in the new answer.\n${JSON.stringify({ sourceArtifactId: artifactId, sourceRunId: artifact.runId, sourcePath: artifact.path, originalScope: scope, adjustment: input.adjustment })}\n</agent-context>`;
  return assistantService.start(session, runId, message, owner, credentials);
}
