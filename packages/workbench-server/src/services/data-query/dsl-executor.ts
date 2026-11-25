import { config } from "../../config/application";
import { t, tApp } from "../../i18n";
import { backendPost, BackendResponseError, BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

function normalizeDslExecutionPayload(payload: unknown): unknown {
  if (hasDslExecutionError(payload)) return payload;
  if (
    payload && typeof payload === "object" && "success" in payload && payload.success === true
    && "data" in payload && payload.data !== undefined && !Array.isArray(payload.data)
  ) {
    return payload.data;
  }
  return payload;
}

export function hasDslExecutionError(payload: unknown): boolean {
  return payload !== null && typeof payload === "object" && "error" in payload && payload.error != null;
}

function readPayload(text: string, headers: Headers | undefined): unknown {
  if (!headers?.get("content-type")?.includes("application/json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const DSL_EXECUTE_ENDPOINT = "dsl/executeV1";

export async function executeDslViaBackend(
  dsl: Record<string, unknown>,
  tk: string,
  timeoutMs = 30000,
  signal?: AbortSignal,
): Promise<unknown> {
  const backendUrl = config.dataQuery.baseUrl;
  if (!backendUrl) throw new HttpError(500, t("api.backendNotConfigured"), "DSL_EXECUTION_FAILED");

  const executeUrl = `${backendUrl.replace(/\/$/, "")}/${DSL_EXECUTE_ENDPOINT}`;
  let response;
  try {
    response = await backendPost(DSL_EXECUTE_ENDPOINT, executeUrl, dsl, { token: tk, timeoutMs, signal });
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      throw new HttpError(503, t("api.backendRequestFailed", {
        message: tApp("queryFixed.242", { v0: error.message }),
      }), "DSL_EXECUTION_FAILED");
    }
    if (error instanceof BackendResponseError && [400, 422, 500].includes(error.status)) {
      const payload = normalizeDslExecutionPayload(readPayload(error.detail, error.headers));
      // The DSL owner pairs its execution error with source analysis. Generic HTTP errors also have an "error" field.
      if (hasDslExecutionError(payload) && payload && typeof payload === "object" && "sourceAnalysis" in payload) {
        return payload;
      }
    }
    throw error;
  }

  const payload = readPayload(response.text, response.headers);
  if (payload && typeof payload === "object" && "success" in payload && payload.success === false) {
    const status = "code" in payload && typeof payload.code === "number" && payload.code >= 400 && payload.code < 600
      ? payload.code
      : 502;
    const message = "message" in payload && typeof payload.message === "string" ? payload.message : response.statusText;
    throw new HttpError(status, message, "DSL_EXECUTION_FAILED");
  }
  return normalizeDslExecutionPayload(payload);
}
