import { agentQualityProjectionSchema } from "@ontomato/contracts/agent-task-results";
import { z } from "zod";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";
import { datasetPayloadSchema, retrievalEvidenceSchema, retrievalCallerSchema, retrievalCallerAdmissionSchema, type RetrievalCallerInput } from "@ontomato/contracts/data-retrieval";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { backendGet, backendPost, backendDelete, buildBackendHeaders } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";
import type { AssistantOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

function serviceHeaders(owner: AssistantOwner, credentials?: AssistantCredentials) {
  return {
    ...buildBackendHeaders(credentials?.token, undefined, credentials?.locale, credentials?.apiKey),
    "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
    "X-Domain-Id": owner.domainId,
  };
}
async function ontologyRequest(path: string, headers: Record<string, string>, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown) {
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + path;
  const options = { headers, retries: 1, timeoutMs: 30000, errorDetailLimit: 1000 };
  const response = method === "GET" ? await backendGet(path, url, options)
    : method === "DELETE" ? await backendDelete(path, url, options)
    : await backendPost(path, url, body, options);
  return response.text ? JSON.parse(response.text) as unknown : null;
}

/** Application-owned parent association and evidence access, never retrieval orchestration. */
export class OntologyRetrievalClient {
  constructor(readonly owner: AssistantOwner, readonly scopeId: string) {}
  private headers(credentials?: AssistantCredentials, key?: string) {
    return {
      ...serviceHeaders(this.owner, credentials),
      "X-Ontomato-Retrieval-Caller-Id": this.scopeId,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
  }
  private request(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown, credentials?: AssistantCredentials, key?: string) {
    return ontologyRequest(path, this.headers(credentials, key), method, body);
  }
  async open(input: RetrievalCallerInput, credentials: AssistantCredentials) {
    return retrievalCallerAdmissionSchema.parse(await this.request("/ontology/retrieval-callers", "POST", input, credentials, this.scopeId));
  }
  async links() {
    return retrievalCallerSchema.parse(await this.request(`/ontology/retrieval-callers/${this.scopeId}`)).retrievals;
  }
  async closeScope(credentials?: AssistantCredentials) {
    await this.request(`/ontology/retrieval-callers/${this.scopeId}/close-scope`, "POST", {}, credentials);
  }
  async quality(retrievalId:string,runId:string) {
    return z.object({quality:z.array(agentQualityProjectionSchema)}).strict().parse(await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/quality`)).quality;
  }
  async evidence(retrievalId: string, runId: string) {
    return retrievalEvidenceSchema.parse(await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/evidence`));
  }
  async run(sessionId: string, runId: string) {
    return agentHostRunSnapshotSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/runs/${runId}`));
  }
  async events(sessionId: string, runId: string, after: { seq: number; streamId: string }, signal: AbortSignal) {
    const query = new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId });
    const path = `/ontology/ai/sessions/${sessionId}/runs/${runId}/events?${query}`;
    return backendGet(path, getApiConfig().baseUrl!.replace(/\/$/, "") + path, {
      headers: { ...this.headers(), Accept: "text/event-stream" }, stream: true,
      retries: 1, timeoutMs: 30000, signal, errorDetailLimit: 1000,
    });
  }
  async dataset(retrievalId: string, artifactId: string) {
    return z.object({ id: z.string().uuid(), payload: datasetPayloadSchema, source: z.literal("binding").optional(), sha256: z.string().optional() }).parse(await this.request(`/ontology/retrievals/${retrievalId}/datasets/${artifactId}`));
  }
  async artifact(sessionId: string, artifactId: string) {
    return runtimeArtifactSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/artifacts/${artifactId}`));
  }
  async delete(retrievalId: string) {
    await this.request(`/ontology/retrievals/${retrievalId}`, "DELETE");
  }
}

