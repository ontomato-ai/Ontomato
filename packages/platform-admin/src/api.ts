import type { AppHostCredential } from "@ontomato/contracts/app-host";
import {
  modelSettingsSchema,
  ontologyAgentModelSchema,
  ontologyAgentModelsSchema,
  type ModelSelection,
  type ModelSettingsData,
  type ModelSettingsWrite,
  type OntologyAgentModel,
} from "@ontomato/contracts/model-settings";
import {
  runtimeModelDiscoveryResponseSchema,
  runtimeModelTestResponseSchema,
  type RuntimeModelDiscoveryRequest,
  type RuntimeModelDiscoveryResponse,
  type RuntimeModelTestRequest,
  type RuntimeModelTestResponse,
} from "@ontomato/contracts/runtime-model-test";
import {
  generalConfigSaveEndpoints,
  ontologyOutlineSchema,
  type GeneralConfigKey,
} from "./config/types";
import { vectorRebuildStatusSchema } from "./models/types";
import { feedbackPageSchema, feedbackPath, type FeedbackQuery } from "./feedback";

/**
 * Platform area requests. The platform pages live next to the Ontology Manager and call the Java service through the
 * gateway at `P/api/data-query/*`, with the credential the host supplies. The request layer keeps no global state: one
 * instance per page load, so a credential change rebuilds the page instead of mixing two identities' data.
 */

/** The host's credential; its shape is the app host contract's, like the Manager's. */
export type PlatformCredential = AppHostCredential;

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

/** The service answered a non-2xx status; `code` is the service's error code when the body carries one. */
export class PlatformHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "PlatformHttpError";
  }
}

/** The service's error code of a failed request (`{success:false,code,message}`), or null. */
export function platformErrorCode(error: unknown): string | null {
  if (error instanceof PlatformHttpError) return error.code;
  if (error instanceof PlatformBusinessError) {
    const code = (error.body as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;

type RequestOptions = NonNullable<Parameters<typeof fetch>[1]>;

/**
 * Which service of the deployment an address belongs to: the data engine (Java) under `/api/data-query`, or the
 * workbench (Node) under `/api` — feedback records are the workbench's.
 */
export type PlatformScope = "/data-query" | "";

export function createPlatformClient(context: PlatformRequestContext) {
  let disposed = false;

  async function request(path: string, init: RequestOptions = {}, scope: PlatformScope = "/data-query"): Promise<Response> {
    if (disposed) throw new DOMException("Request dropped: the page was rebuilt", "AbortError");
    const credential = context.credential;
    if (!credential) throw new Error("No credential for a platform request");
    const response = await fetch(`${context.apiBase}${scope}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        "Accept-Language": context.locale(),
        "X-Requested-With": "XMLHttpRequest",
        ...credentialHeaders(credential),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (response.status === 401 || response.status === 402) context.onAuthFailure?.(response.status);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new PlatformHttpError(
        body?.error || body?.message || body?.msg || `Request failed: HTTP ${response.status}`,
        response.status,
        typeof body?.code === "string" ? body.code : null
      );
    }
    return response;
  }

  async function read(path: string, init: RequestOptions, scope?: PlatformScope) {
    const json = await (await request(path, init, scope)).json();
    if (json && json.success === false) {
      throw new PlatformBusinessError(json.error || json.message || json.msg || "Request failed", json);
    }
    return json;
  }

  return {
    get: (path: string, scope?: PlatformScope) => read(path, { method: "GET" }, scope),
    post: (path: string, body?: unknown, scope?: PlatformScope) =>
      read(path, { method: "POST", body: JSON.stringify(body ?? {}) }, scope),
    put: (path: string, body: unknown, scope?: PlatformScope) =>
      read(path, { method: "PUT", body: JSON.stringify(body) }, scope),
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
    // The domain's model settings, replaced as a whole on save; keys are read masked.
    getModelSettings: async (): Promise<ModelSettingsData> =>
      modelSettingsSchema.parse((await client.get("/model-settings")).data),
    saveModelSettings: async (settings: ModelSettingsWrite): Promise<ModelSettingsData> =>
      modelSettingsSchema.parse((await client.post("/model-settings/save", settings)).data),
    // One minimal call (or the provider's model list) with an unsaved draft; a masked key resolves by provider ID.
    testModel: async (request: RuntimeModelTestRequest): Promise<RuntimeModelTestResponse> =>
      runtimeModelTestResponseSchema.parse((await client.post("/model-settings/test", request)).data),
    discoverModels: async (request: RuntimeModelDiscoveryRequest): Promise<RuntimeModelDiscoveryResponse> =>
      runtimeModelDiscoveryResponseSchema.parse((await client.post("/model-settings/discover", request)).data),
    listOntologyAgentModels: async (): Promise<OntologyAgentModel[]> =>
      ontologyAgentModelsSchema.parse((await client.get("/ontology/ai/agent-models")).data).agents,
    saveOntologyAgentModel: async (id: string, modelSelection: ModelSelection): Promise<OntologyAgentModel> =>
      ontologyAgentModelSchema.parse(
        (await client.put(`/ontology/ai/agent-models/${encodeURIComponent(id)}`, { modelSelection })).data
      ),
    // The workbench's feedback records (Node under /api, not the data engine): read only, filtered and paged.
    listFeedback: async (query: FeedbackQuery) =>
      feedbackPageSchema.parse((await client.get(feedbackPath(query), "")).data),
    getVectorRebuildStatus: async () =>
      vectorRebuildStatusSchema.parse((await client.get("/businessConfig/vectorRebuildStatus")).data),
    rebuildVectors: () => client.post("/businessConfig/rebuildVectors"),
    pauseVectorRebuild: () => client.post("/businessConfig/pauseVectorRebuild"),
  };
}

export type PlatformApi = ReturnType<typeof platformApi>;
