import {
  generalConfigSaveEndpoints,
  ontologyOutlineSchema,
  type GeneralConfigKey,
} from "./config/types";

/**
 * Platform area requests. The platform pages live next to the Ontology Manager and call the Java service through the
 * gateway at `P/api/data-query/*`, with the credential the host supplies. The request layer keeps no global state: one
 * instance per page load, so a credential change rebuilds the page instead of mixing two identities' data.
 */

export type PlatformCredential =
  | { type: "token"; token: string }
  | { type: "apiKey"; apiKey: string }
  | { type: "anonymous" };

export interface PlatformRequestContext {
  /** Gateway API root without a trailing slash, e.g. `/wenshu/api`. */
  readonly apiBase: string;
  readonly credential: PlatformCredential | null;
  /** The page's current language, sent as Accept-Language. */
  readonly locale: () => string;
  /** 401 means the session expired and 402 that the license check failed; the host decides what to do. */
  readonly onAuthFailure?: (status: 401 | 402) => void;
}

function credentialHeaders(credential: PlatformCredential): Record<string, string> {
  switch (credential.type) {
    case "token":
      return { tk: credential.token };
    case "apiKey":
      return { "x-api-key": credential.apiKey };
    case "anonymous":
      return {};
  }
}

/** The service answered `success: false`; `body` is that response for callers that read its data. */
export class PlatformBusinessError extends Error {
  constructor(
    message: string,
    readonly body: unknown
  ) {
    super(message);
    this.name = "PlatformBusinessError";
  }
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;

type RequestOptions = NonNullable<Parameters<typeof fetch>[1]>;

export function createPlatformClient(context: PlatformRequestContext) {
  let disposed = false;

  async function request(path: string, init: RequestOptions = {}): Promise<Response> {
    if (disposed) throw new DOMException("Request dropped: the page was rebuilt", "AbortError");
    const credential = context.credential;
    if (!credential) throw new Error("No credential for a platform request");
    const response = await fetch(`${context.apiBase}/data-query${path}`, {
      ...init,
      headers: {
        ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
        "Accept-Language": context.locale(),
        "X-Requested-With": "XMLHttpRequest",
        ...credentialHeaders(credential),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (response.status === 401 || response.status === 402) context.onAuthFailure?.(response.status);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error || body?.message || body?.msg || `Request failed: HTTP ${response.status}`
      );
    }
    return response;
  }

  async function read(path: string, init: RequestOptions) {
    const json = await (await request(path, init)).json();
    if (json && json.success === false) {
      throw new PlatformBusinessError(json.error || json.message || json.msg || "Request failed", json);
    }
    return json;
  }

  return {
    get: (path: string) => read(path, { method: "GET" }),
    post: (path: string, body?: unknown) =>
      read(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    dispose: () => {
      disposed = true;
    },
  };
}

/** Java platform endpoints the shared platform pages use; enterprise pages add their own above this object. */
export function platformApi(client: PlatformClient) {
  return {
    queryAuditLogs: (params: unknown) => client.post("/auditLog/queryPage", params),
    getServiceInfo: () => client.get("/maintenance/getserviceinfo"),
    getBusinessConfig: () => client.get("/businessConfig/getConfig"),
    listDataAdapters: () => client.get("/businessConfig/dataAdapters"),
    useDataAdapter: (payload: unknown) => client.post("/businessConfig/useDataAdapter", payload),
    useMultiDataSource: (definition: unknown) =>
      client.post("/businessConfig/useMultiDataSource", definition),
    testDataAdapter: (payload: unknown) => client.post("/businessConfig/testDataAdapter", payload),
    saveGeneralConfig: (key: GeneralConfigKey, value: unknown) =>
      client.post(generalConfigSaveEndpoints[key], { [key]: value }),
    getOntologyOutline: async () =>
      ontologyOutlineSchema.parse((await client.get("/admin/getSchema")).data),
  };
}

export type PlatformApi = ReturnType<typeof platformApi>;
