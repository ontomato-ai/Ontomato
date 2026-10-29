import { z } from "zod";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";
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
  private async request(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown, credentials?: AssistantCredentials, key?: string) {
    const headers = {
      ...buildBackendHeaders(credentials?.token, undefined, credentials?.locale, credentials?.apiKey),
      "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
      "X-Domain-Id": this.owner.domainId,
      "X-Ontomato-Retrieval-Caller-Id": this.scopeId,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
    const url = getApiConfig().baseUrl!.replace(/\/$/, "") + path;
    const options = { headers, retries: 1, timeoutMs: 30000, errorDetailLimit: 1000 };
    try {
      const response = method === "GET" ? await backendGet(path, url, options)
        : method === "DELETE" ? await backendDelete(path, url, options)
        : await backendPost(path, url, body, options);
      return response.text ? JSON.parse(response.text) as unknown : null;
    } catch (error) {
      if (error instanceof BackendResponseError) {
        let code = "DEPENDENCY_UNAVAILABLE", message = `Ontology returned HTTP ${error.status}`;
        try { const parsed = JSON.parse(error.detail); code = parsed.error?.code ?? code; message = parsed.error?.message ?? message; } catch { /* Retain the HTTP failure when the body is not JSON. */ }
        throw new HttpError(error.status, message, code);
      }
      throw error;
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
  async readSnapshot(retrievalId: string) {
    return retrievalSnapshotSchema.parse(await this.request(`/ontology/retrievals/${retrievalId}`));
  }
  async evidence(retrievalId: string, runId: string) {
    return retrievalEvidenceSchema.parse(await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/evidence`));
  }
  async run(sessionId: string, runId: string) {
    return agentHostRunSnapshotSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/runs/${runId}`));
  }
  async dataset(retrievalId: string, artifactId: string) {
    return z.object({ id: z.string().uuid(), payload: datasetPayloadSchema }).parse(await this.request(`/ontology/retrievals/${retrievalId}/datasets/${artifactId}`));
  }
  async artifact(sessionId: string, artifactId: string) {
    return runtimeArtifactSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/artifacts/${artifactId}`));
  }
  async delete(retrievalId: string) {
    await this.request(`/ontology/retrievals/${retrievalId}`, "DELETE");
  }
}
