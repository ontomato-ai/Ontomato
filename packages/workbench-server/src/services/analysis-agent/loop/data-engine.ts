import { buildHeaders, getApiConfig } from "../../../config/data-query-api";
import { config } from "../../../config/application";
import * as backend from "../../../utils/backend-client";

/** The caller whose own credentials and permissions a loop tool's data engine call runs with. */
export interface DataEngineCaller {
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const errorMessage = (error: unknown): string => {
  if (error instanceof backend.AuthFailedError || error instanceof backend.BackendResponseError)
    return `HTTP ${error.status}${error.detail ? ` ${error.detail}` : ""}`;
  if (error instanceof backend.BackendUnavailableError && error.cause) return errorMessage(error.cause);
  return error instanceof Error ? error.message : String(error);
};

/**
 * Post to a data engine endpoint as the caller and return the whole `{success: true, ...}` payload; a payload
 * without `success: true` throws its message. `retries` is the number of attempts: a write is never retried.
 */
export async function postDataEngine(
  caller: DataEngineCaller,
  endpoint: string,
  body: Record<string, unknown> | URLSearchParams,
  signal: AbortSignal,
  retries = 1
): Promise<Record<string, unknown>> {
  const baseUrl = config.dataQuery.baseUrl.replace(/\/+$/, "");
  const headers = buildHeaders(getApiConfig(), caller.token, caller.userId, caller.locale, caller.apiKey);
  if (body instanceof URLSearchParams) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await backend
    .backendPost(endpoint, `${baseUrl}${endpoint}`, body, { headers, signal, retries })
    .catch((error) => {
      throw signal.aborted ? signal.reason : error;
    });
  const payload: unknown = JSON.parse(response.text);
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : response.text);
  }
  return payload;
}
