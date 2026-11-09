import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assistantClarificationSchema, clarificationValuesSchema } from "@ontomato/contracts/assistant-clarification";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AssistantOwner } from "./store";
import { assistantService } from "./service";

type Values = z.infer<typeof clarificationValuesSchema>;
type Card = z.infer<typeof assistantClarificationSchema>;
type Row = { values: Values["values"]; notes: string; continuation_run_id: string | null; message: string | null; admitted: boolean };
const view = (row?: Row) => ({ values: row?.values ?? {}, notes: row?.notes ?? "", status: row?.admitted ? "submitted" : "draft", continuationRunId: row?.continuation_run_id ?? null });
async function readCard(session: string, artifactId: string, owner: AssistantOwner) {
  const artifact = await assistantService.artifact(session, artifactId, owner);
  if (artifact.size > 128 * 1024 || !artifact.path.endsWith(".clarification.json")) throw new HttpError(400, "Invalid clarification");
  return { artifact, card: assistantClarificationSchema.parse(JSON.parse((await assistantService.content(session, artifactId, owner)).toString())) };
}
export function validateDecision(card: Card, input: Values, complete: boolean) {
  if (Object.keys(input.values).some((key) => !card.questions.some((question) => question.id === key))) throw new HttpError(400, "Unknown question");
  for (const question of card.questions) {
    const value = input.values[question.id];
    if (value === undefined || value === "" || Array.isArray(value) && !value.length) {
      if (complete && question.required) throw new HttpError(400, `A decision is required: ${question.label}`);
      continue;
    }
    if (question.kind === "multiple" ? !Array.isArray(value) : typeof value !== "string") throw new HttpError(400, "Invalid decision type");
    if (["single", "multiple"].includes(question.kind) && (Array.isArray(value) ? value : [value]).some((item) => !question.options.some((option) => option.value === item))) throw new HttpError(400, "Unknown choice");
    if (question.kind === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new HttpError(400, "Invalid date");
  }
}
export async function readDecision(session: string, artifact: string, owner: AssistantOwner) {
  await readCard(session, artifact, owner);
  return view((await getPostgresPool().query(`SELECT * FROM ${t("assistant_decisions")} WHERE artifact_id=$1 AND session_id=$2`, [artifact, session])).rows[0]);
}
export async function saveDecision(session: string, artifact: string, owner: AssistantOwner, input: Values) {
  const { card } = await readCard(session, artifact, owner);
  validateDecision(card, input, false);
  const result = await getPostgresPool().query(`INSERT INTO ${t("assistant_decisions")} AS decision (artifact_id,session_id,"values",notes) VALUES($1,$2,$3,$4)
    ON CONFLICT(artifact_id) DO UPDATE SET "values"=EXCLUDED."values",notes=EXCLUDED.notes,updated_at=now() WHERE decision.continuation_run_id IS NULL RETURNING *`, [artifact, session, JSON.stringify(input.values), input.notes]);
  return result.rows[0] ? view(result.rows[0]) : readDecision(session, artifact, owner);
}
export async function submitDecision(session: string, artifactId: string, owner: AssistantOwner, credentials: AssistantCredentials, input: Values) {
  const { card, artifact } = await readCard(session, artifactId, owner);
  validateDecision(card, input, true);
  const row = await transaction(async (client) => {
    // Serialize drafts and confirmations for one immutable clarification artifact.
    await client.query(`INSERT INTO ${t("assistant_decisions")} (artifact_id,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [artifactId, session]);
    const stored: Row = (await client.query(`SELECT * FROM ${t("assistant_decisions")} WHERE artifact_id=$1 FOR UPDATE`, [artifactId])).rows[0];
    if (stored.continuation_run_id) return stored;
    if (card.retrieval) {
      const ontology = await assistantService.retrievalClient(session, artifact.runId, owner);
      const links = (await ontology.links()).filter((link) => link.retrievalId === card.retrieval!.id);
      if (!links.length) throw new HttpError(403, "Clarification is not associated with this turn");
      if (links.at(-1)!.runId !== card.retrieval.runId) throw new HttpError(409, "This decision is outdated. Request the current clarification.", "STALE_DECISION");
      const current = await ontology.readSnapshot(card.retrieval.id, card.retrieval.runId);
      if (current.runtimeRunId !== card.retrieval.runId || current.decisionRevision !== card.retrieval.decisionRevision || current.run?.status !== "stopped") throw new HttpError(409, "This decision is outdated. Request the current clarification.", "STALE_DECISION");
    }
    const answers = card.questions.map((question) => ({ question: question.label, id: question.id, value: input.values[question.id] ?? "", labels: [input.values[question.id] ?? ""].flat().map((value) => question.options.find((option) => option.value === value)?.label ?? value) }));
    const message = `已确认以下口径，请继续：\n${answers.map((answer) => `${answer.question}：${answer.labels.join("、")}`).join("\n")}${input.notes ? `\n${input.notes}` : ""}\n\n<agent-context>\nExplicit user decisions, not write authorization. Resume the same retrieval using its expected run and decision revision; do not replace it.\n${JSON.stringify({ clarificationArtifactId: artifactId, sourceRunId: artifact.runId, retrieval: card.retrieval, answers, notes: input.notes })}\n</agent-context>`;
    const runId = randomUUID();
    return (await client.query(`UPDATE ${t("assistant_decisions")} SET "values"=$2,notes=$3,continuation_run_id=$4,message=$5,updated_at=now() WHERE artifact_id=$1 RETURNING *`, [artifactId, JSON.stringify(input.values), input.notes, runId, message])).rows[0] as Row;
  });
  if (row.admitted) return view(row);
  // The durable run ID makes retries replay the same turn, including after a response is lost.
  await assistantService.start(session, row.continuation_run_id!, row.message!, owner, credentials);
  await getPostgresPool().query(`UPDATE ${t("assistant_decisions")} SET admitted=true WHERE artifact_id=$1`, [artifactId]);
  return view({ ...row, admitted: true });
}
