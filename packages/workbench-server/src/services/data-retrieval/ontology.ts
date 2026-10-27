import {
  backendGet,
  backendPost,
  buildBackendHeaders,
} from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";

export interface RetrievalCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
}
/** Uses the existing ontology transport policy; no second retry/error implementation. */
export async function ontologyRequest(
  path: string,
  credentials: RetrievalCredentials,
  body?: unknown,
  signal?: AbortSignal,
) {
  const headers = buildBackendHeaders(
    credentials.token,
    undefined,
    credentials.locale,
    credentials.apiKey,
  );
  if (path.startsWith("/internal/") || path.startsWith("/query-quality-checks"))
    headers["X-Ontomato-Query-Service-Token"] =
      environment.agentRuntime().queryServiceToken;
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + path;
  const options = {
    headers,
    signal,
    errorDetailLimit: 1000000,
    retries:
      body === undefined ||
      (body &&
        typeof body === "object" &&
        ("submissionId" in body || "id" in body))
        ? 3
        : 1,
  };
  const response =
    body === undefined
      ? await backendGet(path, url, options)
      : await backendPost(path, url, body, options);
  return JSON.parse(response.text) as Record<string, any>;
}
