import { z } from "zod";
import {
  DEFAULT_CHAT_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_RETRIES,
  DEFAULT_MODEL_TIMEOUT_SECONDS,
  modelApiKeyWriteSchema,
  modelConnectionNameSchema,
  modelConnectionWriteSchema,
  modelEntrySchema,
  modelNameSchema,
  modelProviderSchema,
  modelSettingsSchema,
  modelSettingsWriteSchema,
  ontologyAgentModelsSchema,
  supportsEmbeddings,
  type ModelConnection,
  type ModelConnectionWrite,
  type ModelEntry,
  type ModelProvider,
  type ModelSettingsData,
  type ModelSettingsWrite,
  type OntologyAgentModel,
} from "@ontomato/contracts/model-settings";
import {
  runtimeModelDiscoveryRequestSchema,
  runtimeModelDiscoveryResponseSchema,
  runtimeModelTestRequestSchema,
  runtimeModelTestResponseSchema,
} from "@ontomato/contracts/runtime-model-test";
import { runtimeHttpUrlSchema, runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import {
  panelFormSaveInputSchema,
  panelFormValuesSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormRequest,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import {
  ADD_MODEL_ENTRY,
  DELETE_MODEL_CONNECTION,
  DELETE_MODEL_ENTRY,
  DISCOVER_MODEL_CONNECTION,
  MODEL_CONNECTION,
  MODEL_ENTRY,
  MODEL_OPTION,
  MODEL_USAGE,
  PAUSE_VECTOR_REBUILD,
  REBUILD_VECTORS,
  TEST_MODEL_CONNECTION,
} from "@ontomato/contracts/platform-object-types";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import {
  affected,
  ownerEnvelopeSchema,
  ownerWriteFailure,
  type DataQueryOperationHost,
} from "../product-panels/data-query-operations";
import { operationHost } from "../product-panels/operation-host";
import type {
  PanelImpactInspector,
  PanelOperationActor,
  PanelOperationHost,
  PanelOperationTarget,
  PanelReadServerOperation,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * Domain model settings owner for the two platform-admin built-in panels (`model-connections` and `model-usage`).
 * Every read and write goes through Java `ModelSettingsController` and `BusinessConfigController` under the
 * `system-config` permission boundary, never directly to the LiteLLM gateway.
 */

const DOMAIN_KEY = "domain";
const SAVE_CONNECTION_OP = `${MODEL_CONNECTION}.save`;
const SAVE_MODEL_OP = `${MODEL_ENTRY}.save`;
const SAVE_USAGE_OP = `${MODEL_USAGE}.save`;

/** Per-provider field rules derived from LiteLLM's `provider_create_fields.json` and B1's connection contract. */
export const PROVIDER_SPECS: Record<ModelProvider, {
  labelKey: string;
  apiBaseRequired: boolean;
  apiBasePlaceholder: string;
}> = {
  openai: { labelKey: "panels.modelSettings.providers.openai", apiBaseRequired: false, apiBasePlaceholder: "https://api.openai.com/v1" },
  azure: { labelKey: "panels.modelSettings.providers.azure", apiBaseRequired: true, apiBasePlaceholder: "https://<resource>.openai.azure.com" },
  bigmodel: { labelKey: "panels.modelSettings.providers.bigmodel", apiBaseRequired: false, apiBasePlaceholder: "https://open.bigmodel.cn/api/paas/v4" },
  volcengine: { labelKey: "panels.modelSettings.providers.volcengine", apiBaseRequired: false, apiBasePlaceholder: "https://ark.cn-beijing.volces.com/api/v3" },
  deepseek: { labelKey: "panels.modelSettings.providers.deepseek", apiBaseRequired: false, apiBasePlaceholder: "https://api.deepseek.com" },
  dashscope: { labelKey: "panels.modelSettings.providers.dashscope", apiBaseRequired: false, apiBasePlaceholder: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  moonshot: { labelKey: "panels.modelSettings.providers.moonshot", apiBaseRequired: false, apiBasePlaceholder: "https://api.moonshot.cn/v1" },
  custom_openai: { labelKey: "panels.modelSettings.providers.custom_openai", apiBaseRequired: true, apiBasePlaceholder: "https://api.example.com/v1" },
  anthropic: { labelKey: "panels.modelSettings.providers.anthropic", apiBaseRequired: false, apiBasePlaceholder: "https://api.anthropic.com" },
  gemini: { labelKey: "panels.modelSettings.providers.gemini", apiBaseRequired: false, apiBasePlaceholder: "https://generativelanguage.googleapis.com/v1beta" },
};

const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value) => value ?? null);
const rebuildProgress = { total: z.number().int().nonnegative(), done: z.number().int().nonnegative() };
const vectorRebuildFailureSchema = z.object({
  phase: z.enum(["CLEAR", "READ", "EMBED", "SAVE"]),
  itemType: nullable(z.enum(["KNOWLEDGE", "EXAMPLE", "SPLIT_EXAMPLE", "ACTION", "METRIC_VIEW", "RESOURCE"])),
  itemId: nullable(z.string()),
  reason: z.string(),
});
export const vectorRebuildStatusSchema = z.union([
  z.object({
    configured: z.literal(false),
    state: nullable(z.null()),
    total: nullable(z.null()),
    done: nullable(z.null()),
    error: nullable(z.null()),
  }),
  z.object({ ...rebuildProgress, configured: z.literal(true), state: z.literal("FAILED"), error: vectorRebuildFailureSchema }),
  z.object({
    ...rebuildProgress,
    configured: z.literal(true),
    state: z.enum(["READY", "PENDING", "RUNNING", "PAUSING", "PAUSED", "INTERRUPTED"]),
    error: z.null().optional().transform(() => null),
  }),
]);
export type VectorRebuildStatus = z.output<typeof vectorRebuildStatusSchema>;

const headerRowSchema = z.object({ name: z.string(), value: z.string() }).strict();
const connectionFormValuesSchema = z.object({
  name: z.string(),
  provider: modelProviderSchema,
  apiBase: z.string().optional(),
  apiKey: z.string(),
  extraHeaders: z.array(headerRowSchema).optional(),
}).strict();
type ConnectionFormValues = z.infer<typeof connectionFormValuesSchema>;

const modelFormValuesSchema = z.object({
  name: z.string(),
  model: z.string(),
  type: z.enum(["chat", "embedding"]),
  contextWindow: z.number().nullable().optional(),
  maxOutputTokens: z.number().nullable().optional(),
  supportsReasoning: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  temperature: z.number().nullable().optional(),
  topP: z.number().nullable().optional(),
  dimensions: z.number().nullable().optional(),
  timeoutSeconds: z.number().nullable().optional(),
  maxRetries: z.number().nullable().optional(),
}).strict();
type ModelFormValues = z.infer<typeof modelFormValuesSchema>;

const usageFormValuesSchema = z.object({
  defaultModel: z.string(),
  embeddingModel: z.string(),
}).strict();

const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const emptyInputSchema = z.object({}).strict();
const savedKeySchema = z.object({ id: z.string().min(1) }).strict();

const connectionTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(MODEL_CONNECTION),
  primaryKey: modelConnectionNameSchema,
}).strict();
const connectionSaveTargetSchema = z.discriminatedUnion("kind", [connectionTargetSchema, panelFormTargetSchema.options[1]]);
const modelTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(MODEL_ENTRY),
  primaryKey: modelNameSchema,
}).strict();
const usageTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(MODEL_USAGE),
  primaryKey: z.literal(DOMAIN_KEY),
}).strict();

const discoverInputSchema = z.object({
  draft: panelFormValuesSchema,
  parameters: runtimeJsonObjectSchema.optional(),
}).strict();
const testInputSchema = z.object({
  draft: panelFormValuesSchema,
  parameters: z.object({
    modelName: modelNameSchema,
    prompt: z.string().optional(),
  }).strict(),
}).strict();

async function ownerJson(host: DataQueryOperationHost, path: string, init: NonNullable<Parameters<typeof fetch>[1]>) {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string; error?: string } | null)?.message
      ?? (body as { error?: string } | null)?.error
      ?? `Model settings request failed: HTTP ${response.status}`;
    const code = typeof (body as { code?: unknown } | null)?.code === "string"
      ? (body as { code: string }).code
      : "MODEL_SETTINGS_UNAVAILABLE";
    throw new HttpError(response.status, message, code);
  }
  const envelope = ownerEnvelopeSchema.parse(body);
  if (!envelope.success) {
    throw new HttpError(422, envelope.message ?? `Model settings request failed: ${path}`, String(envelope.code ?? "MODEL_SETTINGS_FAILED"));
  }
  return envelope.data;
}

