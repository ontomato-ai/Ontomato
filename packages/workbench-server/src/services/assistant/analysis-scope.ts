import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assistantService } from "./service";
import type { AssistantOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

export const scopeChangeSchema = z.object({
  filterId: z.string().min(1), replacement: z.string().trim().min(1).max(1000),
}).strict();
export async function readAnalysisScope(session: string, artifactId: string, owner: AssistantOwner) {
  // Accepted dataset provenance, not model-generated labels, establishes the effective original scope.
  const dataset = await assistantService.dataset(session, artifactId, owner);
  return { question: dataset.payload.question, assumptions: dataset.payload.assumptions,
    truncation: dataset.payload.truncation,
    filters: (dataset.payload.sourceAnalysis?.filters ?? []).map(({ id, label, expression }) => ({ id, label, expression })) };
}
export async function adjustAnalysisScope(session: string, artifactId: string, owner: AssistantOwner, credentials: AssistantCredentials, input: z.infer<typeof scopeChangeSchema>, runId: string = randomUUID()) {
  const scope = await readAnalysisScope(session, artifactId, owner);
  const original = scope.filters.find((filter) => filter.id === input.filterId);
  if (!original) throw new HttpError(400, "The source condition is unavailable", "INVALID_SCOPE_CHANGE");
  const artifact = await assistantService.artifact(session, artifactId, owner);
  const message = `调整分析范围并重新查询：\n原问题：${scope.question}\n原条件：${original.label}\n改为：${input.replacement}\n其他条件保持不变。\n\n<agent-context>\nThis is a user-requested NEW read-only query, not filtering displayed rows and not a write authorization. Replace only the selected original condition; retain all other filters, assumptions, time range and decisions. Use ask for the complete new question. If the replacement is ambiguous or not supported by the ontology, clarify before querying. Do not rewrite the old dataset or silently expand the scope. Explain the changed scope in the new answer.\n${JSON.stringify({ sourceArtifactId: artifactId, sourceRunId: artifact.runId, sourcePath: artifact.path, originalScope: scope, change: { original, replacement: input.replacement } })}\n</agent-context>`;
  return assistantService.start(session, runId, message, owner, credentials);
}
