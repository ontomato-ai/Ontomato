import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import { retrievalService } from "../data-retrieval/service";
import { projectDataset } from "../data-retrieval/projection";
import type { QueryRun } from "../data-query/query-run-store";
import { assistantStore, type AssistantOwner } from "./store";
import { messageText, finalText } from "../../platform/agent-runtime/runtime";
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
    queries: QueryRun[] = [],
    retrievalRuns: RuntimeRunSnapshot[] = [],
    artifacts = [...run.artifacts];
  const links = (
    await getPostgresPool().query(
      `SELECT DISTINCT l.retrieval_id,l.retrieval_run_id,r.input,t.qc_result FROM ${table("assistant_retrievals")} l JOIN ${table("retrievals")} r ON r.id=l.retrieval_id JOIN ${table("retrieval_rounds")} t ON t.id=l.retrieval_run_id WHERE l.parent_run_id=$1`,
      [turn.id],
    )
  ).rows;
  for (const link of links) {
    const child = await client.run(link.retrieval_run_id);
    retrievalRuns.push(child);
    const entries = (
        await getPostgresPool().query(
          `SELECT artifact_id FROM ${table("retrieval_submissions")} WHERE run_id=$1 AND artifact_id IS NOT NULL`,
          [child.run.id],
        )
      ).rows,
      datasets = [];
    for (const entry of entries) {
      const data = await retrievalService.dataset(
        owner,
        entry.artifact_id,
        link.retrieval_id,
      );
      const a = runtimeArtifactSchema.parse(
        await client.request(`/v1/artifacts/${entry.artifact_id}`),
      );
      artifacts.push(a);
      datasets.push(
        projectDataset(data.id, data.payload, {
          retrievalId: link.retrieval_id,
          runtimeSessionId: child.run.sessionId,
          runtimeRunId: child.run.id,
        }),
      );
    }
    queries.push({
      id: child.run.id,
      threadId: sessionId,
      requestSeq,
      sourceKind: "retrieval",
      sourceRef: link.retrieval_id,
      question: link.input.question,
      status: child.run.status,
      fullContent: finalText(child),
      backendSessions: [],
      qcResult: link.qc_result,
      datasetsPayload: datasets.map((d) => ({
        id: d.id,
        datasetKey: d.id,
        title: d.name,
        rows: d.data,
        dsl: d.dsl,
        abcProgram: d.abcProgram,
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
              d.abcProgram?.outKeyRefs?.flatMap((r) =>
                r.className ? [r.className] : [],
              ) ?? [],
          ),
        ),
      ],
      createdAt: new Date(child.run.createdAt),
      updatedAt: new Date(child.run.finishedAt ?? child.run.createdAt),
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
    answer: finalText(run),
    messages,
    runs: [run],
    retrievalRuns,
    artifacts,
    queries,
    retrievalRequested: links.length > 0,
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
export async function readAssistantHistory(
  sessionId: string,
  access: AssistantReadAccess,
) {
  await readOwner(sessionId, access);
  const turns = [];
  for (const t of await assistantStore.turns(sessionId))
    turns.push(
      await readAssistantTurnEvidence(sessionId, t.request_seq, access),
    );
  return { sessionId, turns, messages: turns.flatMap((t) => t.messages) };
}
