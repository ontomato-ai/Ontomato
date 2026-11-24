import { z } from "zod";
import {
  DEFAULT_CHAT_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_RETRIES,
  DEFAULT_MODEL_TIMEOUT_SECONDS,
  modelConnectionNameSchema,
  modelConnectionWriteSchema,
  modelEntrySchema,
  modelNameSchema,
  modelProviderSchema,
  modelSettingsSchema,
  modelSettingsWriteSchema,
  ontologyAgentModelsSchema,
  requiresApiBase,
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
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { FormFieldError, PanelFormOption } from "@ontomato/contracts/form-fields";
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

/** Per-provider UI labels and default base URL placeholders. Validation rules live in `@ontomato/contracts/model-settings`. */
export const PROVIDER_SPECS: Record<ModelProvider, {
  labelKey: string;
  apiBasePlaceholder: string;
}> = {
  openai: { labelKey: "panels.modelSettings.providers.openai", apiBasePlaceholder: "https://api.openai.com/v1" },
  azure: { labelKey: "panels.modelSettings.providers.azure", apiBasePlaceholder: "https://<resource>.openai.azure.com" },
  bigmodel: { labelKey: "panels.modelSettings.providers.bigmodel", apiBasePlaceholder: "https://open.bigmodel.cn/api/paas/v4" },
  volcengine: { labelKey: "panels.modelSettings.providers.volcengine", apiBasePlaceholder: "https://ark.cn-beijing.volces.com/api/v3" },
  deepseek: { labelKey: "panels.modelSettings.providers.deepseek", apiBasePlaceholder: "https://api.deepseek.com" },
  dashscope: { labelKey: "panels.modelSettings.providers.dashscope", apiBasePlaceholder: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  moonshot: { labelKey: "panels.modelSettings.providers.moonshot", apiBasePlaceholder: "https://api.moonshot.cn/v1" },
  custom_openai: { labelKey: "panels.modelSettings.providers.custom_openai", apiBasePlaceholder: "https://api.example.com/v1" },
  anthropic: { labelKey: "panels.modelSettings.providers.anthropic", apiBasePlaceholder: "https://api.anthropic.com" },
  gemini: { labelKey: "panels.modelSettings.providers.gemini", apiBasePlaceholder: "https://generativelanguage.googleapis.com/v1beta" },
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

async function requestOwnerEnvelope(host: DataQueryOperationHost, path: string, body?: unknown) {
  const init = body === undefined
    ? { method: "GET" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, init);
  return { status: response.status, envelope: ownerEnvelopeSchema.parse(await response.json()) };
}

async function ownerData<T>(
  host: DataQueryOperationHost,
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body?: unknown,
): Promise<T> {
  const { status, envelope } = await requestOwnerEnvelope(host, path, body);
  if (!envelope.success) {
    const failure = ownerWriteFailure(envelope, "MODEL_SETTINGS_UNAVAILABLE", `Owner request failed: ${path}`);
    throw new HttpError(status >= 400 ? status : 422, failure.message, failure.code);
  }
  return schema.parse(envelope.data);
}

async function ownerWrite(
  host: DataQueryOperationHost,
  path: string,
  body: unknown,
  failureCode: string,
  fallbackMessage: string,
): Promise<{ ok: true; data: unknown } | { ok: false; outcome: Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }> }> {
  const { envelope } = await requestOwnerEnvelope(host, path, body);
  if (!envelope.success) return { ok: false, outcome: ownerWriteFailure(envelope, failureCode, fallbackMessage) };
  return { ok: true, data: envelope.data };
}

async function readSettings(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<ModelSettingsData> {
  await assertPermission(credentials, ["system-config"]);
  return ownerData(host, "/model-settings", modelSettingsSchema);
}

async function saveSettings(
  host: DataQueryOperationHost,
  credentials: AssistantCredentials,
  write: ModelSettingsWrite,
): Promise<{ ok: true; data: ModelSettingsData } | { ok: false; outcome: Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }> }> {
  await assertPermission(credentials, ["system-config"]);
  const result = await ownerWrite(host, "/model-settings/save", write, "MODEL_SETTINGS_SAVE_FAILED", "Unable to save model settings");
  if (!result.ok) return result;
  return { ok: true, data: modelSettingsSchema.parse(result.data) };
}

async function readOntologyAgents(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<OntologyAgentModel[]> {
  await assertPermission(credentials, ["system-config"]);
  return (await ownerData(host, "/ontology/ai/agent-models", ontologyAgentModelsSchema)).agents;
}

async function readVectorRebuild(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<VectorRebuildStatus> {
  await assertPermission(credentials, ["system-config"]);
  return ownerData(host, "/businessConfig/vectorRebuildStatus", vectorRebuildStatusSchema);
}

function issueCode(issue: z.ZodIssue): FormFieldError["code"] {
  if (
    issue.code === z.ZodIssueCode.invalid_enum_value
    || issue.code === z.ZodIssueCode.invalid_literal
    || issue.code === z.ZodIssueCode.invalid_union_discriminator
  ) {
    return "invalid_option";
  }
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined" || issue.received === "null") return "required";
    if (issue.expected === "number") return "invalid_number";
    if (issue.expected === "array") return "invalid_array";
    if (issue.expected === "object") return "invalid_object";
  }
  if (issue.code === z.ZodIssueCode.too_small && issue.type === "string" && issue.minimum === 1) return "required";
  if ((issue.code === z.ZodIssueCode.too_small || issue.code === z.ZodIssueCode.too_big) && issue.type === "number") {
    return "invalid_number";
  }
  if (issue.code === z.ZodIssueCode.too_big && issue.type === "string") return "value_too_long";
  return "invalid_format";
}

function mapZodIssues(
  issues: readonly z.ZodIssue[],
  fieldFor: (path: readonly (string | number)[]) => string = (path) => `/${path.join("/")}`,
): FormFieldError[] {
  return issues.map((issue) => ({
    field: fieldFor(issue.path),
    code: issueCode(issue),
    message: issue.message,
  }));
}

function parseExtraHeaders(rawHeaders: unknown, locale?: string): {
  extraHeaders?: Record<string, string>;
  headerIndexByName: Map<string, number>;
  errors: FormFieldError[];
} {
  const headerIndexByName = new Map<string, number>();
  if (rawHeaders === undefined) return { headerIndexByName, errors: [] };
  const rows = z.array(headerRowSchema).safeParse(rawHeaders);
  if (!rows.success) {
    return {
      headerIndexByName,
      errors: mapZodIssues(rows.error.issues, (path) => `/extraHeaders${path.length ? `/${path.join("/")}` : ""}`),
    };
  }
  const errors: FormFieldError[] = [];
  const extraHeaders: Record<string, string> = {};
  for (let i = 0; i < rows.data.length; i++) {
    const row = rows.data[i]!;
    const headerName = row.name.trim();
    if (!headerName) {
      if (row.value.trim()) {
        errors.push({ field: `/extraHeaders/${i}/name`, code: "required", message: tForLocale(locale, "panels.modelSettings.errors.headerNameRequired") });
      }
      continue;
    }
    if (headerIndexByName.has(headerName)) {
      errors.push({ field: `/extraHeaders/${i}/name`, code: "already_exists", message: tForLocale(locale, "panels.modelSettings.errors.headerDuplicate", { name: headerName }) });
      continue;
    }
    headerIndexByName.set(headerName, i);
    extraHeaders[headerName] = row.value;
  }
  return {
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
    headerIndexByName,
    errors,
  };
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
  values: Record<string, unknown>;
  connectionName: string;
  connection?: ModelConnectionWrite;
  errors: FormFieldError[];
} {
  const values: Record<string, unknown> = creating ? raw : { ...raw, name: existingName! };
  const errors: FormFieldError[] = [];

  let connectionName = existingName ?? "";
  if (creating) {
    const parsedName = modelConnectionNameSchema.safeParse(values.name);
    if (!parsedName.success) {
      errors.push(...mapZodIssues(parsedName.error.issues, () => "/name"));
    } else if (Object.hasOwn(settings.connections, parsedName.data)) {
      errors.push({
        field: "/name",
        code: "already_exists",
        message: tForLocale(locale, "panels.modelSettings.errors.connectionNameTaken", { name: parsedName.data }),
      });
    } else {
      connectionName = parsedName.data;
    }
  }

  const headers = parseExtraHeaders(values.extraHeaders, locale);
  errors.push(...headers.errors);

  const apiBase = values.apiBase === "" || values.apiBase === null || values.apiBase === undefined
    ? undefined
    : values.apiBase;
  const parsed = modelConnectionWriteSchema.safeParse({
    provider: values.provider,
    ...(apiBase !== undefined ? { apiBase } : {}),
    apiKey: values.apiKey,
    ...(headers.extraHeaders ? { extraHeaders: headers.extraHeaders } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "extraHeaders" && typeof issue.path[1] === "string" && headers.headerIndexByName.has(issue.path[1])) {
        errors.push({ field: `/extraHeaders/${headers.headerIndexByName.get(issue.path[1])}/value`, code: issueCode(issue), message: issue.message });
      } else {
        const field = issue.path.length > 0 ? `/${issue.path.join("/")}` : "/apiKey";
        const code = issue.code === z.ZodIssueCode.custom && issue.path[0] === "apiBase" && apiBase === undefined
          ? "required"
          : issueCode(issue);
        errors.push({ field, code, message: issue.message });
      }
    }
  }

  if (!creating && existingName && parsed.success && !supportsEmbeddings(parsed.data.provider)) {
    const hasEmbedding = modelsForConnection(settings, existingName).some(([, entry]) => entry.type === "embedding");
    if (hasEmbedding) {
      errors.push({ field: "/provider", code: "invalid_option", message: tForLocale(locale, "panels.modelSettings.errors.providerNoEmbeddings") });
    }
  }

  return {
    values,
    connectionName,
    ...(errors.length === 0 && parsed.success ? { connection: parsed.data } : {}),
    errors,
  };
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
  const parsedProvider = modelProviderSchema.safeParse(evaluated.values.provider);
  const apiBaseRequired = parsedProvider.success ? requiresApiBase(parsedProvider.data) : false;
  const apiBasePlaceholder = parsedProvider.success ? PROVIDER_SPECS[parsedProvider.data].apiBasePlaceholder : undefined;
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
      help: apiBaseRequired
        ? t("panels.modelSettings.fields.apiBaseHelpRequired")
        : t("panels.modelSettings.fields.apiBaseHelpOptional"),
      required: apiBaseRequired,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
      control: { kind: "text", ...(apiBasePlaceholder ? { placeholder: apiBasePlaceholder } : {}) },
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
    values: evaluated.values as Record<string, RuntimeJsonValue>,
    fields,
    errors,
    save: {
      method: "POST",
      path: "/api/data-query/model-settings/save",
      bodySchema: cachedZodToRuntimeJsonSchema(connectionFormValuesSchema),
    },
  };
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
  existingModelName: string | null,
  settings: ModelSettingsData,
  locale?: string,
): {
  values: Record<string, unknown>;
  modelName: string;
  entry?: ModelEntry;
  errors: FormFieldError[];
} {
  const errors: FormFieldError[] = [];
  const parsedName = modelNameSchema.safeParse(raw.name);
  let modelName = "";
  if (!parsedName.success) {
    errors.push(...mapZodIssues(parsedName.error.issues, () => "/name"));
  } else if (parsedName.data !== existingModelName && Object.hasOwn(settings.models, parsedName.data)) {
    errors.push({
      field: "/name",
      code: "already_exists",
      message: tForLocale(locale, "panels.modelSettings.errors.modelNameTaken", { name: parsedName.data }),
    });
  } else {
    modelName = parsedName.data;
  }

  const defined = (value: unknown) => value !== null && value !== undefined;
  const common = {
    connection: connectionName,
    model: raw.model,
    ...(defined(raw.timeoutSeconds) ? { timeoutSeconds: raw.timeoutSeconds } : {}),
    ...(defined(raw.maxRetries) ? { maxRetries: raw.maxRetries } : {}),
  };
  const candidate = raw.type === "embedding"
    ? {
      ...common,
      type: raw.type,
      dimensions: raw.dimensions === null ? undefined : raw.dimensions,
    }
    : {
      ...common,
      type: raw.type,
      ...(defined(raw.contextWindow) ? { contextWindow: raw.contextWindow } : {}),
      ...(defined(raw.maxOutputTokens) ? { maxOutputTokens: raw.maxOutputTokens } : {}),
      ...(raw.supportsReasoning !== undefined ? { supportsReasoning: raw.supportsReasoning } : {}),
      ...(raw.supportsVision !== undefined ? { supportsVision: raw.supportsVision } : {}),
      ...(defined(raw.temperature) ? { temperature: raw.temperature } : {}),
      ...(defined(raw.topP) ? { topP: raw.topP } : {}),
    };

  const parsedEntry = modelEntrySchema.safeParse(candidate);
  if (!parsedEntry.success) {
    errors.push(...mapZodIssues(parsedEntry.error.issues, (path) => `/${path.length ? path.join("/") : "type"}`));
  }

  if (parsedEntry.success && modelName) {
    const check = modelSettingsWriteSchema.safeParse({
      connections: settings.connections,
      models: { [modelName]: parsedEntry.data },
      defaultModel: null,
      embeddingModel: null,
    });
    if (!check.success) {
      for (const issue of check.error.issues) {
        if (issue.path[0] === "models" && issue.path[1] === modelName && issue.path.length > 2) {
          const rest = issue.path.slice(2);
          errors.push({
            field: `/${rest.join("/")}`,
            code: rest[0] === "type" ? "invalid_option" : issueCode(issue),
            message: issue.message,
          });
        }
      }
    }
  }

  return {
    values: raw,
    modelName,
    ...(errors.length === 0 && parsedEntry.success ? { entry: parsedEntry.data } : {}),
    errors,
  };
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
  const evaluated = parseModelDraft(merged, connectionName, existingModelName, settings, locale);
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

function parseUsageDraft(
  raw: Record<string, unknown>,
  settings: ModelSettingsData,
): {
  values: Record<string, unknown>;
  next?: ModelSettingsWrite;
  errors: FormFieldError[];
} {
  const defaultModel = raw.defaultModel === "" ? null : raw.defaultModel;
  const embeddingModel = raw.embeddingModel === "" ? null : raw.embeddingModel;
  const checked = modelSettingsWriteSchema.safeParse({
    ...settingsWriteFromData(settings),
    defaultModel,
    embeddingModel,
  });
  if (!checked.success) {
    return {
      values: raw,
      errors: checked.error.issues
        .filter((issue) => issue.path[0] === "defaultModel" || issue.path[0] === "embeddingModel")
        .map((issue) => ({
          field: `/${String(issue.path[0])}`,
          code: issue.code === z.ZodIssueCode.custom ? "invalid_option" : issueCode(issue),
          message: issue.message,
        })),
    };
  }
  return { values: raw, next: checked.data, errors: [] };
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

      const baseValues = {
        defaultModel: settings.defaultModel ?? "",
        embeddingModel: settings.embeddingModel ?? "",
      };
      const merged: Record<string, unknown> = { ...baseValues, ...(inputs.values ?? {}) };
      const evaluated = parseUsageDraft(merged, settings);
      const defaultModel = typeof merged.defaultModel === "string" ? merged.defaultModel : "";
      const embeddingModel = typeof merged.embeddingModel === "string" ? merged.embeddingModel : "";

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

      const errors = inputs.values ? evaluated.errors : [];

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
        values: merged as Record<string, RuntimeJsonValue>,
        fields,
        errors,
        save: {
          method: "POST",
          path: "/api/data-query/model-settings/save",
          bodySchema: cachedZodToRuntimeJsonSchema(usageFormValuesSchema),
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
  const headers = parseExtraHeaders(draft.extraHeaders, locale);
  if (headers.errors.length > 0) {
    throw new HttpError(400, headers.errors[0]!.message, "INVALID_REQUEST");
  }
  const apiBase = draft.apiBase === "" || draft.apiBase === null || draft.apiBase === undefined
    ? undefined
    : draft.apiBase;
  const parsed = runtimeModelDiscoveryRequestSchema.safeParse({
    connectionName: draft.name,
    connection: {
      provider: draft.provider,
      ...(apiBase !== undefined ? { apiBase } : {}),
      apiKey: draft.apiKey,
      ...(headers.extraHeaders ? { extraHeaders: headers.extraHeaders } : {}),
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
    const evaluated = parseModelDraft(
      { ...toModelFormValues(currentName, existing), ...values },
      existing.connection,
      currentName,
      settings,
      host.locale,
    );
    if (!evaluated.entry) return null;
    const nextName = evaluated.modelName;
    const nextEntry = evaluated.entry;
    const notes: string[] = [];
    if (nextEntry.type !== existing.type) {
      if (settings.defaultModel === currentName && nextEntry.type !== "chat") {
        notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsDefaultChat", { name: currentName }));
      }
      if (settings.embeddingModel === currentName && nextEntry.type !== "embedding") {
        notes.push(tForLocale(host.locale, "panels.modelSettings.impact.clearsEmbedding", { name: currentName }));
      }
    }
    if (
      existing.type === "embedding" &&
      nextEntry.type === "embedding" &&
      settings.embeddingModel === currentName &&
      nextEntry.dimensions !== existing.dimensions
    ) {
      notes.push(tForLocale(host.locale, "panels.modelSettings.impact.embeddingDimensionsChanged"));
    }
    if (nextName !== currentName) {
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
    const evaluated = parseUsageDraft(
      { defaultModel: settings.defaultModel ?? "", embeddingModel: settings.embeddingModel ?? "", ...values },
      settings,
    );
    if (!evaluated.next) return null;
    const nextDefault = evaluated.next.defaultModel;
    const nextEmbedding = evaluated.next.embeddingModel;
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
    draftInput: (input) => saveInputSchema.parse(input).values,
    create: true,
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
      const value = await ownerData(host, "/model-settings/discover", runtimeModelDiscoveryResponseSchema, request);
      return { kind: "json", value };
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
      const value = await ownerData(host, "/model-settings/test", runtimeModelTestResponseSchema, request);
      return { kind: "json", value };
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
    draftInput: (input) => saveInputSchema.parse(input).values,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Adding a model requires a selected connection");
      const settings = await readSettings(host, host.executor.credentials);
      if (!settings.connections[target.primaryKey]) {
        return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${target.primaryKey}' not found` };
      }
      const { values } = saveInputSchema.parse(input);
      const evaluated = parseModelDraft(values, target.primaryKey, null, settings, host.locale);
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
    draftInput: (input) => saveInputSchema.parse(input).values,
    inspectImpact: saveModelImpact,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Updating a model requires a selected model");
      const settings = await readSettings(host, host.executor.credentials);
      const existing = settings.models[target.primaryKey];
      if (!existing) return { kind: "refusal", code: "NOT_FOUND", message: `Model '${target.primaryKey}' not found` };
      if (!settings.connections[existing.connection]) {
        return { kind: "refusal", code: "NOT_FOUND", message: `Connection '${existing.connection}' not found` };
      }
      const { values } = saveInputSchema.parse(input);
      const merged = { ...toModelFormValues(target.primaryKey, existing), ...values };
      const evaluated = parseModelDraft(merged, existing.connection, target.primaryKey, settings, host.locale);
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
    draftInput: (input) => saveInputSchema.parse(input).values,
    inspectImpact: saveUsageImpact,
    async execute(host: PanelOperationHost, _target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const settings = await readSettings(host, host.executor.credentials);
      const { values } = saveInputSchema.parse(input);
      const evaluated = parseUsageDraft(
        { defaultModel: settings.defaultModel ?? "", embeddingModel: settings.embeddingModel ?? "", ...values },
        settings,
      );
      if (evaluated.errors.length > 0 || !evaluated.next) {
        return {
          kind: "refusal",
          code: "INVALID_MODEL_USAGE",
          message: evaluated.errors[0]?.message ?? "Invalid model selection",
          errors: evaluated.errors,
        };
      }
      const saved = await saveSettings(host, host.executor.credentials, evaluated.next);
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
      const result = await ownerWrite(host, "/businessConfig/rebuildVectors", {}, "VECTOR_REBUILD_FAILED", "Unable to start vector rebuild");
      if (!result.ok) return result.outcome;
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
      const result = await ownerWrite(host, "/businessConfig/pauseVectorRebuild", {}, "VECTOR_REBUILD_PAUSE_FAILED", "Unable to pause vector rebuild");
      if (!result.ok) return result.outcome;
      return { kind: "success", data: {}, affected: affected(MODEL_USAGE, DOMAIN_KEY, [MODEL_USAGE]) };
    },
  },
];
