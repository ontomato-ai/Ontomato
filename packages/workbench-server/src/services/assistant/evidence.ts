import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import { OntologyRetrievalClient } from "./ontology-retrieval";
import { projectDataset } from "./dataset-projection";
import type { AssistantQueryEvidence } from "./query-evidence";
import { assistantStore, type AssistantOwner } from "./store";
import { messageText, answerText } from "../../platform/agent-runtime/runtime";
import { buildTurnKey } from "../../logging/log-context";
import { HttpError } from "../../utils/errors";
export type AssistantReadAccess =
  AssistantOwner | { domainId: string; scope: "domain" };
export async function verifyAssistantDomain(id: string, domainId: string) {
  await assistantStore.domainSession(id, domainId);
}
async function readOwner(id: string, access: AssistantReadAccess) {
  const s =
    "scope" in access
      ? await assistantStore.domainSession(id, access.domainId)
      : await assistantStore.session(id, access);
  return { domainId: s.domain_id, userId: s.owner_id };
}
export async function assistantDomainIndex(
  domainId: string,
  offset: number,
  limit: number,
) {
  const result = await getPostgresPool().query(
    `SELECT id,title,created_at,updated_at,count(*) OVER() AS total FROM ${table("assistant_sessions")} WHERE domain_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3`,
    [domainId, limit, offset],
  );
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0) };
}
/** Reads runtime facts without starting models, QC or observation. */
export async function readAssistantTurnEvidence(
  sessionId: string,
  requestSeq: number,
  access: AssistantReadAccess,
) {
  const owner = await readOwner(sessionId, access),
    turn = (await assistantStore.turns(sessionId)).find(
      (t) => t.request_seq === requestSeq,
    );
  if (!turn) throw new HttpError(404, "Turn not found");
  const client = new RuntimeClient(owner.domainId),
    run = await client.run(turn.id),
    queries: AssistantQueryEvidence[] = [],
    retrievalRuns: AgentHostRunSnapshot[] = [],
    artifacts = [...run.artifacts];
  const ontology = turn.retrieval_scope_id ? new OntologyRetrievalClient(owner,turn.retrieval_scope_id) : null;
  const links = ontology ? await ontology.links() : [];
  // The checks this reply scheduled for the outputs it cited, each grouped by the round that delivered them.
  const quality = ontology ? await ontology.replyQuality() : null;
  for (const link of links) {
    const evidence = await ontology!.evidence(link.retrievalId, link.runId);
    const child = evidence.snapshot.runtimeSessionId && evidence.snapshot.runtimeRunId
      ? await ontology!.run(evidence.snapshot.runtimeSessionId, link.runId) : null;
    if (child) retrievalRuns.push(child);
    const datasets = [];
    for (const artifactId of child ? evidence.snapshot.datasetArtifactIds : []) {
      const data = await ontology!.dataset(link.retrievalId, artifactId);
      artifacts.push(await ontology!.artifact(child!.run.sessionId, artifactId));
      datasets.push(projectDataset(data.id, data.payload, {
        retrievalId: link.retrievalId,
        runtimeSessionId: child!.run.sessionId,
        runtimeRunId: child!.run.id,
      }));
    }
    // A metric the assistant ran itself has no child run; its delivered outputs are its datasets.
    for (const outputId of child ? [] : evidence.snapshot.outputIds) {
      datasets.push(projectDataset(outputId, await ontology!.output(link.retrievalId, link.runId, outputId), {
        retrievalId: link.retrievalId, outputId, runtimeSessionId: null, runtimeRunId: null }));
    }
    queries.push({
      id: link.runId,
      threadId: sessionId,
      requestSeq,
      sourceKind: "retrieval",
      sourceRef: link.retrievalId,
      question: evidence.input.question,
      status: child?.run.status ?? (evidence.snapshot.retrieverPending ? "running" : "stopped"),
      fullContent: child ? answerText(child) : "",
      backendSessions: [],
      // The check this reply scheduled for the outputs it cited from this round, with its conclusion once completed.
      qcResult: quality!.quality.filter((task) => task.checks.datasets.some((dataset) => evidence.snapshot.outputIds.includes(dataset.id)))
        .map((task) => ({ ...task, result: quality!.qualityResults.find((result) => result.taskId === task.id) ?? null })),
      datasetsPayload: datasets.map((d) => ({
        id: d.id,
        datasetKey: d.id,
        title: d.name,
        rows: d.data,
        dsl: d.dsl,
        abcProgram: d.abcProgram,
        sourceAnalysis: d.sourceAnalysis,
        ...(d.truncated
          ? {
              truncated: d.truncated,
              rowLimit: d.rowLimit,
              truncationHint: d.truncationHint,
            }
          : {}),
      })),
      dataCount: datasets.reduce((n, d) => n + d.data.length, 0),
      objectClasses: [
        ...new Set(
          datasets.flatMap(
            (d) =>
              d.sourceAnalysis ? d.sourceAnalysis.nodes.filter((n) => n.kind === "class").map((n) => n.className) :
                d.abcProgram?.outKeyRefs?.flatMap((r) => r.className ? [r.className] : []) ?? [],
          ),
        ),
      ],
      createdAt: new Date(child?.run.createdAt ?? evidence.snapshot.createdAt ?? turn.created_at),
      updatedAt: new Date(child?.run.finishedAt ?? child?.run.createdAt ?? evidence.snapshot.createdAt ?? turn.created_at),
    });
  }
  const messages = run.messages
    .filter((m) => m.message.role === "user" || m.message.role === "assistant")
    .map((m) => ({
      id: m.id,
      runId: m.runId,
      requestSeq,
      role: m.message.role as "user" | "assistant",
      content: messageText(m.message),
    }));
  return {
    sessionId,
    turnId: turn.id,
    requestSeq,
    turnKey: buildTurnKey(sessionId, requestSeq),
    question: messages.find((m) => m.role === "user")?.content ?? "",
    answer: answerText(run),
    messages,
    runs: [run],
    retrievalRuns,
    artifacts,
    queries,
    retrievalRequested: links.length > 0,
    // Every check this reply scheduled, including one for a round an earlier reply delegated.
    quality,
    turnRun: {
      threadId: sessionId,
      requestSeq,
      source: "assistant",
      displayMessage: messages.find((m) => m.role === "user")?.content ?? "",
      status: run.run.status,
      startedAt: new Date(run.run.createdAt),
      endedAt: run.run.finishedAt ? new Date(run.run.finishedAt) : undefined,
      createdAt: new Date(turn.created_at),
      updatedAt: new Date(run.run.finishedAt ?? run.run.createdAt),
    },
  };
}
export type AssistantTurnEvidence = Awaited<
  ReturnType<typeof readAssistantTurnEvidence>
>;
