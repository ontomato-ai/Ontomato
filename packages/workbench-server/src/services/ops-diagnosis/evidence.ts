import { z } from "zod";
import { diagnosisEvidenceSchema, type DiagnosisEvidence, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { agentHostRunSnapshotSchema, agentHostSessionSnapshotSchema } from "@ontomato/contracts/agent-host";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { retrievalCallerSchema, retrievalEvidenceSchema } from "@ontomato/contracts/data-retrieval";
import { assistantStore } from "../assistant/store";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { publicMessages, publicSnapshot, publicRun } from "../../platform/agent-runtime/projection";
import { parseTurnKey } from "../../logging/log-context";
import { backendGet, backendPost, BackendResponseError, AuthFailedError } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { HttpError } from "../../utils/errors";
import { loadRunMeta, loadCaseResults } from "../../platform/diagnosis/autotest/results/store";
import type { AgentHostOwner } from "../agent-host/types";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { diagnosisSession, diagnosisService } from "./service";

export interface EvidenceCaller extends AgentHostOwner, AssistantCredentials {}
/** Only fixed owner routes call this helper. No service credential or caller-supplied URL. */
export async function ontologyRead(endpoint: string, caller: AssistantCredentials, body?: unknown) {
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + endpoint;
  const options = { token: caller.token, apiKey: caller.apiKey, locale: caller.locale, retries: 1, timeoutMs: 30_000, errorDetailLimit: 0 };
  try {
    const response = body === undefined ? await backendGet(endpoint, url, options) : await backendPost(endpoint, url, body, options);
    return JSON.parse(response.text) as unknown;
  } catch (e) {
    if (e instanceof BackendResponseError || e instanceof AuthFailedError)
      throw new HttpError(e.status ?? 503, "Ontology evidence is unavailable", e.status === 404 ? "NOT_FOUND" : e.status === 403 ? "FORBIDDEN" : "DEPENDENCY_UNAVAILABLE");
    throw new HttpError(503, "Ontology evidence is unavailable", "DEPENDENCY_UNAVAILABLE");
  }
}

async function sourceTurn(target: DiagnosisTarget, domainId: string) {
  let sessionId: string, requestSeq: number | undefined, runId: string | undefined;
  if (target.kind === "assistant-run") { sessionId = target.sessionId; runId = target.runId; }
  else {
    let key: string | undefined;
    if (target.kind === "turn") key = target.turnKey;
    else {
      const meta = loadRunMeta(target.testRunId);
      if (!meta || meta.domainId !== domainId) throw new HttpError(404, "Test case not found", "NOT_FOUND");
      key = loadCaseResults(target.testRunId).find((c) => c.caseId === target.caseId)?.turnKey;
    }
    const turn = key ? parseTurnKey(key) : null;
    if (!turn) throw new HttpError(404, "Turn reference is unavailable", "NOT_FOUND");
    sessionId = turn.threadId; requestSeq = turn.requestSeq;
  }
  await assistantStore.domainSession(sessionId, domainId);
  const turn = (await assistantStore.turns(sessionId)).find((t) => runId ? t.id === runId : t.request_seq === requestSeq);
  if (!turn) throw new HttpError(404, "Turn not found", "NOT_FOUND");
  return turn;
}

export async function resolveDiagnosisEvidence(target: DiagnosisTarget, caller: EvidenceCaller): Promise<DiagnosisEvidence> {
  const turn = await sourceTurn(target, caller.domainId);
  const root = await new RuntimeClient(caller.domainId).run(turn.id);
  if (root.run.sessionId !== turn.session_id) throw new HttpError(404, "Run not found", "NOT_FOUND");
  const result: DiagnosisEvidence = { target, resolvedAt: new Date().toISOString(), runs: [], logQueries: [], gaps: [] };
  const add = (owner: "workbench" | "ontology", snapshot: z.infer<typeof agentHostRunSnapshotSchema>, correlationId: string | null) => {
    result.runs.push({ owner, sessionId: snapshot.run.sessionId, runId: snapshot.run.id, correlationId, artifactIds: snapshot.artifacts.map((a) => a.id) });
    const from = new Date(Math.max(0, Date.parse(snapshot.run.createdAt) - 5000)).toISOString();
    const to = new Date(Date.parse(snapshot.run.finishedAt ?? result.resolvedAt) + 5000).toISOString();
    for (const service of ["workbench", "ontology", "agent-runtime"] as const)
      result.logQueries.push({ service, query: { from, to, ...(correlationId ? { correlationId } : { runId: snapshot.run.id }), limit: 200 } });
    if (!correlationId) result.gaps.push({ source: snapshot.run.id, code: "CORRELATION_UNAVAILABLE", message: "Correlation is unavailable; the supplied log queries cover this run ID only." });
  };
  add("workbench", publicSnapshot(root), root.run.correlationId);
  try {
    const links = retrievalCallerSchema.parse(await ontologyRead(`/ontology/retrieval-callers/${turn.retrieval_scope_id}`, caller));
    for (const link of links.retrievals) {
      const evidence = retrievalEvidenceSchema.parse(await ontologyRead(`/ontology/retrievals/${link.retrievalId}/runs/${link.runId}/evidence`, caller));
      const session = evidence.snapshot.runtimeSessionId;
      if (!session) throw new HttpError(503, "Ontology runtime reference is unavailable");
      const run = agentHostRunSnapshotSchema.parse(await ontologyRead(`/ontology/ai/sessions/${session}/runs/${link.runId}`, caller));
      add("ontology", run, null);
    }
  } catch {
    // The owner facade does not yet grant same-domain observers access to another user's sessions.
    result.gaps.push({ source: "ontology", code: "EVIDENCE_UNAVAILABLE", message: "Ontology evidence is temporarily unavailable under the current caller's authorization. No service privilege was substituted." });
  }
  return diagnosisEvidenceSchema.parse(result);
}

export async function readEvidenceSession(provider: "workbench" | "ontology", id: string, caller: EvidenceCaller) {
  if (provider === "ontology") {
    const snapshot = agentHostSessionSnapshotSchema.parse(await ontologyRead(`/ontology/ai/sessions/${id}`, caller));
    return { ...snapshot, messages: publicMessages(snapshot.messages), latestRun: snapshot.latestRun ? publicSnapshot(snapshot.latestRun) : null };
  }
  let row;
  try { row = await assistantStore.domainSession(id, caller.domainId); }
  catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; await diagnosisSession(id, caller); return diagnosisService.snapshot(id, caller); }
  const snapshot = await new RuntimeClient(caller.domainId).session(id);
  return agentHostSessionSnapshotSchema.parse({
    session: { id, agentId: row.agent_id, title: row.title, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), latestRun: snapshot.latestRun ? publicRun(snapshot.latestRun.run) : null },
    messages: publicMessages(snapshot.messages), latestRun: snapshot.latestRun ? publicSnapshot(snapshot.latestRun) : null,
  });
}
export async function readEvidenceRun(provider: "workbench" | "ontology", session: string, run: string, caller: EvidenceCaller) {
  if (provider === "ontology") return publicSnapshot(agentHostRunSnapshotSchema.parse(await ontologyRead(`/ontology/ai/sessions/${session}/runs/${run}`, caller)));
  await readEvidenceSession(provider, session, caller);
  const snapshot = await new RuntimeClient(caller.domainId).run(run);
  if (snapshot.run.sessionId !== session) throw new HttpError(404, "Run not found", "NOT_FOUND");
  return publicSnapshot(snapshot);
}
export async function readEvidenceArtifact(provider: "workbench" | "ontology", session: string, artifact: string, caller: EvidenceCaller) {
  const a = provider === "ontology"
    ? runtimeArtifactSchema.parse(await ontologyRead(`/ontology/ai/sessions/${session}/artifacts/${artifact}`, caller))
    : (await readEvidenceSession(provider, session, caller), runtimeArtifactSchema.parse(await new RuntimeClient(caller.domainId).request(`/v1/artifacts/${artifact}`)));
  if (a.sessionId !== session) throw new HttpError(404, "Artifact not found", "NOT_FOUND");
  return a;
}
