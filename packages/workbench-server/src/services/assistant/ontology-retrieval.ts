import type {AssistantRetrievalOperation,AssistantRetrievalCallerInput} from "@ontomato/contracts/assistant-retrieval";
import { replyQualitySchema } from "@ontomato/contracts/agent-task-results";
import { z } from "zod";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";
import { storedDataset, retrievalEvidenceSchema, retrievalCallerSchema, retrievalCallerAdmissionSchema, retrievalCallerUserQuotesSchema } from "@ontomato/contracts/data-retrieval";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { backendGet, backendPost, backendDelete, backendPut, buildBackendHeaders } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";
import type { AssistantOwner } from "./store";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

function serviceHeaders(owner: AssistantOwner, credentials?: AssistantCredentials) {
  return {
    ...buildBackendHeaders(credentials?.token, undefined, credentials?.locale, credentials?.apiKey),
    "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
    "X-Domain-Id": owner.domainId,
  };
}
async function ontologyRequest(path: string, headers: Record<string, string>, method: "GET" | "POST" | "DELETE" | "PUT" = "GET", body?: unknown) {
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + path;
  const options = { headers, retries: 1, timeoutMs: 30000, errorDetailLimit: 1000 };
  const response = method === "GET" ? await backendGet(path, url, options)
    : method === "DELETE" ? await backendDelete(path, url, options)
    : method === "PUT" ? await backendPut(path, url, body, options)
    : await backendPost(path, url, body, options);
  return response.text ? JSON.parse(response.text) as unknown : null;
}

/** Application-owned parent association and evidence access, never retrieval orchestration. */
export class OntologyRetrievalClient {
  constructor(readonly owner: AssistantOwner, readonly scopeId: string, readonly operationCredentials?:AssistantCredentials) {}
  /** Only these fixed capability entries carry service authentication for split ownership. */
  async executeOperation(operation:AssistantRetrievalOperation) {
    if(operation.operation==="begin")return this.request("/ontology/retrievals/skill-runs","POST",operation.input,this.operationCredentials,operation.key);
    const path=`/ontology/retrievals/${operation.retrievalId}`;
    if(operation.operation==="close")return this.request(`${path}/skill-runs/${operation.retrievalRunId}/close`,"POST",{},this.operationCredentials);
    const output=`${path}/runs/${operation.retrievalRunId}/outputs`;
    const headers={...this.headers(this.operationCredentials,operation.key),"X-Ontomato-Run-Id":operation.retrievalRunId};
    if(operation.operation==="submit")return ontologyRequest(output,headers,"POST",operation.input);
    if(operation.operation==="submit-metric")
      return ontologyRequest(`${path}/runs/${operation.retrievalRunId}/submit-metric`,headers,"POST",operation.input);
    return ontologyRequest(`${output}/${operation.key}${operation.operation==="content"?"/content":""}`,headers);
  }

  private headers(credentials?: AssistantCredentials, key?: string) {
    return {
      ...serviceHeaders(this.owner, credentials),
      "X-Ontomato-Retrieval-Caller-Id": this.scopeId,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
  }
  private request(path: string, method: "GET" | "POST" | "DELETE" | "PUT" = "GET", body?: unknown, credentials?: AssistantCredentials, key?: string) {
    return ontologyRequest(path, this.headers(credentials, key), method, body);
  }
  async open(input: AssistantRetrievalCallerInput, credentials: AssistantCredentials) {
    return retrievalCallerAdmissionSchema.parse(await this.request("/ontology/retrieval-callers", "POST", input, credentials, this.scopeId));
  }
  async updateUserQuotes(recentUserMessages: string[], credentials: AssistantCredentials) {
    await this.request(`/ontology/retrieval-callers/${this.scopeId}/user-quotes`, "PUT", retrievalCallerUserQuotesSchema.parse({recentUserMessages}), credentials);
  }
  async links() {
    return retrievalCallerSchema.parse(await this.request(`/ontology/retrieval-callers/${this.scopeId}`)).retrievals;
  }
  async closeScope(credentials?: AssistantCredentials) {
    await this.request(`/ontology/retrieval-callers/${this.scopeId}/close-scope`, "POST", {}, credentials);
  }
  /** The checks this scope's reply scheduled; the scope is the reply's own caller. */
  async replyQuality() {
    return replyQualitySchema.parse(await this.request(`/ontology/retrieval-callers/${this.scopeId}/quality`));
  }
  /** Reports that a finished reply cited these outputs of a round this scope admitted. */
  async adoptQuality(retrievalId: string, runId: string, replyRunId: string, outputIds: string[]) {
    await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/quality`, "POST", { replyRunId, outputIds });
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
  /** The formal output a stored file reproduces; a file from another round is simply not this round's source. */
  async datasetSource(retrievalId: string, receiptId: string, dataset: string) {
    try {
      const value = await this.request(`/ontology/retrievals/${retrievalId}/dataset-source`, "POST", { receiptId, dataset });
      if (value === null) return null;
      return z.object({ runId: z.string().uuid(), outputId: z.string().uuid() }).strict().parse(value);
    } catch (error: unknown) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }
  async dataset(retrievalId: string, artifactId: string) {
    const value = z.object({ id: z.string().uuid(), payload: z.unknown() }).strict().parse(await this.request(`/ontology/retrievals/${retrievalId}/datasets/${artifactId}`));
    return { ...value, payload: storedDataset(value.payload) };
  }
  /** A metric run's delivered output, the original stored dataset. */
  async output(retrievalId: string, runId: string, outputId: string) {
    return storedDataset(await this.request(`/ontology/retrievals/${retrievalId}/runs/${runId}/outputs/${outputId}/content`));
  }
  async artifact(sessionId: string, artifactId: string) {
    return runtimeArtifactSchema.parse(await this.request(`/ontology/ai/sessions/${sessionId}/artifacts/${artifactId}`));
  }
  async delete(retrievalId: string) {
    await this.request(`/ontology/retrievals/${retrievalId}`, "DELETE");
  }
}