async function readSettings(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<ModelSettingsData> {
  await assertPermission(credentials, ["system-config"]);
  return modelSettingsSchema.parse(await ownerJson(host, "/model-settings", { method: "GET" }));
}

async function saveSettings(
  host: DataQueryOperationHost,
  credentials: AssistantCredentials,
  write: ModelSettingsWrite,
): Promise<{ ok: true; data: ModelSettingsData } | { ok: false; outcome: Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }> }> {
  await assertPermission(credentials, ["system-config"]);
  const response = await host.request(`${DATA_QUERY_GATEWAY}/model-settings/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(write),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string; error?: string } | null)?.message
      ?? (body as { error?: string } | null)?.error
      ?? `Unable to save model settings: HTTP ${response.status}`;
    const code = typeof (body as { code?: unknown } | null)?.code === "string" ? (body as { code: string }).code : undefined;
    return {
      ok: false,
      outcome: code && response.status < 500
        ? { kind: "refusal", code, message }
        : { kind: "failure", code: code ?? "MODEL_SETTINGS_SAVE_FAILED", message },
    };
  }
  const envelope = ownerEnvelopeSchema.parse(body);
  if (!envelope.success) {
    return { ok: false, outcome: ownerWriteFailure(envelope, "MODEL_SETTINGS_SAVE_FAILED", "Unable to save model settings") };
  }
  return { ok: true, data: modelSettingsSchema.parse(envelope.data) };
}

async function readOntologyAgents(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<OntologyAgentModel[]> {
  await assertPermission(credentials, ["system-config"]);
  return ontologyAgentModelsSchema.parse(await ownerJson(host, "/ontology/ai/agent-models", { method: "GET" })).agents;
}

async function readVectorRebuild(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<VectorRebuildStatus> {
  await assertPermission(credentials, ["system-config"]);
  return vectorRebuildStatusSchema.parse(await ownerJson(host, "/businessConfig/vectorRebuildStatus", { method: "GET" }));
}

function providerLabel(provider: ModelProvider, locale?: string): string {
  return tForLocale(locale, PROVIDER_SPECS[provider].labelKey);
}

function modelsForConnection(settings: ModelSettingsData, connectionName: string): [string, ModelEntry][] {
  return Object.entries(settings.models).filter(([, entry]) => entry.connection === connectionName);
}

function toConnectionFormValues(name: string, connection: ModelConnection): ConnectionFormValues {
  return {
    name,
    provider: connection.provider,
    apiBase: connection.apiBase ?? "",
    apiKey: connection.apiKey,
    extraHeaders: Object.entries(connection.extraHeaders ?? {}).map(([headerName, value]) => ({ name: headerName, value })),
  };
}

function parseConnectionDraft(
  raw: Record<string, unknown>,
  creating: boolean,
  existingName: string | null,
  settings: ModelSettingsData,
  locale?: string,
): {
  values: ConnectionFormValues;
  connectionName: string;
  connection?: ModelConnectionWrite;
  errors: PanelFormDescription["errors"];
} {
  const providerCandidate = typeof raw.provider === "string" && modelProviderSchema.safeParse(raw.provider).success
    ? (raw.provider as ModelProvider)
    : "openai";
  const values: ConnectionFormValues = {
    name: creating ? String(raw.name ?? "") : (existingName ?? String(raw.name ?? "")),
    provider: providerCandidate,
    apiBase: typeof raw.apiBase === "string" ? raw.apiBase : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    extraHeaders: Array.isArray(raw.extraHeaders)
      ? raw.extraHeaders
        .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
        .map((row) => ({ name: String(row.name ?? ""), value: String(row.value ?? "") }))
      : [],
  };

  const errors: PanelFormDescription["errors"] = [];
  const name = values.name.trim();
  const spec = PROVIDER_SPECS[values.provider];

  if (creating) {
    if (!name) {
      errors.push({ field: "/name", code: "required", message: tForLocale(locale, "panels.modelSettings.errors.connectionNameRequired") });
    } else if (!modelConnectionNameSchema.safeParse(name).success) {
      errors.push({ field: "/name", code: "invalid_format", message: tForLocale(locale, "panels.modelSettings.errors.connectionNameInvalid") });
    } else if (Object.hasOwn(settings.connections, name)) {
      errors.push({ field: "/name", code: "already_exists", message: tForLocale(locale, "panels.modelSettings.errors.connectionNameTaken", { name }) });
    }
  }

  if (!creating && existingName && !supportsEmbeddings(values.provider)) {
    const hasEmbedding = modelsForConnection(settings, existingName).some(([, entry]) => entry.type === "embedding");
    if (hasEmbedding) {
      errors.push({ field: "/provider", code: "invalid_option", message: tForLocale(locale, "panels.modelSettings.errors.providerNoEmbeddings") });
    }
  }

  const apiBase = (values.apiBase ?? "").trim();
  if (spec.apiBaseRequired && !apiBase) {
    errors.push({ field: "/apiBase", code: "required", message: tForLocale(locale, "panels.modelSettings.errors.apiBaseRequired") });
  } else if (apiBase && !runtimeHttpUrlSchema.safeParse(apiBase).success) {
    errors.push({ field: "/apiBase", code: "invalid_format", message: tForLocale(locale, "panels.modelSettings.errors.apiBaseInvalid") });
  }

  const apiKeyCheck = modelApiKeyWriteSchema.safeParse(values.apiKey);
  if (!apiKeyCheck.success) {
    errors.push({ field: "/apiKey", code: "invalid_format", message: apiKeyCheck.error.issues[0]?.message ?? tForLocale(locale, "panels.modelSettings.errors.apiKeyRequired") });
  }

  const extraHeaders: Record<string, string> = {};
  const seenHeaders = new Set<string>();
  for (let i = 0; i < (values.extraHeaders?.length ?? 0); i++) {
    const row = values.extraHeaders![i]!;
    const headerName = row.name.trim();
    if (!headerName) {
      if (row.value.trim()) {
        errors.push({ field: `/extraHeaders/${i}/name`, code: "required", message: tForLocale(locale, "panels.modelSettings.errors.headerNameRequired") });
      }
      continue;
    }
    if (seenHeaders.has(headerName)) {
      errors.push({ field: `/extraHeaders/${i}/name`, code: "already_exists", message: tForLocale(locale, "panels.modelSettings.errors.headerDuplicate", { name: headerName }) });
      continue;
    }
    seenHeaders.add(headerName);
    extraHeaders[headerName] = row.value;
  }

  if (errors.length > 0) return { values, connectionName: name, errors };

  const candidate: ModelConnectionWrite = {
    provider: values.provider,
    ...(apiBase ? { apiBase } : {}),
    apiKey: values.apiKey,
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
  };
  const parsed = modelConnectionWriteSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const top = String(issue.path[0] ?? "apiKey");
      errors.push({ field: `/${top}`, code: "invalid_format", message: issue.message });
    }
    return { values, connectionName: name, errors };
  }
  return { values, connectionName: name, connection: parsed.data, errors: [] };
}

function buildConnectionForm(
  creating: boolean,
  existingName: string | null,
  settings: ModelSettingsData,
  inputs: Pick<PanelFormRequest, "values">,
  locale?: string,
): PanelFormDescription {
  const baseValues: ConnectionFormValues = creating
    ? { name: "", provider: "openai", apiBase: "", apiKey: "", extraHeaders: [] }
    : toConnectionFormValues(existingName!, settings.connections[existingName!]!);
  const merged = { ...baseValues, ...(inputs.values ?? {}) };
  const evaluated = parseConnectionDraft(merged, creating, existingName, settings, locale);
  const spec = PROVIDER_SPECS[evaluated.values.provider];
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  const fields: PanelFormField[] = [
    {
      path: "/name",
      label: t("panels.modelSettings.fields.connectionName"),
      help: t("panels.modelSettings.fields.connectionNameHelp"),
      required: true,
      readOnly: !creating,
      valueSchema: cachedZodToRuntimeJsonSchema(modelConnectionNameSchema),
      control: { kind: "text", placeholder: "openai-main" },
    },
    {
      path: "/provider",
      label: t("panels.modelSettings.fields.provider"),
      help: t("panels.modelSettings.fields.providerHelp"),
      required: true,
      readOnly: false,
      refreshOnChange: true,
      valueSchema: cachedZodToRuntimeJsonSchema(modelProviderSchema),
      control: {
        kind: "select",
        options: modelProviderSchema.options.map((value) => ({
          value,
          label: providerLabel(value, locale),
          description: null,
          disabled: false,
          disabledReason: null,
        })),
      },
    },
    {
      path: "/apiBase",
      label: t("panels.modelSettings.fields.apiBase"),
      help: spec.apiBaseRequired
        ? t("panels.modelSettings.fields.apiBaseHelpRequired")
        : t("panels.modelSettings.fields.apiBaseHelpOptional"),
      required: spec.apiBaseRequired,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
      control: { kind: "text", placeholder: spec.apiBasePlaceholder },
    },
    {
      path: "/apiKey",
      label: t("panels.modelSettings.fields.apiKey"),
      help: creating
        ? t("panels.modelSettings.fields.apiKeyHelpCreate")
        : t("panels.modelSettings.fields.apiKeyHelpEdit"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
      control: { kind: "text", secret: true, placeholder: "sk-..." },
    },
    {
      path: "/extraHeaders",
      label: t("panels.modelSettings.fields.extraHeaders"),
      help: t("panels.modelSettings.fields.extraHeadersHelp"),
      required: false,
      readOnly: false,
      advanced: true,
      valueSchema: cachedZodToRuntimeJsonSchema(z.array(headerRowSchema)),
      control: {
        kind: "object-array",
        itemFields: [
          {
            path: "/name",
            label: t("panels.modelSettings.fields.headerName"),
            required: true,
            readOnly: false,
            valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
            control: { kind: "text", placeholder: "X-Custom-Header" },
          },
          {
            path: "/value",
            label: t("panels.modelSettings.fields.headerValue"),
            required: false,
            readOnly: false,
            valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
            control: { kind: "text", placeholder: "value" },
          },
        ],
      },
    },
  ];

  // Report errors only once the user has started editing (or on existing invalid values).
  const errors = inputs.values ? evaluated.errors : [];
  return {
    values: evaluated.values as unknown as Record<string, RuntimeJsonValue>,
    fields,
    errors,
    save: {
      method: "POST",
      path: "/api/data-query/model-settings/save",
      bodySchema: cachedZodToRuntimeJsonSchema(connectionFormValuesSchema),
      draftOperation: creating ? "modelConnection.create" : "modelConnection.update",
    },
  };
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return typeof value === "number" ? value : Number(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return typeof value === "number" ? value : Number(value);
}

function toModelFormValues(name: string, entry: ModelEntry): ModelFormValues {
  return {
    name,
    model: entry.model,
    type: entry.type,
    contextWindow: entry.contextWindow ?? null,
    maxOutputTokens: entry.maxOutputTokens ?? null,
    supportsReasoning: entry.supportsReasoning ?? false,
    supportsVision: entry.supportsVision ?? false,
    temperature: entry.temperature ?? null,
    topP: entry.topP ?? null,
    dimensions: entry.type === "embedding" ? entry.dimensions : null,
    timeoutSeconds: entry.timeoutSeconds ?? null,
    maxRetries: entry.maxRetries ?? null,
  };
}

function parseModelDraft(
  raw: Record<string, unknown>,
  connectionName: string,
  connection: ModelConnection,
  existingModelName: string | null,
  settings: ModelSettingsData,
  locale?: string,
): {
  values: ModelFormValues;
  modelName: string;
  entry?: ModelEntry;
  errors: PanelFormDescription["errors"];
} {
  const embeddingAllowed = supportsEmbeddings(connection.provider);
  const type: "chat" | "embedding" = raw.type === "embedding" ? "embedding" : "chat";
  const values: ModelFormValues = {
    name: String(raw.name ?? ""),
    model: String(raw.model ?? ""),
    type,
    contextWindow: optionalPositiveInt(raw.contextWindow) ?? null,
    maxOutputTokens: optionalPositiveInt(raw.maxOutputTokens) ?? null,
    supportsReasoning: raw.supportsReasoning === true,
    supportsVision: raw.supportsVision === true,
    temperature: optionalNumber(raw.temperature) ?? null,
    topP: optionalNumber(raw.topP) ?? null,
    dimensions: optionalPositiveInt(raw.dimensions) ?? null,
    timeoutSeconds: optionalPositiveInt(raw.timeoutSeconds) ?? null,
    maxRetries: optionalNumber(raw.maxRetries) ?? null,
  };

  const errors: PanelFormDescription["errors"] = [];
  const name = values.name.trim();
  const upstream = values.model.trim();
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  if (!name) {
    errors.push({ field: "/name", code: "required", message: t("panels.modelSettings.errors.modelNameRequired") });
  } else if (name !== existingModelName && Object.hasOwn(settings.models, name)) {
    errors.push({ field: "/name", code: "already_exists", message: t("panels.modelSettings.errors.modelNameTaken", { name }) });
  }
  if (!upstream) {
    errors.push({ field: "/model", code: "required", message: t("panels.modelSettings.errors.upstreamModelRequired") });
  }
  if (type === "embedding" && !embeddingAllowed) {
    errors.push({ field: "/type", code: "invalid_option", message: t("panels.modelSettings.errors.providerNoEmbeddings") });
  }
  if (type === "embedding" && (values.dimensions === null || values.dimensions === undefined || !Number.isInteger(values.dimensions) || values.dimensions <= 0)) {
    errors.push({ field: "/dimensions", code: "required", message: t("panels.modelSettings.errors.dimensionsRequired") });
  }

  if (errors.length > 0) return { values, modelName: name, errors };

  const common = {
    connection: connectionName,
    model: upstream,
    ...(values.timeoutSeconds !== null && values.timeoutSeconds !== undefined ? { timeoutSeconds: values.timeoutSeconds } : {}),
    ...(values.maxRetries !== null && values.maxRetries !== undefined ? { maxRetries: values.maxRetries } : {}),
  };
  const candidate = type === "embedding"
    ? { ...common, type: "embedding" as const, dimensions: values.dimensions! }
    : {
      ...common,
      type: "chat" as const,
      ...(values.contextWindow !== null && values.contextWindow !== undefined ? { contextWindow: values.contextWindow } : {}),
      ...(values.maxOutputTokens !== null && values.maxOutputTokens !== undefined ? { maxOutputTokens: values.maxOutputTokens } : {}),
      ...(values.supportsReasoning ? { supportsReasoning: true } : {}),
      ...(values.supportsVision ? { supportsVision: true } : {}),
      ...(values.temperature !== null && values.temperature !== undefined ? { temperature: values.temperature } : {}),
      ...(values.topP !== null && values.topP !== undefined ? { topP: values.topP } : {}),
    };

  const parsed = modelEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: `/${String(issue.path[0] ?? "name")}`, code: "invalid_format", message: issue.message });
    }
    return { values, modelName: name, errors };
  }
  return { values, modelName: name, entry: parsed.data, errors: [] };
}

function buildModelForm(
  connectionName: string,
  existingModelName: string | null,
  settings: ModelSettingsData,
  inputs: Pick<PanelFormRequest, "values">,
  locale?: string,
): PanelFormDescription {
  const connection = settings.connections[connectionName];
  if (!connection) throw new HttpError(404, `Connection '${connectionName}' not found`, "NOT_FOUND");
  const creating = existingModelName === null;
  const baseValues: ModelFormValues = creating
    ? {
      name: "",
      model: "",
      type: "chat",
      contextWindow: null,
      maxOutputTokens: null,
      supportsReasoning: false,
      supportsVision: false,
      temperature: null,
      topP: null,
      dimensions: null,
      timeoutSeconds: null,
      maxRetries: null,
    }
    : toModelFormValues(existingModelName, settings.models[existingModelName]!);

  const merged = { ...baseValues, ...(inputs.values ?? {}) };
  const evaluated = parseModelDraft(merged, connectionName, connection, existingModelName, settings, locale);
  const embeddingAllowed = supportsEmbeddings(connection.provider);
  const isEmbedding = evaluated.values.type === "embedding";
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  const fields: PanelFormField[] = [
    {
      path: "/type",
      label: t("panels.modelSettings.fields.modelType"),
      required: true,
      readOnly: false,
      refreshOnChange: true,
      valueSchema: cachedZodToRuntimeJsonSchema(z.enum(["chat", "embedding"])),
      control: {
        kind: "select",
        presentation: "radio",
        options: [
          { value: "chat", label: t("panels.modelSettings.types.chat"), description: null, disabled: false, disabledReason: null },
          {
            value: "embedding",
            label: t("panels.modelSettings.types.embedding"),
            description: null,
            disabled: !embeddingAllowed,
            disabledReason: embeddingAllowed ? null : t("panels.modelSettings.errors.providerNoEmbeddings"),
          },
        ],
      },
    },
    {
      path: "/name",
      label: t("panels.modelSettings.fields.modelName"),
      help: t("panels.modelSettings.fields.modelNameHelp"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(modelNameSchema),
      control: { kind: "text", placeholder: "gpt-4o" },
    },
    {
      path: "/model",
      label: t("panels.modelSettings.fields.upstreamModel"),
      help: t("panels.modelSettings.fields.upstreamModelHelp"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1)),
      control: { kind: "text", placeholder: "gpt-4o" },
    },
    ...(isEmbedding
      ? [{
        path: "/dimensions",
        label: t("panels.modelSettings.fields.dimensions"),
        help: t("panels.modelSettings.fields.dimensionsHelp"),
        required: true,
        readOnly: false,
        valueSchema: cachedZodToRuntimeJsonSchema(z.number().int().positive()),
        control: { kind: "number" as const },
      }]
      : [
        {
          path: "/contextWindow",
          label: t("panels.modelSettings.fields.contextWindow"),
          help: t("panels.modelSettings.fields.contextWindowHelp", { defaultWindow: DEFAULT_CHAT_CONTEXT_WINDOW.toLocaleString() }),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.number().int().positive().nullable()),
          control: { kind: "number" as const },
        },
        {
          path: "/maxOutputTokens",
          label: t("panels.modelSettings.fields.maxOutputTokens"),
          help: t("panels.modelSettings.fields.maxOutputTokensHelp"),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.number().int().positive().nullable()),
          control: { kind: "number" as const },
        },
        {
          path: "/supportsReasoning",
          label: t("panels.modelSettings.fields.supportsReasoning"),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.boolean()),
          control: { kind: "switch" as const },
        },
        {
          path: "/supportsVision",
          label: t("panels.modelSettings.fields.supportsVision"),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.boolean()),
          control: { kind: "switch" as const },
        },
        {
          path: "/temperature",
          label: t("panels.modelSettings.fields.temperature"),
          help: t("panels.modelSettings.fields.temperatureHelp"),
          required: false,
          readOnly: false,
          advanced: true as const,
          valueSchema: cachedZodToRuntimeJsonSchema(z.number().min(0).max(2).nullable()),
          control: { kind: "number" as const },
        },
        {
          path: "/topP",
          label: t("panels.modelSettings.fields.topP"),
          help: t("panels.modelSettings.fields.topPHelp"),
          required: false,
          readOnly: false,
          advanced: true as const,
          valueSchema: cachedZodToRuntimeJsonSchema(z.number().min(0).max(1).nullable()),
          control: { kind: "number" as const },
        },
      ]),
    {
      path: "/timeoutSeconds",
      label: t("panels.modelSettings.fields.timeoutSeconds"),
      help: t("panels.modelSettings.fields.timeoutSecondsHelp", { seconds: DEFAULT_MODEL_TIMEOUT_SECONDS }),
      required: false,
      readOnly: false,
      advanced: true as const,
      valueSchema: cachedZodToRuntimeJsonSchema(z.number().int().positive().nullable()),
      control: { kind: "number" },
    },
    {
      path: "/maxRetries",
      label: t("panels.modelSettings.fields.maxRetries"),
      help: t("panels.modelSettings.fields.maxRetriesHelp", { count: DEFAULT_MODEL_MAX_RETRIES }),
      required: false,
      readOnly: false,
      advanced: true as const,
      valueSchema: cachedZodToRuntimeJsonSchema(z.number().int().nonnegative().nullable()),
      control: { kind: "number" },
    },
  ];

  const errors = inputs.values ? evaluated.errors : [];
  return {
    values: evaluated.values as unknown as Record<string, RuntimeJsonValue>,
    fields,
    errors,
    save: {
      method: "POST",
      path: "/api/data-query/model-settings/save",
      bodySchema: cachedZodToRuntimeJsonSchema(modelFormValuesSchema),
      draftOperation: creating ? "modelEntry.create" : "modelEntry.update",
    },
  };
}

function modelSpecsSummary(entry: ModelEntry, locale?: string): string {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  if (entry.type === "embedding") {
    return t("panels.modelSettings.specs.dimensions", { n: entry.dimensions });
  }
  const parts = [
    t("panels.modelSettings.specs.context", { n: (entry.contextWindow ?? DEFAULT_CHAT_CONTEXT_WINDOW).toLocaleString() }),
  ];
  if (entry.supportsReasoning) parts.push(t("panels.modelSettings.fields.supportsReasoning"));
  if (entry.supportsVision) parts.push(t("panels.modelSettings.fields.supportsVision"));
  return parts.join(" · ");
}

function vectorRebuildMessage(status: VectorRebuildStatus, locale?: string): string {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  if (!status.configured) return t("panels.modelSettings.vectorRebuild.unconfigured");
  const progress = { done: status.done, total: status.total };
  if (status.state === "FAILED") {
    const { phase, itemType, itemId, reason } = status.error;
    const type = itemType === null ? "" : t(`panels.modelSettings.vectorRebuild.types.${itemType}`);
    const step = t(`panels.modelSettings.vectorRebuild.steps.${phase}`, { type, id: itemId ?? "" });
    return t("panels.modelSettings.vectorRebuild.failed", { ...progress, step, reason });
  }
  return t(`panels.modelSettings.vectorRebuild.messages.${status.state}`, progress);
}

function vectorRebuildTone(status: VectorRebuildStatus): "info" | "warning" | "danger" | "success" {
  if (!status.configured) return "info";
  if (status.state === "READY") return "success";
  if (status.state === "FAILED") return "danger";
  if (status.state === "RUNNING" || status.state === "PAUSING") return "info";
  return "warning";
}

function connectionRecord(name: string, connection: ModelConnection, settings: ModelSettingsData, locale?: string): PanelRecord {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  const count = modelsForConnection(settings, name).length;
  const providerText = providerLabel(connection.provider, locale);
  return {
    primaryKey: name,
    label: name,
    subtitle: `${providerText} · ${t("panels.modelSettings.modelCount", { count })}`,
    fields: {
      provider: connection.provider,
      providerLabel: providerText,
      apiBase: connection.apiBase ?? "",
      modelCount: String(count),
    },
    fieldLabels: {
      providerLabel: t("panels.modelSettings.fields.provider"),
      apiBase: t("panels.modelSettings.fields.apiBase"),
      modelCount: t("panels.modelSettings.fields.models"),
    },
    outputs: {
      provider: connection.provider,
      supportsEmbeddings: supportsEmbeddings(connection.provider),
      modelCount: count,
    },
  };
}

export function createModelConnectionReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const locale = actor.credentials.locale;
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  return {
    async list(): Promise<PanelRecord[]> {
      const settings = await readSettings(host, actor.credentials);
      return Object.entries(settings.connections).map(([name, connection]) =>
        connectionRecord(name, connection, settings, locale));
    },

    async record(primaryKey: string): Promise<PanelRecord> {
      const settings = await readSettings(host, actor.credentials);
      const connection = settings.connections[primaryKey];
      if (!connection) throw new HttpError(404, `Connection '${primaryKey}' not found`, "NOT_FOUND");
      return connectionRecord(primaryKey, connection, settings, locale);
    },

    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      const settings = await readSettings(host, actor.credentials);
      if (!settings.connections[primaryKey]) throw new HttpError(404, `Connection '${primaryKey}' not found`, "NOT_FOUND");
      return buildConnectionForm(false, primaryKey, settings, inputs, locale);
    },

    async createForm(inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      const settings = await readSettings(host, actor.credentials);
      return buildConnectionForm(true, null, settings, inputs, locale);
    },

    async createModelForm(primaryKey: string, inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      const settings = await readSettings(host, actor.credentials);
      return buildModelForm(primaryKey, null, settings, inputs, locale);
    },

    async models(primaryKey: string): Promise<PanelRecord[]> {
      const settings = await readSettings(host, actor.credentials);
      if (!settings.connections[primaryKey]) throw new HttpError(404, `Connection '${primaryKey}' not found`, "NOT_FOUND");
      return modelsForConnection(settings, primaryKey).map(([modelName, entry]): PanelRecord => {
        const defaultTag = modelName === settings.defaultModel
          ? t("panels.modelSettings.tags.defaultChat")
          : modelName === settings.embeddingModel
            ? t("panels.modelSettings.tags.defaultEmbedding")
            : "";
        return {
          primaryKey: modelName,
          className: MODEL_ENTRY,
          label: modelName,
          subtitle: entry.model,
          fields: {
            upstreamModel: entry.model,
            type: entry.type,
            typeLabel: t(`panels.modelSettings.types.${entry.type}`),
            specs: modelSpecsSummary(entry, locale),
            defaultTag,
          },
          fieldLabels: {
            upstreamModel: t("panels.modelSettings.fields.upstreamModel"),
            typeLabel: t("panels.modelSettings.fields.modelType"),
            specs: t("panels.modelSettings.fields.specs"),
            defaultTag: t("panels.modelSettings.fields.defaultRole"),
          },
        };
      });
    },

    async usages(primaryKey: string): Promise<PanelRecord[]> {
      const [settings, agents] = await Promise.all([
        readSettings(host, actor.credentials),
        readOntologyAgents(host, actor.credentials),
      ]);
      if (!settings.connections[primaryKey]) throw new HttpError(404, `Connection '${primaryKey}' not found`, "NOT_FOUND");
      const names = new Set(modelsForConnection(settings, primaryKey).map(([modelName]) => modelName));
      const rows: PanelRecord[] = [];
      const fieldLabels = {
        where: t("panels.modelSettings.usages.where"),
        model: t("panels.modelSettings.usages.model"),
      };
      if (settings.defaultModel && names.has(settings.defaultModel)) {
        rows.push({
          primaryKey: `default:${settings.defaultModel}`,
          label: t("panels.modelSettings.fields.defaultModel"),
          fields: { where: t("panels.modelSettings.fields.defaultModel"), model: settings.defaultModel },
          fieldLabels,
        });
      }
      if (settings.embeddingModel && names.has(settings.embeddingModel)) {
        rows.push({
          primaryKey: `embedding:${settings.embeddingModel}`,
          label: t("panels.modelSettings.fields.embeddingModel"),
          fields: { where: t("panels.modelSettings.fields.embeddingModel"), model: settings.embeddingModel },
          fieldLabels,
        });
      }
      for (const agent of agents) {
        const ref = agent.modelSelection.modelId;
        if (ref && names.has(ref)) {
          rows.push({
            primaryKey: `agent:${agent.id}`,
            label: agent.name,
            fields: { where: agent.name, model: ref },
            fieldLabels,
          });
        }
      }
      return rows;
    },
  };
}

export function createModelEntryReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const locale = actor.credentials.locale;
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  return {
    async record(primaryKey: string): Promise<PanelRecord> {
      const settings = await readSettings(host, actor.credentials);
      const entry = settings.models[primaryKey];
      if (!entry) throw new HttpError(404, `Model '${primaryKey}' not found`, "NOT_FOUND");
      return {
        primaryKey,
        label: primaryKey,
        subtitle: entry.model,
        fields: {
          connection: entry.connection,
          upstreamModel: entry.model,
          typeLabel: t(`panels.modelSettings.types.${entry.type}`),
          specs: modelSpecsSummary(entry, locale),
        },
        fieldLabels: {
          connection: t("panels.modelSettings.fields.connectionName"),
          upstreamModel: t("panels.modelSettings.fields.upstreamModel"),
          typeLabel: t("panels.modelSettings.fields.modelType"),
          specs: t("panels.modelSettings.fields.specs"),
        },
      };
    },

    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      const settings = await readSettings(host, actor.credentials);
      const entry = settings.models[primaryKey];
      if (!entry) throw new HttpError(404, `Model '${primaryKey}' not found`, "NOT_FOUND");
      return buildModelForm(entry.connection, primaryKey, settings, inputs, locale);
    },
  };
}

function requireDomainKey(primaryKey: string) {
  if (primaryKey !== DOMAIN_KEY) throw new HttpError(404, "Domain model usage not found", "NOT_FOUND");
}

export function createModelUsageReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const locale = actor.credentials.locale;
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  return {
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      requireDomainKey(primaryKey);
      const settings = await readSettings(host, actor.credentials);
      const chatModels = Object.entries(settings.models).filter(([, entry]) => entry.type === "chat");
      const embeddingModels = Object.entries(settings.models).filter(([, entry]) => entry.type === "embedding");

      const defaultModel = typeof inputs.values?.defaultModel === "string"
        ? inputs.values.defaultModel
        : (settings.defaultModel ?? "");
      const embeddingModel = typeof inputs.values?.embeddingModel === "string"
        ? inputs.values.embeddingModel
        : (settings.embeddingModel ?? "");

      const chatOptions: PanelFormOption[] = [
        { value: "", label: t("panels.modelSettings.usage.noDefaultChat"), description: null, disabled: false, disabledReason: null },
        ...chatModels.map(([name, entry]) => ({
          value: name,
          label: name,
          description: `${entry.connection} · ${entry.model}`,
          disabled: false,
          disabledReason: null,
        })),
      ];
      const chatMissing = Boolean(defaultModel) && !chatModels.some(([name]) => name === defaultModel);
      if (chatMissing) {
        chatOptions.push({
          value: defaultModel,
          label: t("panels.modelSettings.usage.unavailable", { name: defaultModel }),
          description: null,
          disabled: true,
          disabledReason: t("panels.modelSettings.usage.unavailableReason"),
        });
      }

      const embeddingOptions: PanelFormOption[] = [
        { value: "", label: t("panels.modelSettings.usage.noEmbedding"), description: null, disabled: false, disabledReason: null },
        ...embeddingModels.map(([name, entry]) => ({
          value: name,
          label: `${name} · ${t("panels.modelSettings.specs.dimensions", { n: entry.type === "embedding" ? entry.dimensions : 0 })}`,
          description: `${entry.connection} · ${entry.model}`,
          disabled: false,
          disabledReason: null,
        })),
      ];
      const embeddingMissing = Boolean(embeddingModel) && !embeddingModels.some(([name]) => name === embeddingModel);
      if (embeddingMissing) {
        embeddingOptions.push({
          value: embeddingModel,
          label: t("panels.modelSettings.usage.unavailable", { name: embeddingModel }),
          description: null,
          disabled: true,
          disabledReason: t("panels.modelSettings.usage.unavailableReason"),
        });
      }

      const errors: PanelFormDescription["errors"] = [];
      if (inputs.values && chatMissing) {
        errors.push({ field: "/defaultModel", code: "invalid_option", message: t("panels.modelSettings.errors.defaultChatInvalid") });
      }
      if (inputs.values && embeddingMissing) {
        errors.push({ field: "/embeddingModel", code: "invalid_option", message: t("panels.modelSettings.errors.embeddingInvalid") });
      }

      const fields: PanelFormField[] = [
        {
          path: "/defaultModel",
          label: t("panels.modelSettings.fields.defaultModel"),
          help: t("panels.modelSettings.fields.defaultModelHelp"),
          required: false,
          readOnly: false,
          ...(chatMissing
            ? { warning: t("panels.modelSettings.usage.missingWarning", { name: defaultModel }) }
            : !defaultModel
              ? { warning: t("panels.modelSettings.usage.defaultChatUnset") }
              : {}),
          valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
          control: { kind: "select", options: chatOptions },
        },
        {
          path: "/embeddingModel",
          label: t("panels.modelSettings.fields.embeddingModel"),
          help: t("panels.modelSettings.fields.embeddingModelHelp"),
          required: false,
          readOnly: false,
          ...(embeddingMissing ? { warning: t("panels.modelSettings.usage.missingWarning", { name: embeddingModel }) } : {}),
          valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
          control: { kind: "select", options: embeddingOptions },
        },
      ];

      return {
        values: { defaultModel, embeddingModel },
        fields,
        errors,
        save: {
          method: "POST",
          path: "/api/data-query/model-settings/save",
          bodySchema: cachedZodToRuntimeJsonSchema(usageFormValuesSchema),
          draftOperation: "modelUsage.update",
        },
      };
    },

    async vectorRebuild(primaryKey: string): Promise<PanelRecord> {
      requireDomainKey(primaryKey);
      const status = await readVectorRebuild(host, actor.credentials);
      const state = status.state ?? "";
      const stateLabel = status.configured && status.state
        ? t(`panels.modelSettings.vectorRebuild.states.${status.state}`)
        : t("panels.modelSettings.vectorRebuild.states.UNCONFIGURED");
      const progress = status.configured ? `${status.done} / ${status.total}` : "-";
      const message = vectorRebuildMessage(status, locale);
      const tone = vectorRebuildTone(status);
      const alive = status.state === "RUNNING" || status.state === "PAUSING";
      const canRebuild = status.state === "PENDING" || status.state === "READY";
      const canResume = status.state === "PAUSED" || status.state === "FAILED" || status.state === "INTERRUPTED";
      const canPause = status.state === "RUNNING";

      return {
        primaryKey: DOMAIN_KEY,
        label: stateLabel,
        subtitle: message,
        fields: { stateLabel, progress, message, tone },
        fieldLabels: {
          stateLabel: t("panels.modelSettings.vectorRebuild.state"),
          progress: t("panels.modelSettings.vectorRebuild.progress"),
          message: t("panels.modelSettings.vectorRebuild.detail"),
        },
        outputs: { configured: status.configured, state, tone, alive, canRebuild, canResume, canPause },
      };
    },

    async agentUsages(primaryKey: string): Promise<PanelRecord[]> {
      requireDomainKey(primaryKey);
      const [settings, agents] = await Promise.all([
        readSettings(host, actor.credentials),
        readOntologyAgents(host, actor.credentials),
      ]);
      const fieldLabels = {
        agent: t("panels.modelSettings.usages.agent"),
        model: t("panels.modelSettings.usages.model"),
        status: t("panels.modelSettings.usages.status"),
      };
      return agents.map((agent): PanelRecord => {
        const ref = agent.modelSelection.modelId;
        const missing = ref !== null && !Object.hasOwn(settings.models, ref);
        const modelText = ref === null
          ? (settings.defaultModel
            ? t("panels.modelSettings.usage.followDefaultNamed", { name: settings.defaultModel })
            : t("panels.modelSettings.usage.followDefault"))
          : ref;
        const status = missing
          ? t("panels.modelSettings.usage.statusMissing")
          : ref === null && !settings.defaultModel
            ? t("panels.modelSettings.usage.statusUnset")
            : t("panels.modelSettings.usage.statusOk");
        return {
          primaryKey: agent.id,
          label: agent.name,
          fields: { agent: agent.name, model: modelText, status },
          fieldLabels,
        };
      });
    },
  };
}

function buildConnectionDraftFromForm(
  draft: Record<string, unknown>,
  locale?: string,
): { connectionName: string; connection: ModelConnectionWrite } {
  const connectionName = String(draft.name ?? "").trim();
  const provider = modelProviderSchema.parse(draft.provider);
  const apiBase = typeof draft.apiBase === "string" ? draft.apiBase.trim() : "";
  const apiKey = typeof draft.apiKey === "string" ? draft.apiKey : "";
  const extraHeaders: Record<string, string> = {};
  if (Array.isArray(draft.extraHeaders)) {
    for (const row of draft.extraHeaders) {
      if (!row || typeof row !== "object") continue;
      const key = String((row as Record<string, unknown>).name ?? "").trim();
      if (!key) continue;
      extraHeaders[key] = String((row as Record<string, unknown>).value ?? "");
    }
  }
  const spec = PROVIDER_SPECS[provider];
  if (spec.apiBaseRequired && !apiBase) {
    throw new HttpError(400, tForLocale(locale, "panels.modelSettings.errors.apiBaseRequired"), "INVALID_REQUEST");
  }
  const parsed = runtimeModelDiscoveryRequestSchema.safeParse({
    connectionName,
    connection: {
      provider,
      ...(apiBase ? { apiBase } : {}),
      apiKey,
      ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
    },
  });
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid connection draft", "INVALID_REQUEST");
  }
  return { connectionName: parsed.data.connectionName, connection: parsed.data.connection };
}

const deleteConnectionImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_MODEL_CONNECTION}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const [settings, agents] = await Promise.all([
      readSettings(host, host.executor.credentials),
      readOntologyAgents(host, host.executor.credentials),
    ]);
    const removedModels = modelsForConnection(settings, target.primaryKey).map(([name]) => name);
    const removedSet = new Set(removedModels);
    const notes: string[] = [];
    if (removedModels.length > 0) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.connectionModels", { count: removedModels.length }));
    }
    if (settings.defaultModel && removedSet.has(settings.defaultModel)) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsDefaultChat", { name: settings.defaultModel }));
    }
    if (settings.embeddingModel && removedSet.has(settings.embeddingModel)) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsEmbedding", { name: settings.embeddingModel }));
    }
    const affectedAgents = agents.filter((agent) => agent.modelSelection.modelId && removedSet.has(agent.modelSelection.modelId));
    if (affectedAgents.length > 0) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.affectedAgents", { names: affectedAgents.map((a) => a.name).join(", ") }));
    }
    const base = tForLocale(host.locale, "panels.modelSettings.impact.deleteConnection", { name: target.primaryKey });
    return {
      summary: notes.length > 0 ? `${base} ${notes.join(" ")}` : base,
      objects: [{ target: { objectType: MODEL_CONNECTION, primaryKey: target.primaryKey }, label: target.primaryKey }],
      total: 1,
    };
  },
};

const deleteModelImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_MODEL_ENTRY}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const [settings, agents] = await Promise.all([
      readSettings(host, host.executor.credentials),
      readOntologyAgents(host, host.executor.credentials),
    ]);
    const notes: string[] = [];
    if (settings.defaultModel === target.primaryKey) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsDefaultChat", { name: target.primaryKey }));
    }
    if (settings.embeddingModel === target.primaryKey) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsEmbedding", { name: target.primaryKey }));
    }
    const affectedAgents = agents.filter((agent) => agent.modelSelection.modelId === target.primaryKey);
    if (affectedAgents.length > 0) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.affectedAgents", { names: affectedAgents.map((a) => a.name).join(", ") }));
    }
    const base = tForLocale(host.locale, "panels.modelSettings.impact.deleteModel", { name: target.primaryKey });
    return {
      summary: notes.length > 0 ? `${base} ${notes.join(" ")}` : base,
      objects: [{ target: { objectType: MODEL_ENTRY, primaryKey: target.primaryKey }, label: target.primaryKey }],
      total: 1,
    };
  },
};

const saveModelImpact: PanelImpactInspector = {
  handlerRef: `${SAVE_MODEL_OP}.inspect-impact`,
  async inspect(host, calls) {
    const call = calls[0]!;
    if (!call.target || call.target.kind !== "object") return null;
    const currentName = call.target.primaryKey;
    const [settings, agents] = await Promise.all([
      readSettings(host, host.executor.credentials),
      readOntologyAgents(host, host.executor.credentials),
    ]);
    const existing = settings.models[currentName];
    if (!existing) return null;
    const { values } = saveInputSchema.parse(call.input);
    const nextName = typeof values.name === "string" ? values.name.trim() : currentName;
    const nextType = values.type === "embedding" ? "embedding" : values.type === "chat" ? "chat" : existing.type;
    const nextDimensions = optionalPositiveInt(values.dimensions);
    const notes: string[] = [];
    if (nextType !== existing.type) {
      if (settings.defaultModel === currentName && nextType !== "chat") {
        notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsDefaultChat", { name: currentName }));
      }
      if (settings.embeddingModel === currentName && nextType !== "embedding") {
        notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsEmbedding", { name: currentName }));
      }
    }
    if (
      existing.type === "embedding" &&
      nextType === "embedding" &&
      settings.embeddingModel === currentName &&
      nextDimensions !== undefined &&
      nextDimensions !== existing.dimensions
    ) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.embeddingDimensionsChanged"));
    }
    if (nextName && nextName !== currentName) {
      const affectedAgents = agents.filter((agent) => agent.modelSelection.modelId === currentName);
      if (affectedAgents.length > 0) {
        notes.push(tForLocale(host.locale, "panels.modelSettings.impact.renameAffectsAgents", {
          from: currentName,
          to: nextName,
          names: affectedAgents.map((a) => a.name).join(", "),
        }));
      }
    }
    if (notes.length === 0) return null;
    return {
      summary: notes.join(" "),
      objects: [{ target: { objectType: MODEL_ENTRY, primaryKey: currentName }, label: currentName }],
      total: 1,
    };
  },
};

const saveUsageImpact: PanelImpactInspector = {
  handlerRef: `${SAVE_USAGE_OP}.inspect-impact`,
  async inspect(host, calls) {
    const settings = await readSettings(host, host.executor.credentials);
    const { values } = saveInputSchema.parse(calls[0]!.input);
    const nextDefault = typeof values.defaultModel === "string"
      ? (values.defaultModel.trim() || null)
      : settings.defaultModel;
    const nextEmbedding = typeof values.embeddingModel === "string"
      ? (values.embeddingModel.trim() || null)
      : settings.embeddingModel;
    const notes: string[] = [];
    if (nextDefault !== settings.defaultModel) {
      notes.push(
        nextDefault === null
          ? tForLocale(host.locale, "panels.modelSettings.impact.clearDefaultChat")
          : tForLocale(host.locale, "panels.modelSettings.impact.changeDefaultChat", { name: nextDefault }),
      );
    }
    if (nextEmbedding !== settings.embeddingModel) {
      notes.push(
        nextEmbedding === null
          ? tForLocale(host.locale, "panels.modelSettings.impact.embeddingClear")
          : settings.embeddingModel === null
            ? tForLocale(host.locale, "panels.modelSettings.impact.embeddingSet", { name: nextEmbedding })
            : tForLocale(host.locale, "panels.modelSettings.impact.embeddingChange", { name: nextEmbedding }),
      );
    }
    if (notes.length === 0) return null;
    return {
      summary: notes.join(" "),
      objects: [{ target: { objectType: MODEL_USAGE, primaryKey: DOMAIN_KEY }, label: tForLocale(host.locale, "panels.modelSettings.usageTitle") }],
      total: 1,
    };
  },
};

const rebuildVectorsImpact: PanelImpactInspector = {
  handlerRef: `${REBUILD_VECTORS}.inspect-impact`,
  async inspect(host) {
    const status = await readVectorRebuild(host, host.executor.credentials);
    if (status.state !== "PENDING") return null;
    return {
      summary: tForLocale(host.locale, "panels.modelSettings.impact.rebuildVectors"),
      objects: [{ target: { objectType: MODEL_USAGE, primaryKey: DOMAIN_KEY }, label: tForLocale(host.locale, "panels.modelSettings.usageTitle") }],
      total: 1,
    };
  },
};

function settingsWriteFromData(settings: ModelSettingsData): ModelSettingsWrite {
  return {
    connections: { ...settings.connections },
    models: { ...settings.models },
    defaultModel: settings.defaultModel,
    embeddingModel: settings.embeddingModel,
  };
}

export const modelSettingsServerOperations: readonly PanelServerOperation[] = [
  {
    handlerRef: SAVE_CONNECTION_OP,
    labelKey: "panels.modelSettings.operations.saveConnection",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: MODEL_CONNECTION },
    targetType: MODEL_CONNECTION,
    targetSchema: connectionSaveTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: savedKeySchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "modelConnection.create" : "modelConnection.update",
    draftInput: (input) => saveInputSchema.parse(input).values,
    formInstructions: "Provide the connection name, LiteLLM provider prefix, API base URL (required for azure and custom_openai), API key, and optional extra headers.",
    create: {
      draftValues: (values) => runtimeJsonObjectSchema.parse(values),
      createdObject: (data) => ({ objectType: MODEL_CONNECTION, primaryKey: savedKeySchema.parse(data).id }),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const settings = await readSettings(host, host.executor.credentials);
      const { values } = saveInputSchema.parse(input);
      const creating = target.kind === "draft";
      const existingName = target.kind === "object" ? target.primaryKey : null;
      if (!creating && !settings.connections[existingName!]) {
        return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${existingName}' not found` };
      }
      const base = creating ? {} : toConnectionFormValues(existingName!, settings.connections[existingName!]!);
      const evaluated = parseConnectionDraft({ ...base, ...values }, creating, existingName, settings, host.locale);
      if (evaluated.errors.length > 0 || !evaluated.connection) {
        return {
          kind: "refusal",
          code: "INVALID_CONNECTION",
          message: evaluated.errors[0]?.message ?? "Invalid connection",
          errors: evaluated.errors,
        };
      }
      const next = settingsWriteFromData(settings);
      next.connections[evaluated.connectionName] = evaluated.connection;
      const checked = modelSettingsWriteSchema.safeParse(next);
      if (!checked.success) {
        return { kind: "refusal", code: "INVALID_MODEL_SETTINGS", message: checked.error.issues[0]?.message ?? "Invalid model settings" };
      }
      const saved = await saveSettings(host, host.executor.credentials, checked.data);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: { id: evaluated.connectionName },
        affected: affected(MODEL_CONNECTION, evaluated.connectionName, [MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, MODEL_OPTION]),
      };
    },
  },
  {
    handlerRef: DELETE_MODEL_CONNECTION,
    labelKey: "panels.modelSettings.operations.deleteConnection",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: DELETE_MODEL_CONNECTION },
    targetType: MODEL_CONNECTION,
    targetSchema: connectionTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyInputSchema,
    targetInput: "connection",
    inspectImpact: deleteConnectionImpact,
    targetLabel: async (_host, target) => target.primaryKey,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Deleting a connection requires a selected connection");
      const settings = await readSettings(host, host.executor.credentials);
      if (!settings.connections[target.primaryKey]) {
        return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${target.primaryKey}' not found` };
      }
      const next = settingsWriteFromData(settings);
      delete next.connections[target.primaryKey];
      const removed = new Set<string>();
      for (const [modelName, entry] of Object.entries(next.models)) {
        if (entry.connection === target.primaryKey) {
          delete next.models[modelName];
          removed.add(modelName);
        }
      }
      if (next.defaultModel && removed.has(next.defaultModel)) next.defaultModel = null;
      if (next.embeddingModel && removed.has(next.embeddingModel)) next.embeddingModel = null;
      const saved = await saveSettings(host, host.executor.credentials, next);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: {},
        affected: {
          ...affected(MODEL_CONNECTION, target.primaryKey, [MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, MODEL_OPTION]),
          removed: [{ objectType: MODEL_CONNECTION, primaryKey: target.primaryKey }],
        },
      };
    },
  },
  {
    handlerRef: DISCOVER_MODEL_CONNECTION,
    labelKey: "panels.modelSettings.operations.discoverModels",
    kind: "action",
    effect: "read",
    batch: false,
    binding: { kind: "PlatformOperation", id: DISCOVER_MODEL_CONNECTION },
    target: { source: "none" },
    targetSchema: z.undefined(),
    inputSchema: discoverInputSchema,
    resultSchema: z.object({ kind: z.literal("json"), value: runtimeModelDiscoveryResponseSchema }).strict(),
    async execute(host: PanelOperationHost, call) {
      await assertPermission(host.executor.credentials, ["system-config"]);
      const { draft } = discoverInputSchema.parse(call.input);
      const request = buildConnectionDraftFromForm(draft, host.locale);
      const data = await ownerJson(host, "/model-settings/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      return { kind: "json", value: runtimeModelDiscoveryResponseSchema.parse(data) };
    },
  } satisfies PanelReadServerOperation,
  {
    handlerRef: TEST_MODEL_CONNECTION,
    labelKey: "panels.modelSettings.operations.testModel",
    kind: "action",
    effect: "read",
    batch: false,
    binding: { kind: "PlatformOperation", id: TEST_MODEL_CONNECTION },
    target: { source: "none" },
    targetSchema: z.undefined(),
    inputSchema: testInputSchema,
    resultSchema: z.object({ kind: z.literal("json"), value: runtimeModelTestResponseSchema }).strict(),
    async execute(host: PanelOperationHost, call) {
      const settings = await readSettings(host, host.executor.credentials);
      const { draft, parameters } = testInputSchema.parse(call.input);
      const { connectionName, connection } = buildConnectionDraftFromForm(draft, host.locale);
      const existing = settings.models[parameters.modelName];
      if (!existing) throw new HttpError(404, `Model '${parameters.modelName}' not found`, "NOT_FOUND");
      const request = runtimeModelTestRequestSchema.parse({
        connectionName,
        connection,
        model: { ...existing, connection: connectionName },
        ...(parameters.prompt ? { prompt: parameters.prompt } : {}),
      });
      const data = await ownerJson(host, "/model-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      return { kind: "json", value: runtimeModelTestResponseSchema.parse(data) };
    },
  } satisfies PanelReadServerOperation,
  {
    handlerRef: ADD_MODEL_ENTRY,
    labelKey: "panels.modelSettings.operations.addModel",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: ADD_MODEL_ENTRY },
    targetType: MODEL_CONNECTION,
    targetSchema: connectionTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: savedKeySchema,
    draftOperation: () => "modelEntry.create",
    draftInput: (input) => saveInputSchema.parse(input).values,
    formInstructions: "Provide model type (chat or embedding), unique public model name, upstream model ID, and type-specific parameters (contextWindow/maxOutputTokens/supportsVision/supportsReasoning for chat; dimensions for embedding).",
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Adding a model requires a selected connection");
      const settings = await readSettings(host, host.executor.credentials);
      const connection = settings.connections[target.primaryKey];
      if (!connection) return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${target.primaryKey}' not found` };
      const { values } = saveInputSchema.parse(input);
      const evaluated = parseModelDraft(values, target.primaryKey, connection, null, settings, host.locale);
      if (evaluated.errors.length > 0 || !evaluated.entry) {
        return {
          kind: "refusal",
          code: "INVALID_MODEL",
          message: evaluated.errors[0]?.message ?? "Invalid model",
          errors: evaluated.errors,
        };
      }
      const next = settingsWriteFromData(settings);
      next.models[evaluated.modelName] = evaluated.entry;
      const checked = modelSettingsWriteSchema.safeParse(next);
      if (!checked.success) {
        return { kind: "refusal", code: "INVALID_MODEL_SETTINGS", message: checked.error.issues[0]?.message ?? "Invalid model settings" };
      }
      const saved = await saveSettings(host, host.executor.credentials, checked.data);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: { id: evaluated.modelName },
        affected: affected(MODEL_CONNECTION, target.primaryKey, [MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, MODEL_OPTION]),
      };
    },
  },
  {
    handlerRef: SAVE_MODEL_OP,
    labelKey: "panels.modelSettings.operations.saveModel",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: MODEL_ENTRY },
    targetType: MODEL_ENTRY,
    targetSchema: modelTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: savedKeySchema,
    draftOperation: () => "modelEntry.update",
    draftInput: (input) => saveInputSchema.parse(input).values,
    formInstructions: "Update the model's public name, upstream model ID, type, and call parameters.",
    inspectImpact: saveModelImpact,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Updating a model requires a selected model");
      const settings = await readSettings(host, host.executor.credentials);
      const existing = settings.models[target.primaryKey];
      if (!existing) return { kind: "refusal", code: "NOT_FOUND", message: `Model '${target.primaryKey}' not found` };
      const connection = settings.connections[existing.connection];
      if (!connection) return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${existing.connection}' not found` };
      const { values } = saveInputSchema.parse(input);
      const merged = { ...toModelFormValues(target.primaryKey, existing), ...values };
      const evaluated = parseModelDraft(merged, existing.connection, connection, target.primaryKey, settings, host.locale);
      if (evaluated.errors.length > 0 || !evaluated.entry) {
        return {
          kind: "refusal",
          code: "INVALID_MODEL",
          message: evaluated.errors[0]?.message ?? "Invalid model",
          errors: evaluated.errors,
        };
      }
      const next = settingsWriteFromData(settings);
      if (evaluated.modelName !== target.primaryKey) {
        delete next.models[target.primaryKey];
        if (next.defaultModel === target.primaryKey) next.defaultModel = evaluated.modelName;
        if (next.embeddingModel === target.primaryKey) next.embeddingModel = evaluated.modelName;
      }
      next.models[evaluated.modelName] = evaluated.entry;
      if (next.defaultModel && next.models[next.defaultModel]?.type !== "chat") next.defaultModel = null;
      if (next.embeddingModel && next.models[next.embeddingModel]?.type !== "embedding") next.embeddingModel = null;

      const checked = modelSettingsWriteSchema.safeParse(next);
      if (!checked.success) {
        return { kind: "refusal", code: "INVALID_MODEL_SETTINGS", message: checked.error.issues[0]?.message ?? "Invalid model settings" };
      }
      const saved = await saveSettings(host, host.executor.credentials, checked.data);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: { id: evaluated.modelName },
        affected: affected(MODEL_ENTRY, evaluated.modelName, [MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, MODEL_OPTION]),
      };
    },
  },
  {
    handlerRef: DELETE_MODEL_ENTRY,
    labelKey: "panels.modelSettings.operations.deleteModel",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: DELETE_MODEL_ENTRY },
    targetType: MODEL_ENTRY,
    targetSchema: modelTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyInputSchema,
    targetInput: "model",
    inspectImpact: deleteModelImpact,
    targetLabel: async (_host, target) => target.primaryKey,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Deleting a model requires a selected model");
      const settings = await readSettings(host, host.executor.credentials);
      if (!settings.models[target.primaryKey]) {
        return { kind: "refusal", code: "NOT_FOUND", message: `Model '${target.primaryKey}' not found` };
      }
      const next = settingsWriteFromData(settings);
      delete next.models[target.primaryKey];
      if (next.defaultModel === target.primaryKey) next.defaultModel = null;
      if (next.embeddingModel === target.primaryKey) next.embeddingModel = null;
      const saved = await saveSettings(host, host.executor.credentials, next);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: {},
        affected: {
          ...affected(MODEL_ENTRY, target.primaryKey, [MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, MODEL_OPTION]),
          removed: [{ objectType: MODEL_ENTRY, primaryKey: target.primaryKey }],
        },
      };
    },
  },
  {
    handlerRef: SAVE_USAGE_OP,
    labelKey: "panels.modelSettings.operations.saveUsage",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: MODEL_USAGE },
    targetType: MODEL_USAGE,
    targetSchema: usageTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: usageFormValuesSchema,
    draftOperation: () => "modelUsage.update",
    draftInput: (input) => saveInputSchema.parse(input).values,
    formInstructions: "Select the domain's default chat model and embedding model by public model name, or empty string to unset.",
    inspectImpact: saveUsageImpact,
    async execute(host: PanelOperationHost, _target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const settings = await readSettings(host, host.executor.credentials);
      const { values } = saveInputSchema.parse(input);
      const next = settingsWriteFromData(settings);
      if (typeof values.defaultModel === "string") {
        next.defaultModel = values.defaultModel.trim() || null;
      }
      if (typeof values.embeddingModel === "string") {
        next.embeddingModel = values.embeddingModel.trim() || null;
      }
      const checked = modelSettingsWriteSchema.safeParse(next);
      if (!checked.success) {
        const issue = checked.error.issues[0];
        const field = issue?.path[0] === "embeddingModel" ? "/embeddingModel" : "/defaultModel";
        return {
          kind: "refusal",
          code: "INVALID_MODEL_USAGE",
          message: issue?.message ?? "Invalid model selection",
          errors: [{ field, code: "invalid_option", message: issue?.message ?? "Invalid model selection" }],
        };
      }
      const saved = await saveSettings(host, host.executor.credentials, checked.data);
      if (!saved.ok) return saved.outcome;
      return {
        kind: "success",
        data: { defaultModel: saved.data.defaultModel ?? "", embeddingModel: saved.data.embeddingModel ?? "" },
        affected: affected(MODEL_USAGE, DOMAIN_KEY, [MODEL_USAGE, MODEL_CONNECTION, MODEL_OPTION]),
      };
    },
  },
  {
    handlerRef: REBUILD_VECTORS,
    labelKey: "panels.modelSettings.operations.rebuildVectors",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: REBUILD_VECTORS },
    targetType: MODEL_USAGE,
    targetSchema: usageTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyInputSchema,
    targetInput: "usage",
    targetLabel: async (host) => tForLocale(host.locale, "panels.modelSettings.usageTitle"),
    inspectImpact: rebuildVectorsImpact,
    async execute(host: PanelOperationHost): Promise<SinglePanelOperationOutcome> {
      await assertPermission(host.executor.credentials, ["system-config"]);
      const response = await host.request(`${DATA_QUERY_GATEWAY}/businessConfig/rebuildVectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        return { kind: "failure", code: "VECTOR_REBUILD_FAILED", message: (body as { message?: string } | null)?.message ?? `HTTP ${response.status}` };
      }
      const envelope = ownerEnvelopeSchema.parse(body);
      if (!envelope.success) return ownerWriteFailure(envelope, "VECTOR_REBUILD_FAILED", "Unable to start vector rebuild");
      return { kind: "success", data: {}, affected: affected(MODEL_USAGE, DOMAIN_KEY, [MODEL_USAGE]) };
    },
  },
  {
    handlerRef: PAUSE_VECTOR_REBUILD,
    labelKey: "panels.modelSettings.operations.pauseVectorRebuild",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: PAUSE_VECTOR_REBUILD },
    targetType: MODEL_USAGE,
    targetSchema: usageTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyInputSchema,
    targetInput: "usage",
    targetLabel: async (host) => tForLocale(host.locale, "panels.modelSettings.usageTitle"),
    async execute(host: PanelOperationHost): Promise<SinglePanelOperationOutcome> {
      await assertPermission(host.executor.credentials, ["system-config"]);
      const response = await host.request(`${DATA_QUERY_GATEWAY}/businessConfig/pauseVectorRebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        return { kind: "failure", code: "VECTOR_REBUILD_PAUSE_FAILED", message: (body as { message?: string } | null)?.message ?? `HTTP ${response.status}` };
      }
      const envelope = ownerEnvelopeSchema.parse(body);
      if (!envelope.success) return ownerWriteFailure(envelope, "VECTOR_REBUILD_PAUSE_FAILED", "Unable to pause vector rebuild");
      return { kind: "success", data: {}, affected: affected(MODEL_USAGE, DOMAIN_KEY, [MODEL_USAGE]) };
    },
  },
];
