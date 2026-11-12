import type { HttpErrorResponse } from "@ontomato/contracts/http";
import { workbenchI18n } from "../i18n";
import { authHost } from "./auth";
import { errorPunctuation } from "./error-punctuation";
import { syncServerNowFromResponse } from "./server-time";
import { API_BASE } from "./api-base";

const t = (key: string) => workbenchI18n().global.t(key);

function normalizePath(path: string): string {
  if (!path) return "";
  const p = String(path);
  return p.startsWith("/") ? p : `/${p}`;
}

/** Current credential (token first): captured when the request is sent and compared again after the response and its JSON arrive. */
function currentCredential(): string | null {
  const host = authHost();
  return host.getToken() || host.getApiKey();
}

function buildBaseHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": workbenchI18n().global.locale.value,
  };

  const host = authHost();
  const token = host.getToken();
  const apiKey = host.getApiKey();
  if (token) {
    headers.tk = token;
  } else if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return { ...headers, ...extraHeaders };
}

interface ApiErrorPayload extends Partial<Omit<HttpErrorResponse, "error">> {
  error?: unknown;
  message?: string;
  msg?: string;
  [key: string]: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: ApiErrorPayload = {}
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  get code(): string | undefined {
    const nested = this.payload.error;
    return this.payload.code ?? (nested && typeof nested === "object" && "code" in nested && typeof nested.code === "string" ? nested.code : undefined);
  }
}

/** Only human-readable strings reach UI errors; structured envelopes are never coerced to text. */
function errorMessage(payload: ApiErrorPayload, fallback: string): string {
  const nested = payload.error;
  const nestedMessage = nested && typeof nested === "object" && "message" in nested ? nested.message : undefined;
  return [nestedMessage, nested, payload.message, payload.msg].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()) && !value.includes("[object Object]"),
  ) ?? fallback;
}

function formatErrorDetails(details: unknown): string {
  if (!Array.isArray(details)) return "";
  return details
    .map((detail) => {
      if (!detail || typeof detail !== "object") return "";
      const record = detail as Record<string, unknown>;
      const field = typeof record.field === "string" ? record.field : "";
      const message = typeof record.message === "string" ? record.message : "";
      return [field, message].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join(errorPunctuation().listSeparator);
}

async function createApiRequestError(res: Response, _path: string): Promise<ApiRequestError> {
  const fallback = t("admin.requestFailed") + `: HTTP ${res.status}`;
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as ApiErrorPayload;
      const message = errorMessage(payload, fallback);
      const details = formatErrorDetails(payload.details);
      return new ApiRequestError(details ? `${message}${errorPunctuation().detailSeparator}${details}` : message, res.status, payload);
    }
    const text = (await res.text()).trim();
    return new ApiRequestError(text || fallback, res.status);
  } catch {
    return new ApiRequestError(fallback, res.status);
  }
}

/** A response the backend answered with `success: false`; `body` is that response, for callers that read its `data`. */
export class ApiBusinessError extends Error {
  constructor(
    message: string,
    readonly body: unknown
  ) {
    super(message);
    this.name = "ApiBusinessError";
  }
}

function assertBusinessSuccess(json: any, _path: string) {
  if (json && json.success === false) {
    const msg = errorMessage(json, t("admin.requestFailed"));
    throw new ApiBusinessError(msg, json);
  }
  return json;
}

export function createEventSource(url: string): EventSource {
  return new EventSource(url);
}

async function readJsonResponse(res: Response, credential: string | null): Promise<any> {
  const json = await res.json();
  if (credential !== currentCredential()) {
    throw new DOMException(t("user.sessionExpired"), "AbortError");
  }
  return json;
}

export async function apiGet(path: string, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}/data-query${normalizePath(path)}`, {
    method: "GET",
    ...opts,
    headers: buildBaseHeaders(extraHeaders),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  const json = await readJsonResponse(res, credential);
  return assertBusinessSuccess(json, path);
}

export async function apiPost(path: string, body?: any, opts?: any): Promise<any> {
  return sendJson("POST", path, body, opts);
}

export async function apiPut(path: string, body?: any, opts?: any): Promise<any> {
  return sendJson("PUT", path, body, opts);
}

/** A data engine request with a JSON body, answered in the data engine's envelope. */
async function sendJson(method: "POST" | "PUT", path: string, body?: any, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}/data-query${normalizePath(path)}`, {
    method,
    ...opts,
    headers: buildBaseHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    body: JSON.stringify(body ?? {}),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  const json = await readJsonResponse(res, credential);
  return assertBusinessSuccess(json, path);
}

export async function nodeApiGet(path: string, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "GET",
    ...opts,
    headers: buildBaseHeaders(extraHeaders),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiPost(path: string, body?: any, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "POST",
    ...opts,
    headers: buildBaseHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    body: JSON.stringify(body ?? {}),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiPut(path: string, body?: any, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "PUT",
    ...opts,
    headers: buildBaseHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    body: JSON.stringify(body ?? {}),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiDelete(path: string, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "DELETE",
    ...opts,
    headers: buildBaseHeaders(extraHeaders),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiPatch(path: string, body?: any, opts?: any): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "PATCH",
    ...opts,
    headers: buildBaseHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    body: JSON.stringify(body ?? {}),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiPostFormData(
  path: string,
  formData: FormData,
  opts?: any
): Promise<any> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "POST",
    ...opts,
    headers: buildBaseHeaders(extraHeaders),
    body: formData,
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return readJsonResponse(res, credential);
}

export async function nodeApiBlobPost(path: string, body?: any, opts?: any): Promise<Blob> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method: "POST",
    ...opts,
    headers: buildBaseHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    body: JSON.stringify(body ?? {}),
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return res.blob();
}

/**
 * A request to a path the API root already prefixes: the platforms outside this app (the schedules page) are given paths
 * that begin with the gateway's `/api`, which `nodeApiFetch` would add a second time. This strips that one segment and
 * otherwise sends exactly what `nodeApiFetch` sends — the same credential, the same host error handling.
 */
export async function nodeApiRequest(path: string, init: any = {}): Promise<Response> {
  const relative = path.replace(/^\/api(?=\/)/, "");
  return nodeApiFetch(relative, init.method ?? "GET", init.body ? JSON.parse(String(init.body)) : undefined, {
    headers: init.headers,
  });
}

export async function nodeApiFetch(
  path: string,
  method: string,
  body?: any,
  opts?: any
): Promise<Response> {
  const credential = currentCredential();
  const extraHeaders = (opts && opts.headers) || {};
  const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
    method,
    ...opts,
    headers: buildBaseHeaders({
      ...(method !== "GET" && method !== "DELETE" ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    }),
    body: method !== "GET" && method !== "DELETE" ? JSON.stringify(body ?? {}) : undefined,
  });
  syncServerNowFromResponse(res);

  if (!res.ok) {
    throw authHost().responseStatusError(res.status, credential) ?? (await createApiRequestError(res, path));
  }

  return res;
}
