import { z } from "zod";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";
import type { RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import { datasetPayloadSchema, retrievalEvidenceSchema, retrievalSnapshotSchema, retrievalCallerSchema, retrievalCallerAdmissionSchema, type RetrievalCallerInput } from "@ontomato/contracts/data-retrieval";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { backendGet, backendPost, backendDelete, buildBackendHeaders, BackendResponseError } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import type { AssistantOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

/** Application-owned parent association and evidence access, never retrieval orchestration. */
export class OntologyRetrievalClient {
  constructor(readonly owner: AssistantOwner, readonly scopeId: string) {}
  private headers(credentials?: AssistantCredentials, key?: string) {
    return {
      ...buildBackendHeaders(credentials?.token, undefined, credentials?.locale, credentials?.apiKey),
      "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
      "X-Domain-Id": this.owner.domainId,
      "X-Ontomato-Retrieval-Caller-Id": this.scopeId,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
  }
  private async request(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown, credentials?: AssistantCredentials, key?: string) {
    const url = getApiConfig().baseUrl!.replace(/\/$/, "") + path;
    const options = { headers: this.headers(credentials, key), retries: 1, timeoutMs: 30000, errorDetailLimit: 1000 };
    try {
      const response = method === "GET" ? await backendGet(path, url, options)
        : method === "DELETE" ? await backendDelete(path, url, options)
        : await backendPost(path, url, body, options);
      return response.text ? JSON.parse(response.text) as unknown : null;
    } catch (error) {
      throwOntologyError(error);
    }
  }
  async open(input: RetrievalCallerInput, credentials: AssistantCredentials) {
    return retrievalCallerAdmissionSchema.parse(await this.request("/ontology/retrieval-callers", "POST", input, credentials, this.scopeId));
  }
  async links() {
    return retrievalCallerSchema.parse(await this.request(`/ontology/retrieval-callers/${this.scopeId}`)).retrievals;
  }
  async close(credentials?: AssistantCredentials) {
    await this.request(`/ontology/retrieval-callers/${this.scopeId}/close`, "POST", {}, credentials);
  }
  async readSnapshot(retrievalId: string, runId: string) {
    return retrievalSnapshotSchema.parse(await this.request(`/ontology/retrievals/${retrievalId}?runId=${runId}`));
  }
  async evidence(retrievalId: string, runId: string) {
    return retrievalEvidenceSchema.parse(await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/evidence`));
  }
  async run(sessionId: string, runId: string) {
    return agentHostRunSnapshotSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/runs/${runId}`));
  }
  async activityRun(sessionId: string, runId: string) {
    const snapshot = await this.run(sessionId, runId);
    return { ...snapshot, messages: [], pendingMessages: [], artifacts: [] };
  }
  async events(sessionId: string, runId: string, after: { seq: number; streamId: string }, signal: AbortSignal) {
    const query = new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId });
    const path = `/ontology/ai/sessions/${sessionId}/runs/${runId}/events?${query}`;
    try {
      return await backendGet(path, getApiConfig().baseUrl!.replace(/\/$/, "") + path, {
        headers: { ...this.headers(), Accept: "text/event-stream" }, stream: true,
        retries: 1, timeoutMs: 30000, signal, errorDetailLimit: 1000,
      });
    } catch (error) {
      throwOntologyError(error);
    }
  }
  async dataset(retrievalId: string, artifactId: string) {
    return z.object({ id: z.string().uuid(), payload: datasetPayloadSchema, source: z.literal("binding").optional(), sha256: z.string().optional(), qualityCheck: z.record(z.unknown()).optional() }).parse(await this.request(`/ontology/retrievals/${retrievalId}/datasets/${artifactId}`));
  }
  async artifact(sessionId: string, artifactId: string) {
    return runtimeArtifactSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/artifacts/${artifactId}`));
  }
  async delete(retrievalId: string) {
    await this.request(`/ontology/retrievals/${retrievalId}`, "DELETE");
  }
}

/** Activity consumes tool steps and run termination, never the child conversation's transcript. */
export function retrievalActivityFrame(frame: RuntimeStreamFrame): RuntimeStreamFrame | null {
  if (frame.type === "snapshot_required") return frame;
  switch (frame.envelope.event.type) {
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return frame;
    case "agent_end":
      return { ...frame, envelope: { ...frame.envelope, event: { ...frame.envelope.event, messages: [] } } };
    default:
      return null;
  }
}

function throwOntologyError(error: unknown): never {
  if (error instanceof BackendResponseError) {
    let code = "DEPENDENCY_UNAVAILABLE", message = `Ontology returned HTTP ${error.status}`;
    try { const parsed = JSON.parse(error.detail); code = parsed.error?.code ?? code; message = parsed.error?.message ?? message; } catch { /* Retain the HTTP failure when the body is not JSON. */ }
    throw new HttpError(error.status, message, code);
  }
  throw error;
}
