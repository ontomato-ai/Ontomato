import { z } from "zod";
import {
  dataAdapterTestResultSchema,
  multiDataSourceRejectionSchema,
  multiDataSourceType,
  sandboxCapabilitySchema,
  type ConfigurationProblem,
  type DataAdapterConnection,
  type DataAdapterInfo,
  type DataSourceEntry,
  type MultiDataSourceDefinition,
} from "@ontomato/contracts/data-adapters";
import type { FormFieldError, PanelFormOption } from "@ontomato/contracts/form-fields";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import {
  panelReadOperationInputSchema,
  panelReadOperationJsonResultSchema,
  type panelReadOperationCallSchema,
} from "@ontomato/contracts/panel-operations";
import {
  panelFormSaveInputSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormRequest,
  type PanelFormSection,
  type PanelFormValues,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import {
  ACTION,
  CHECK_DATA_ADAPTER_SANDBOX_PERMISSION,
  DATA_ADAPTER_CONFIG,
  SAVE_DATA_ADAPTER_ROUTING,
  TEST_DATA_ADAPTER_CONNECTION,
} from "@ontomato/contracts/platform-object-types";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import {
  affected,
  ownerEnvelopeSchema,
  ownerPost,
  ownerWriteFailure,
  type DataQueryOperationHost,
} from "../product-panels/data-query-operations";
import {
  checkSandboxPermission, sandboxPermissionPresentation, sandboxPermissionResultSchema,
} from "../product-panels/sandbox-permission";
import { operationHost } from "../product-panels/operation-host";
import type {
  PanelOperationActor,
  PanelOperationHost,
  PanelOperationTarget,
  PanelReadServerOperation,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * Domain data adapter owner for the built-in `data-adapters` settings panel (`platform:DataAdapterConfig`).
 * Every read, save, and connection test routes through Java `BusinessConfigController` and `AdminController`
 * under the `system-config` permission boundary. Saved secret fields stay masked on the backend (`******`),
 * are presented as blank inputs on edit forms, and are restored on blank submission so unchanged secrets
 * are never overwritten or echoed into form values.
 */

const DOMAIN_KEY = "domain";
const SECRET_MASK = "******";
const SANDBOX_AFFECTED_TYPES = [DATA_ADAPTER_CONFIG, ACTION];
const SAVE_OP = `${DATA_ADAPTER_CONFIG}.save`;
const SECRET_NAME_RE = /(password|secret|token|private.?key|access.?key|api.?key)/i;
const FULL_WIDTH_FIELD_NAMES = new Set(["url", "jdbcUrl", "hosts", "httpPath", "privateKey", "serverHostname"]);

const KNOWN_FIELD_LABEL_KEYS: Readonly<Record<string, string>> = {
  url: "panels.dataAdapters.connectionFields.url",
  jdbcUrl: "panels.dataAdapters.connectionFields.url",
  company: "panels.dataAdapters.connectionFields.company",
  user: "panels.dataAdapters.connectionFields.user",
  password: "panels.dataAdapters.connectionFields.password",
  account: "panels.dataAdapters.connectionFields.account",
  warehouse: "panels.dataAdapters.connectionFields.warehouse",
  role: "panels.dataAdapters.connectionFields.role",
  database: "panels.dataAdapters.connectionFields.database",
  schema: "panels.dataAdapters.connectionFields.schema",
  catalog: "panels.dataAdapters.connectionFields.catalog",
  serverHostname: "panels.dataAdapters.connectionFields.serverHostname",
  host: "panels.dataAdapters.connectionFields.host",
  port: "panels.dataAdapters.connectionFields.port",
  httpPath: "panels.dataAdapters.connectionFields.httpPath",
  token: "panels.dataAdapters.connectionFields.accessToken",
  accessToken: "panels.dataAdapters.connectionFields.accessToken",
  privateKey: "panels.dataAdapters.connectionFields.privateKey",
  clientId: "panels.dataAdapters.connectionFields.clientId",
  clientSecret: "panels.dataAdapters.connectionFields.clientSecret",
  tenantId: "panels.dataAdapters.connectionFields.tenantId",
  project: "panels.dataAdapters.connectionFields.project",
  dataset: "panels.dataAdapters.connectionFields.dataset",
  region: "panels.dataAdapters.connectionFields.region",
};

const dataAdapterFieldInfoSchema = z.object({
  name: z.string().min(1),
  label: z.string().nullish(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  example: z.string().nullish(),
  fullWidth: z.boolean().optional(),
}).passthrough();

const dataAdapterInfoSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  requiresJoinFields: z.boolean().optional().default(true),
  fields: z.array(z.string()).optional().default([]),
  examples: z.record(z.string(), z.string().nullish()).optional().default({}).transform((record) =>
    Object.fromEntries(
      Object.entries(record).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
    ) as Partial<Record<string, string>>,
  ),
  fieldInfos: z.array(dataAdapterFieldInfoSchema).optional(),
}).passthrough();

const dataAdaptersPayloadSchema = z.object({
  currentType: z.string().nullish().transform((v) => v ?? ""),
  adapters: z.array(dataAdapterInfoSchema).default([]),
}).passthrough();

const connectionMapSchema = z.record(z.string(), z.string().nullish()).transform((record) =>
  Object.fromEntries(
    Object.entries(record).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  ) as DataAdapterConnection,
);

const dataSourceEntrySchema = z.object({
  id: z.string().default(""),
  label: z.string().nullish().transform((v) => v ?? ""),
  adapterType: z.string().default(""),
  readOnly: z.boolean().optional().default(false),
  connection: connectionMapSchema.nullish().transform((v) => v ?? {}),
}).passthrough();

const multiDataSourceSchema = z.object({
  dataSources: z.array(dataSourceEntrySchema).nullish().transform((v) => v ?? []),
  classes: z.array(z.object({ forOntoMap: z.string(), sourceId: z.string() }).passthrough()).nullish().transform((v) => v ?? []),
  relationships: z.array(z.object({ forOntoMap: z.string(), realEdge: z.string() }).passthrough()).nullish().transform((v) => v ?? []),
}).passthrough();

const businessConfigPayloadSchema = z.object({
  sandboxCapability: sandboxCapabilitySchema.optional(),
  dataAdapter: z.string().nullish().transform((v) => v ?? ""),
  dataAdapterConnections: z.record(z.string(), connectionMapSchema.nullish()).nullish().transform((map) => {
    const out: Record<string, DataAdapterConnection> = {};
    for (const [k, v] of Object.entries(map ?? {})) {
      if (v) out[k] = v;
    }
    return out;
  }),
  multiDataSource: multiDataSourceSchema.nullish().transform((v) => (v ?? null) as MultiDataSourceDefinition | null),
}).passthrough();

const ontologyOutlineSchema = z.object({
  classDefs: z.array(z.object({ name: z.string() }).passthrough()).nullish().transform((v) => v ?? []),
  relationshipDefs: z.record(z.string(), z.object({ fromClass: z.string(), toClass: z.string() }).passthrough()).nullish().transform((v) => v ?? {}),
}).passthrough().transform(({ classDefs, relationshipDefs }) => ({
  classNames: classDefs.map(({ name }) => name),
  relationships: Object.entries(relationshipDefs).map(([name, { fromClass, toClass }]) => ({
    name,
    fromClass,
    toClass,
  })),
}));

type BusinessConfigView = z.output<typeof businessConfigPayloadSchema>;
type OntologyOutline = z.output<typeof ontologyOutlineSchema>;

interface NormalizedFieldInfo {
  name: string;
  label: string | null;
  required: boolean;
  secret: boolean;
  example: string | null;
  fullWidth: boolean;
}

type MultiSourceRowDraft = {
  id: string;
  label: string;
  readOnly: boolean;
  adapter: {
    adapterType: string;
    connection: Record<string, string>;
  };
};

const dataAdapterTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(DATA_ADAPTER_CONFIG),
  primaryKey: z.literal(DOMAIN_KEY),
}).strict();

const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const saveCapabilitySchema = z.object({ sandboxCapability: sandboxCapabilitySchema.optional() });
const saveResultSchema = saveCapabilitySchema.extend({ adapterMode: z.string() }).strict();

function savedConfig(adapterMode: string, data: unknown): SinglePanelOperationOutcome {
  return {
    kind: "success",
    data: { adapterMode, ...saveCapabilitySchema.optional().parse(data) },
    affected: affected(DATA_ADAPTER_CONFIG, DOMAIN_KEY, SANDBOX_AFFECTED_TYPES),
  };
}
const jsonResultSchema = panelReadOperationJsonResultSchema.options[1];
const testParamsSchema = z.object({
  sourceId: z.string().nullish(),
}).passthrough();

const envelopeWithDataSchema = ownerEnvelopeSchema.extend({
  data: z.unknown().optional(),
});

function escapeJsonPointer(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireDomainKey(primaryKey: string) {
  if (primaryKey !== DOMAIN_KEY) {
    throw new HttpError(404, "Data adapter configuration not found", "NOT_FOUND");
  }
}

function humanizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

function normalizeAdapterFields(adapter: DataAdapterInfo): NormalizedFieldInfo[] {
  if (adapter.fieldInfos && adapter.fieldInfos.length > 0) {
    return adapter.fieldInfos.map((info) => ({
      name: info.name,
      label: info.label ?? null,
      required: Boolean(info.required),
      secret: Boolean(info.secret || SECRET_NAME_RE.test(info.name)),
      example: info.example ?? adapter.examples?.[info.name] ?? null,
      fullWidth: Boolean(info.fullWidth || FULL_WIDTH_FIELD_NAMES.has(info.name)),
    }));
  }
  return (adapter.fields ?? []).map((name) => ({
    name,
    label: null,
    required: false,
    secret: SECRET_NAME_RE.test(name),
    example: adapter.examples?.[name] ?? null,
    fullWidth: FULL_WIDTH_FIELD_NAMES.has(name),
  }));
}

function fieldLabel(field: NormalizedFieldInfo, locale?: string): string {
  if (field.label) return field.label;
  const key = KNOWN_FIELD_LABEL_KEYS[field.name];
  if (key) {
    const translated = tForLocale(locale, key);
    if (translated && translated !== key) return translated;
  }
  return humanizeFieldName(field.name);
}

function hasSavedSecretValue(connection: DataAdapterConnection | undefined, fieldName: string): boolean {
  const stored = connection?.[fieldName];
  return typeof stored === "string" && stored.length > 0;
}

function storedConnectionToFormValues(
  adapter: DataAdapterInfo | undefined,
  stored: DataAdapterConnection | undefined,
): Record<string, string> {
  if (!adapter) return {};
  const result: Record<string, string> = {};
  for (const field of normalizeAdapterFields(adapter)) {
    if (field.secret) {
      // Never echo the backend's secret mask (`******`) into editable form values.
      result[field.name] = "";
    } else {
      result[field.name] = stored?.[field.name] ?? "";
    }
  }
  return result;
}

function sanitizeIncomingConnectionValues(
  adapter: DataAdapterInfo | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!adapter) return {};
  const result: Record<string, string> = {};
  for (const field of normalizeAdapterFields(adapter)) {
    const raw = incoming?.[field.name];
    result[field.name] = typeof raw === "string" ? raw : "";
  }
  return result;
}

function buildConnectionField(
  field: NormalizedFieldInfo,
  path: string,
  hasSavedSecret: boolean,
  locale?: string,
  section?: string,
): PanelFormField {
  const label = fieldLabel(field, locale);
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  if (field.secret) {
    const required = hasSavedSecret ? false : field.required;
    return {
      path,
      ...(section ? { section } : {}),
      ...(field.fullWidth ? { fullWidth: true } : {}),
      label,
      ...(hasSavedSecret ? { help: t("panels.dataAdapters.secretSavedHelp") } : {}),
      required,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(required ? z.string().min(1) : z.string()),
      control: {
        kind: "text",
        secret: true,
        clearable: true,
        placeholder: hasSavedSecret ? SECRET_MASK : (field.example ?? SECRET_MASK),
      },
    };
  }
  return {
    path,
    ...(section ? { section } : {}),
    ...(field.fullWidth ? { fullWidth: true } : {}),
    label,
    required: field.required,
    readOnly: false,
    valueSchema: cachedZodToRuntimeJsonSchema(field.required ? z.string().min(1) : z.string()),
    control: {
      kind: "text",
      clearable: true,
      ...(field.example ? { placeholder: field.example } : {}),
    },
  };
}

async function readJavaGet<T>(
  host: DataQueryOperationHost,
  credentials: AssistantCredentials,
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  errorCode: string,
  fallbackMessage: string,
): Promise<T> {
  await assertPermission(credentials, ["system-config"]);
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, { method: "GET" });
  if (!response.ok) {
    throw new HttpError(response.status, fallbackMessage, errorCode);
  }
  const envelope = envelopeWithDataSchema.parse(await response.json());
  if (!envelope.success) {
    throw new HttpError(422, envelope.message ?? fallbackMessage, errorCode);
  }
  return schema.parse(envelope.data ?? {});
}

async function readBusinessConfig(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<BusinessConfigView> {
  return readJavaGet(
    host,
    credentials,
    "/businessConfig/getConfig",
    businessConfigPayloadSchema,
    "DATA_ADAPTER_CONFIG_UNAVAILABLE",
    "Unable to read business configuration",
  );
}

async function readDataAdapters(host: DataQueryOperationHost, credentials: AssistantCredentials) {
  return readJavaGet(
    host,
    credentials,
    "/businessConfig/dataAdapters",
    dataAdaptersPayloadSchema,
    "DATA_ADAPTERS_UNAVAILABLE",
    "Unable to read installed data adapters",
  );
}

async function readOntologyOutline(host: DataQueryOperationHost, credentials: AssistantCredentials): Promise<OntologyOutline> {
  return readJavaGet(
    host,
    credentials,
    "/admin/getSchema",
    ontologyOutlineSchema,
    "ONTOLOGY_SCHEMA_UNAVAILABLE",
    "Unable to read ontology schema",
  );
}

function normalizeMultiSourceRowsFromStored(
  stored: MultiDataSourceDefinition | null,
  sourceAdapters: readonly DataAdapterInfo[],
): MultiSourceRowDraft[] {
  const byType = new Map(sourceAdapters.map((a) => [a.type, a]));
  return (stored?.dataSources ?? []).map((entry) => ({
    id: entry.id ?? "",
    label: entry.label ?? "",
    readOnly: Boolean(entry.readOnly),
    adapter: {
      adapterType: entry.adapterType ?? "",
      connection: storedConnectionToFormValues(byType.get(entry.adapterType), entry.connection),
    },
  }));
}

function normalizeMultiSourceRowsFromIncoming(
  rawRows: unknown,
  sourceAdapters: readonly DataAdapterInfo[],
): MultiSourceRowDraft[] {
  if (!Array.isArray(rawRows)) return [];
  const byType = new Map(sourceAdapters.map((a) => [a.type, a]));
  return rawRows.map((row) => {
    const record = isPlainObject(row) ? row : {};
    const adapterObj = isPlainObject(record.adapter) ? record.adapter : {};
    const adapterType = typeof adapterObj.adapterType === "string"
      ? adapterObj.adapterType
      : (typeof record.adapterType === "string" ? record.adapterType : "");
    const rawConn = isPlainObject(adapterObj.connection)
      ? adapterObj.connection
      : (isPlainObject(record.connection) ? record.connection : {});
    const adapterInfo = byType.get(adapterType);
    const connection = adapterInfo
      ? sanitizeIncomingConnectionValues(adapterInfo, rawConn)
      : Object.fromEntries(
        Object.entries(rawConn).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
      );
    return {
      id: typeof record.id === "string" ? record.id : "",
      label: typeof record.label === "string" ? record.label : "",
      readOnly: record.readOnly === true,
      adapter: {
        adapterType,
        connection,
      },
    };
  });
}

function extractIncomingClassRoutes(rawRoutes: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rawRoutes)) return map;
  for (const row of rawRoutes) {
    if (!isPlainObject(row)) continue;
    const className = typeof row.className === "string" ? row.className : "";
    if (!className) continue;
    map.set(className, typeof row.sourceId === "string" ? row.sourceId : "");
  }
  return map;
}

function extractIncomingRealEdges(rawRoutes: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rawRoutes)) return map;
  for (const row of rawRoutes) {
    if (!isPlainObject(row)) continue;
    const name = typeof row.relationship === "string" ? row.relationship : "";
    if (!name) continue;
    if (typeof row.realEdge === "string") {
      map.set(name, row.realEdge);
    }
  }
  return map;
}

type SourceCatalogEntry = {
  id: string;
  adapterType: string;
};

function normalizeSourceCatalogFromStored(
  stored: MultiDataSourceDefinition | null,
  sourceAdapters: readonly DataAdapterInfo[],
): SourceCatalogEntry[] {
  return normalizeMultiSourceRowsFromStored(stored, sourceAdapters).map((row) => ({
    id: row.id.trim(),
    adapterType: row.adapter.adapterType,
  }));
}

function normalizeSourceCatalogFromIncoming(raw: unknown): SourceCatalogEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: SourceCatalogEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    entries.push({
      id: typeof item.id === "string" ? item.id.trim() : "",
      adapterType: typeof item.adapterType === "string" ? item.adapterType.trim() : "",
    });
  }
  return entries;
}

function resolveConnectionPayload(
  adapter: DataAdapterInfo,
  draftConn: Record<string, unknown>,
  storedConn: DataAdapterConnection | undefined,
  pathPrefix: string,
  locale?: string,
): { connection: DataAdapterConnection; errors: FormFieldError[] } {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  const connection: DataAdapterConnection = {};
  const errors: FormFieldError[] = [];

  for (const field of normalizeAdapterFields(adapter)) {
    const rawValue = typeof draftConn[field.name] === "string" ? (draftConn[field.name] as string) : "";
    const fieldPath = `${pathPrefix}/${escapeJsonPointer(field.name)}`;
    const label = fieldLabel(field, locale);

    if (field.secret) {
      if (rawValue === "") {
        if (hasSavedSecretValue(storedConn, field.name)) {
          connection[field.name] = SECRET_MASK;
        } else if (field.required) {
          errors.push({
            field: fieldPath,
            code: "required",
            message: t("panels.dataAdapters.errors.fieldRequired", { field: label }),
          });
        }
      } else {
        connection[field.name] = rawValue;
      }
    } else {
      if (rawValue.trim() === "") {
        if (field.required) {
          errors.push({
            field: fieldPath,
            code: "required",
            message: t("panels.dataAdapters.errors.fieldRequired", { field: label }),
          });
        } else if (rawValue !== "") {
          connection[field.name] = rawValue;
        }
      } else {
        connection[field.name] = rawValue;
      }
    }
  }

  return { connection, errors };
}

function mapMultiSourceProblemToFieldError(
  problem: ConfigurationProblem,
  submittedSources: readonly MultiSourceRowDraft[],
  ontology: OntologyOutline,
): FormFieldError {
  const { path, detail } = problem;
  const message = `${path}: ${detail}`;

  if (path === "multiDataSource") {
    return { field: "/adapterMode", code: "invalid_format", message };
  }
  if (path === "dataSources") {
    return { field: "/dataSources", code: "invalid_array", message };
  }
  const sourceMatch = /^dataSources\[(.+)\]$/.exec(path);
  if (sourceMatch) {
    const key = sourceMatch[1]!;
    const numeric = /^\d+$/.test(key) ? Number(key) : -1;
    const index = numeric >= 0 && numeric < submittedSources.length
      ? numeric
      : submittedSources.findIndex((row) => row.id.trim() === key);
    if (index >= 0) {
      const lower = detail.toLowerCase();
      if (lower.includes("adapter") || lower.includes("multi source") || lower.includes("installed")) {
        return { field: `/dataSources/${index}/adapter/adapterType`, code: "invalid_option", message };
      }
      if (lower.includes("id")) {
        return { field: `/dataSources/${index}/id`, code: lower.includes("duplicate") ? "already_exists" : "invalid_format", message };
      }
      return { field: `/dataSources/${index}`, code: "invalid_object", message };
    }
    return { field: "/dataSources", code: "invalid_array", message };
  }

  const classMatch = /^(?:classDef|classes)\[(.+)\]$/.exec(path);
  if (classMatch) {
    const className = classMatch[1]!;
    const classIndex = ontology.classNames.indexOf(className);
    if (classIndex >= 0) {
      return { field: `/classRoutes/${classIndex}/sourceId`, code: "invalid_option", message };
    }
    return { field: "/adapterMode", code: "invalid_option", message };
  }

  const relMatch = /^(?:relationshipDef|relationships)\[(.+)\]$/.exec(path);
  if (relMatch) {
    const relName = relMatch[1]!;
    const relIndex = ontology.relationships.findIndex((rel) => rel.name === relName);
    if (relIndex >= 0) {
      const lower = detail.toLowerCase();
      return {
        field: lower.includes("edge") ? `/relationshipRoutes/${relIndex}/realEdge` : `/relationshipRoutes/${relIndex}`,
        code: "invalid_format",
        message,
      };
    }
    return { field: "/relationshipRoutes", code: "invalid_array", message };
  }

  return { field: "/adapterMode", code: "invalid_format", message };
}

function summarizeRecord(
  config: BusinessConfigView,
  adapters: readonly DataAdapterInfo[],
  locale?: string,
): {
  currentType: string;
  mode: "single" | "multi" | "unconfigured";
  displayName: string;
  modeLabel: string;
  summary: string;
} {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  const currentType = config.dataAdapter || "";
  if (!currentType) {
    const unconfigured = t("panels.dataAdapters.record.unconfigured");
    return {
      currentType: "",
      mode: "unconfigured",
      displayName: unconfigured,
      modeLabel: unconfigured,
      summary: unconfigured,
    };
  }
  const activeAdapter = adapters.find((a) => a.type === currentType);
  const displayName = activeAdapter?.label ?? currentType;
  if (currentType === multiDataSourceType) {
    const sources = config.multiDataSource?.dataSources ?? [];
    const byType = new Map(adapters.map((a) => [a.type, a.label]));
    const summary = sources.length === 0
      ? t("panels.dataAdapters.multiSourceNoSources")
      : t("panels.dataAdapters.record.multiSummary", {
        count: sources.length,
        sources: sources.map((s) => `${s.id} (${byType.get(s.adapterType) ?? s.adapterType})`).join(", "),
      });
    return {
      currentType,
      mode: "multi",
      displayName,
      modeLabel: t("panels.dataAdapters.record.modeMulti"),
      summary,
    };
  }
  const conn = config.dataAdapterConnections[currentType] ?? {};
  const endpoint = conn.url || conn.jdbcUrl || conn.host || conn.serverHostname || "";
  const summary = endpoint
    ? t("panels.dataAdapters.record.singleSummaryWithEndpoint", { name: displayName, endpoint })
    : displayName;
  return {
    currentType,
    mode: "single",
    displayName,
    modeLabel: t("panels.dataAdapters.record.modeSingle"),
    summary,
  };
}

export function createDataAdapterConfigReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const locale = actor.credentials.locale;
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);

  return {
    async record(primaryKey: string): Promise<PanelRecord> {
      requireDomainKey(primaryKey);
      const [config, adaptersData] = await Promise.all([
        readBusinessConfig(host, actor.credentials),
        readDataAdapters(host, actor.credentials),
      ]);
      const summary = summarizeRecord(
        { ...config, dataAdapter: config.dataAdapter || adaptersData.currentType },
        adaptersData.adapters,
        locale,
      );
      const configured = summary.mode !== "unconfigured";
      const capability = configured
        ? config.sandboxCapability ?? {
          status: "unchecked" as const,
          supported: true,
          canCreateAndDrop: false,
          reason: t("panels.dataAdapters.sandbox.uncheckedDetail"),
          probeNote: t("panels.dataAdapters.sandbox.probeNote"),
        }
        : {
          status: "unsupported" as const,
          supported: false,
          canCreateAndDrop: false,
          reason: t("panels.dataAdapters.sandbox.unconfiguredDetail"),
          probeNote: "",
        };
      const sandbox = sandboxPermissionPresentation(capability, locale);
      return {
        primaryKey: DOMAIN_KEY,
        label: summary.displayName,
        fields: {
          adapterType: summary.currentType || t("panels.dataAdapters.record.unconfigured"),
          displayName: summary.displayName,
          mode: summary.modeLabel,
          summary: summary.summary,
          sandboxStatus: configured ? sandbox.status : t("panels.dataAdapters.record.unconfigured"),
          sandboxDetail: configured ? sandbox.detail : capability.reason,
        },
        fieldLabels: {
          adapterType: t("panels.dataAdapters.record.adapterType"),
          displayName: t("panels.dataAdapters.record.displayName"),
          mode: t("panels.dataAdapters.record.mode"),
          summary: t("panels.dataAdapters.record.summary"),
          sandboxStatus: t("panels.dataAdapters.sandbox.status"),
          sandboxDetail: t("panels.dataAdapters.sandbox.detail"),
        },
        tones: { sandboxStatus: sandbox.tone },
        outputs: {
          currentType: summary.currentType,
          mode: summary.mode,
          configured,
          sandboxStatus: capability.status,
          sandboxSupported: capability.supported,
          sandboxCanCreateAndDrop: capability.canCreateAndDrop,
          sandboxReason: capability.reason,
          sandboxProbeNote: capability.probeNote,
        },
      };
    },

    async form(
      primaryKey: string,
      inputs: Pick<PanelFormRequest, "values" | "changedField">,
    ): Promise<PanelFormDescription> {
      requireDomainKey(primaryKey);
      const [config, adaptersData] = await Promise.all([
        readBusinessConfig(host, actor.credentials),
        readDataAdapters(host, actor.credentials),
      ]);
      const adapters = adaptersData.adapters;
      const incoming = inputs.values;
      const switchedMode = inputs.changedField === "/adapterMode";

      const adapterMode = incoming && typeof incoming.adapterMode === "string"
        ? incoming.adapterMode
        : (config.dataAdapter || adaptersData.currentType || adapters[0]?.type || "");

      const modeOptions: PanelFormOption[] = adapters.map((adapter) => ({
        value: adapter.type,
        label: adapter.label,
        description: null,
        disabled: false,
        disabledReason: null,
      }));
      if (adapterMode && !adapters.some((a) => a.type === adapterMode)) {
        modeOptions.push({
          value: adapterMode,
          label: adapterMode,
          description: null,
          disabled: true,
          disabledReason: t("panels.dataAdapters.errors.adapterNotInstalled", { type: adapterMode }),
        });
      }

      const modeField: PanelFormField = {
        path: "/adapterMode",
        section: "mode",
        fullWidth: true,
        label: t("panels.dataAdapters.fields.adapterMode"),
        required: true,
        readOnly: false,
        refreshOnChange: true,
        valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
        control: {
          kind: "select",
          presentation: "radio",
          options: modeOptions,
        },
      };

      if (adapterMode === multiDataSourceType) {
        // Multi-source mode keeps data source editing independent from the ontology outline
        // (`/admin/getSchema`), which is lazy-loaded by `routingForm` so an outline error never
        // blocks editing or saving data sources.
        const sourceAdapters = adapters.filter((a) => a.type !== multiDataSourceType);
        const defaultSourceType = sourceAdapters[0]?.type ?? "";
        const storedMulti = config.multiDataSource;

        const dataSources = !incoming || switchedMode
          ? normalizeMultiSourceRowsFromStored(storedMulti, sourceAdapters)
          : normalizeMultiSourceRowsFromIncoming(incoming.dataSources, sourceAdapters);

        const adapterVariants: Record<string, PanelFormField[]> = {};
        for (const adapter of sourceAdapters) {
          const fields = normalizeAdapterFields(adapter);
          adapterVariants[adapter.type] = fields.map((field) => {
            const hasSaved = field.secret && (storedMulti?.dataSources ?? []).some(
              (entry) => entry.adapterType === adapter.type && hasSavedSecretValue(entry.connection, field.name),
            );
            return buildConnectionField(
              field,
              `/connection/${escapeJsonPointer(field.name)}`,
              hasSaved,
              locale,
            );
          });
        }

        const sourceAdapterOptions: PanelFormOption[] = sourceAdapters.map((adapter) => ({
          value: adapter.type,
          label: adapter.label,
          description: null,
          disabled: false,
          disabledReason: null,
        }));

        const dataSourcesField: PanelFormField = {
          path: "/dataSources",
          section: "dataSources",
          fullWidth: true,
          label: t("panels.dataAdapters.fields.dataSources"),
          help: dataSources.length === 0 ? t("panels.dataAdapters.multiSourceNoSources") : undefined,
          required: true,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
          control: {
            kind: "object-array",
            columns: 2,
            reorderable: false,
            itemKeyPath: "/id",
            defaultItem: {
              id: "",
              label: "",
              readOnly: false,
              adapter: { adapterType: defaultSourceType, connection: {} },
            },
            itemFields: [
              {
                path: "/id",
                label: t("panels.dataAdapters.fields.sourceId"),
                required: true,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
                control: { kind: "text", clearable: true, placeholder: t("panels.dataAdapters.fields.sourceIdPlaceholder") },
              },
              {
                path: "/label",
                label: t("panels.dataAdapters.fields.sourceLabel"),
                required: false,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
                control: { kind: "text", clearable: true },
              },
              {
                path: "/readOnly",
                label: t("panels.dataAdapters.fields.sourceReadOnly"),
                required: false,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.boolean()),
                control: { kind: "switch" },
              },
              {
                path: "/adapter",
                fullWidth: true,
                label: t("panels.dataAdapters.fields.sourceConnection"),
                required: true,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
                control: {
                  kind: "object",
                  columns: 2,
                  defaultObject: { adapterType: defaultSourceType, connection: {} },
                  variantBy: "/adapterType",
                  fields: [
                    {
                      path: "/adapterType",
                      fullWidth: true,
                      label: t("panels.dataAdapters.fields.sourceAdapterType"),
                      required: true,
                      readOnly: false,
                      valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
                      control: { kind: "select", options: sourceAdapterOptions },
                    },
                  ],
                  variants: adapterVariants,
                },
              },
            ],
          },
        };

        const storedClassRoutes = (storedMulti?.classes ?? []).map((entry) => ({
          className: entry.forOntoMap,
          sourceId: entry.sourceId,
        }));
        const storedRelationshipRoutes = (storedMulti?.relationships ?? []).map((entry) => ({
          relationship: entry.forOntoMap,
          realEdge: entry.realEdge,
        }));
        const classRoutes = incoming && !switchedMode && Array.isArray(incoming.classRoutes)
          ? incoming.classRoutes
          : storedClassRoutes;
        const relationshipRoutes = incoming && !switchedMode && Array.isArray(incoming.relationshipRoutes)
          ? incoming.relationshipRoutes
          : storedRelationshipRoutes;

        const hiddenClassRoutesField: PanelFormField = {
          path: "/classRoutes",
          label: t("panels.dataAdapters.fields.classRoutes"),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
          control: { kind: "hidden" },
        };
        const hiddenRelationshipRoutesField: PanelFormField = {
          path: "/relationshipRoutes",
          label: t("panels.dataAdapters.fields.relationshipRoutes"),
          required: false,
          readOnly: false,
          valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
          control: { kind: "hidden" },
        };

        const sections: PanelFormSection[] = [
          { key: "mode", title: t("panels.dataAdapters.sections.mode") },
          { key: "dataSources", title: t("panels.dataAdapters.sections.dataSources") },
        ];

        return {
          sections,
          fields: [modeField, dataSourcesField, hiddenClassRoutesField, hiddenRelationshipRoutesField],
          values: {
            adapterMode: multiDataSourceType,
            dataSources,
            classRoutes,
            relationshipRoutes,
          },
          errors: [],
          save: {
            method: "POST",
            path: "/api/data-query/businessConfig/useMultiDataSource",
            bodySchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
          },
        };
      }

      // Single-source mode: omit form sections so ObjectForm renders a continuous flow without extra headings or TOC.
      const selectedAdapter = adapters.find((a) => a.type === adapterMode);
      const storedConn = config.dataAdapterConnections[adapterMode];
      const connectionValues = !incoming || switchedMode
        ? storedConnectionToFormValues(selectedAdapter, storedConn)
        : sanitizeIncomingConnectionValues(
          selectedAdapter,
          isPlainObject(incoming.connection) ? incoming.connection : undefined,
        );

      const { section: _omittedModeSection, ...singleModeField } = modeField;
      const connectionFields = selectedAdapter
        ? normalizeAdapterFields(selectedAdapter).map((field) =>
          buildConnectionField(
            field,
            `/connection/${escapeJsonPointer(field.name)}`,
            field.secret && hasSavedSecretValue(storedConn, field.name),
            locale,
            undefined,
          ),
        )
        : [];

      const errors = incoming && !switchedMode && selectedAdapter
        ? resolveConnectionPayload(selectedAdapter, connectionValues, storedConn, "/connection", locale).errors
        : [];

      return {
        fields: [singleModeField, ...connectionFields],
        values: {
          adapterMode,
          connection: connectionValues,
        },
        errors,
        save: {
          method: "POST",
          path: "/api/data-query/businessConfig/useDataAdapter",
          bodySchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
        },
      };
    },

    async routingForm(
      primaryKey: string,
      inputs: Pick<PanelFormRequest, "values" | "changedField">,
    ): Promise<PanelFormDescription> {
      requireDomainKey(primaryKey);
      const [config, adaptersData, ontology] = await Promise.all([
        readBusinessConfig(host, actor.credentials),
        readDataAdapters(host, actor.credentials),
        readOntologyOutline(host, actor.credentials),
      ]);
      const sourceAdapters = adaptersData.adapters.filter((a) => a.type !== multiDataSourceType);
      const storedMulti = config.multiDataSource;
      const incoming = inputs.values;
      const incomingSourceCatalog = incoming ? normalizeSourceCatalogFromIncoming(incoming.sourceCatalog) : null;
      const sourceCatalog = incomingSourceCatalog ?? normalizeSourceCatalogFromStored(storedMulti, sourceAdapters);

      const routableIds = [...new Set(sourceCatalog.map((s) => s.id).filter((id) => id.length > 0))];
      const routableOptions: PanelFormOption[] = routableIds.map((id) => ({
        value: id,
        label: id,
        description: null,
        disabled: false,
        disabledReason: null,
      }));
      const fallbackSource = sourceCatalog.length === 1 && sourceCatalog[0]!.id
        ? sourceCatalog[0]!
        : null;

      const storedClassMap = new Map((storedMulti?.classes ?? []).map((c) => [c.forOntoMap, c.sourceId]));
      const incomingClassRoutes = incoming && Array.isArray(incoming.classRoutes)
        ? extractIncomingClassRoutes(incoming.classRoutes)
        : undefined;
      const classRouteMap = new Map<string, string>();
      const classRoutes = ontology.classNames.map((className) => {
        const sourceId = incomingClassRoutes
          ? (incomingClassRoutes.get(className) ?? "")
          : (storedClassMap.get(className) ?? "");
        classRouteMap.set(className, sourceId);
        return { className, sourceId };
      });

      const classSourceOptions: PanelFormOption[] = [...routableOptions];
      const seenClassOptionIds = new Set(routableIds);
      for (const { sourceId } of classRoutes) {
        if (sourceId && !seenClassOptionIds.has(sourceId)) {
          seenClassOptionIds.add(sourceId);
          classSourceOptions.push({
            value: sourceId,
            label: sourceId,
            description: null,
            disabled: true,
            disabledReason: t("panels.dataAdapters.errors.unknownSource", { id: sourceId }),
          });
        }
      }

      const storedRealEdges = new Map((storedMulti?.relationships ?? []).map((r) => [r.forOntoMap, r.realEdge]));
      const incomingRealEdges = incoming
        ? extractIncomingRealEdges(incoming.relationshipRoutes)
        : new Map<string, string>();

      const adapterByType = new Map(sourceAdapters.map((a) => [a.type, a]));
      const sourceAdapterTypeById = new Map<string, string>();
      for (const row of sourceCatalog) {
        if (row.id && !sourceAdapterTypeById.has(row.id)) {
          sourceAdapterTypeById.set(row.id, row.adapterType);
        }
      }

      const relationshipRoutes = ontology.relationships.map((rel) => {
        const from = classRouteMap.get(rel.fromClass)?.trim() || fallbackSource?.id || undefined;
        const to = classRouteMap.get(rel.toClass)?.trim() || fallbackSource?.id || undefined;
        const sameSourceId = from !== undefined && from === to ? from : undefined;
        const crossSource = from !== undefined && to !== undefined && from !== to;
        const sourceType = sameSourceId ? sourceAdapterTypeById.get(sameSourceId) : undefined;
        const isGraph = Boolean(sourceType && adapterByType.get(sourceType)?.requiresJoinFields === false);
        const realEdge = incomingRealEdges.has(rel.name)
          ? incomingRealEdges.get(rel.name)!
          : (storedRealEdges.get(rel.name) ?? "");
        const edgeEditable = isGraph || realEdge.trim().length > 0;
        return {
          relationship: rel.name,
          ends: `${rel.fromClass} → ${rel.toClass}`,
          source: sameSourceId ?? "",
          fromSource: from ?? "",
          toSource: to ?? "",
          crossSource,
          edgeEditable,
          realEdge,
        };
      });
      const anyEdgeEditable = relationshipRoutes.some((row) => row.edgeEditable);

      const classRoutesField: PanelFormField = {
        path: "/classRoutes",
        section: "classRoutes",
        label: t("panels.dataAdapters.fields.classRoutes"),
        required: false,
        readOnly: routableIds.length === 0 || ontology.classNames.length === 0,
        valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
        control: {
          kind: "object-array",
          presentation: "table",
          fixedRows: true,
          reorderable: false,
          itemKeyPath: "/className",
          emptyText: t("panels.dataAdapters.multiSourceNoClasses"),
          itemFields: [
            {
              path: "/className",
              label: t("panels.action.explanation.details.class"),
              required: false,
              readOnly: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: { kind: "text" },
            },
            {
              path: "/sourceId",
              label: t("panels.dataAdapters.test.dataSource"),
              required: false,
              readOnly: routableIds.length === 0,
              refreshOnChange: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "select",
                options: classSourceOptions,
                clearable: true,
                placeholder: fallbackSource ? fallbackSource.id : t("panels.dataAdapters.multiSourceUnrouted"),
              },
            },
          ],
        },
      };

      const relationshipRoutesField: PanelFormField = {
        path: "/relationshipRoutes",
        section: "relationshipRoutes",
        label: t("panels.dataAdapters.fields.relationshipRoutes"),
        required: false,
        readOnly: !anyEdgeEditable || ontology.relationships.length === 0,
        valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
        control: {
          kind: "object-array",
          presentation: "table",
          fixedRows: true,
          reorderable: false,
          itemKeyPath: "/relationship",
          emptyText: t("panels.dataAdapters.multiSourceNoRelationships"),
          itemFields: [
            {
              path: "/relationship",
              label: t("panels.dataAdapters.fields.relationship"),
              required: false,
              readOnly: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: { kind: "text" },
            },
            {
              path: "/ends",
              label: t("panels.dataAdapters.fields.relationshipEnds"),
              required: false,
              readOnly: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: { kind: "text" },
            },
            {
              path: "/source",
              label: t("panels.dataAdapters.test.dataSource"),
              required: false,
              readOnly: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: { kind: "text" },
            },
            {
              path: "/realEdge",
              label: t("panels.dataAdapters.fields.realEdge"),
              required: false,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "text",
                clearable: true,
                placeholder: t("panels.dataAdapters.fields.realEdgePlaceholder"),
              },
            },
          ],
        },
      };

      const sourceCatalogField: PanelFormField = {
        path: "/sourceCatalog",
        label: t("panels.dataAdapters.fields.dataSources"),
        required: false,
        readOnly: false,
        refreshOnChange: true,
        valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.object({ id: z.string(), adapterType: z.string() }))),
        control: { kind: "hidden" },
      };

      const classRoutesHint = routableIds.length === 0
        ? t("panels.dataAdapters.multiSourceNoSources")
        : (fallbackSource
          ? t("panels.dataAdapters.multiSourceSingleFallback", { id: fallbackSource.id })
          : undefined);

      const sections: PanelFormSection[] = [
        {
          key: "classRoutes",
          title: t("panels.dataAdapters.sections.classRoutes"),
          ...(classRoutesHint ? { hint: classRoutesHint } : {}),
        },
        { key: "relationshipRoutes", title: t("panels.dataAdapters.sections.relationshipRoutes") },
      ];

      const values: PanelFormValues = {
        sourceCatalog,
        classRoutes,
        relationshipRoutes,
      };

      return {
        sections,
        fields: [sourceCatalogField, classRoutesField, relationshipRoutesField],
        values,
        errors: [],
        save: {
          method: "POST",
          path: "/api/data-query/businessConfig/useMultiDataSource",
          bodySchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
        },
      };
    },
  };
}

export const dataAdaptersServerOperations: readonly PanelServerOperation[] = [
  {
    handlerRef: SAVE_OP,
    labelKey: "panels.dataAdapters.operations.save",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: DATA_ADAPTER_CONFIG },
    targetType: DATA_ADAPTER_CONFIG,
    targetSchema: dataAdapterTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: saveResultSchema,
    draftInput: (input) => saveInputSchema.parse(input).values,
    async execute(
      host: PanelOperationHost,
      _target: PanelOperationTarget,
      input: Record<string, unknown>,
    ): Promise<SinglePanelOperationOutcome> {
      const locale = host.locale;
      const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
      const { values } = saveInputSchema.parse(input);
      const [config, adaptersData] = await Promise.all([
        readBusinessConfig(host, host.executor.credentials),
        readDataAdapters(host, host.executor.credentials),
      ]);
      const adapters = adaptersData.adapters;
      const adapterMode = typeof values.adapterMode === "string" ? values.adapterMode.trim() : "";
      const selected = adapters.find((a) => a.type === adapterMode);
      if (!selected) {
        const message = t("panels.dataAdapters.errors.adapterNotInstalled", { type: adapterMode || "—" });
        return {
          kind: "refusal",
          code: "INVALID_DATA_ADAPTER",
          message,
          errors: [{ field: "/adapterMode", code: "invalid_option", message }],
        };
      }

      if (adapterMode === multiDataSourceType) {
        const sourceAdapters = adapters.filter((a) => a.type !== multiDataSourceType);
        const adapterByType = new Map(sourceAdapters.map((a) => [a.type, a]));
        const rows = normalizeMultiSourceRowsFromIncoming(values.dataSources, sourceAdapters);

        const errors: FormFieldError[] = [];
        const storedSourcesById = new Map(
          (config.multiDataSource?.dataSources ?? []).map((entry) => [entry.id, entry]),
        );
        const seenIds = new Set<string>();
        const builtSources: DataSourceEntry[] = [];

        if (rows.length === 0) {
          errors.push({
            field: "/dataSources",
            code: "required",
            message: t("panels.dataAdapters.errors.noDataSources"),
          });
        }

        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!;
          const id = row.id.trim();
          if (!id) {
            errors.push({
              field: `/dataSources/${index}/id`,
              code: "required",
              message: t("panels.dataAdapters.errors.sourceIdRequired"),
            });
          } else if (seenIds.has(id)) {
            errors.push({
              field: `/dataSources/${index}/id`,
              code: "already_exists",
              message: t("panels.dataAdapters.errors.duplicateSourceId", { id }),
            });
          } else {
            seenIds.add(id);
          }

          const adapterInfo = adapterByType.get(row.adapter.adapterType);
          if (!adapterInfo) {
            errors.push({
              field: `/dataSources/${index}/adapter/adapterType`,
              code: "invalid_option",
              message: t("panels.dataAdapters.errors.adapterNotInstalled", { type: row.adapter.adapterType || "—" }),
            });
            continue;
          }

          const storedEntry = id ? storedSourcesById.get(id) : undefined;
          const storedConn = storedEntry && storedEntry.adapterType === adapterInfo.type
            ? storedEntry.connection
            : undefined;
          const resolved = resolveConnectionPayload(
            adapterInfo,
            row.adapter.connection,
            storedConn,
            `/dataSources/${index}/adapter/connection`,
            locale,
          );
          errors.push(...resolved.errors);
          builtSources.push({
            id,
            label: row.label,
            adapterType: adapterInfo.type,
            readOnly: row.readOnly,
            connection: resolved.connection,
          });
        }

        if (errors.length > 0) {
          return {
            kind: "refusal",
            code: "INVALID_MULTI_DATA_SOURCE",
            message: errors[0]!.message,
            errors,
          };
        }

        // Submit routes synced from `routingForm` when present, or preserve stored routes so
        // saving data sources never depends on `/admin/getSchema`.
        const classes = Array.isArray(values.classRoutes)
          ? [...extractIncomingClassRoutes(values.classRoutes).entries()].flatMap(([className, rawSourceId]) => {
              const sourceId = rawSourceId.trim();
              return sourceId ? [{ forOntoMap: className, sourceId }] : [];
            })
          : (config.multiDataSource?.classes ?? []).map(({ forOntoMap, sourceId }) => ({ forOntoMap, sourceId }));

        const relationships = Array.isArray(values.relationshipRoutes)
          ? [...extractIncomingRealEdges(values.relationshipRoutes).entries()].flatMap(([name, rawEdge]) => {
              const realEdge = rawEdge.trim();
              return realEdge ? [{ forOntoMap: name, realEdge }] : [];
            })
          : (config.multiDataSource?.relationships ?? []).map(({ forOntoMap, realEdge }) => ({ forOntoMap, realEdge }));

        const definition: MultiDataSourceDefinition = {
          dataSources: builtSources,
          classes,
          relationships,
        };
        const envelope = await ownerPost(host, "/businessConfig/useMultiDataSource", definition, envelopeWithDataSchema);
        if (!envelope.success) {
          const rejection = multiDataSourceRejectionSchema.safeParse(envelope);
          if (rejection.success && rejection.data.data.problems.length > 0) {
            const problems = rejection.data.data.problems;
            const emptyOutline: OntologyOutline = { classNames: [], relationships: [] };
            const mappedErrors = problems.map((problem) => mapMultiSourceProblemToFieldError(problem, rows, emptyOutline));
            const summary = problems.map((p) => `${p.path}: ${p.detail}`).join("; ");
            return {
              kind: "refusal",
              code: "MULTI_DATA_SOURCE_REJECTED",
              message: t("panels.dataAdapters.errors.multiSourceRejected", { details: summary }),
              errors: mappedErrors,
              details: { problems: problems.map((p) => ({ path: p.path, message: p.detail })) },
            };
          }
          return ownerWriteFailure(envelope, "MULTI_DATA_SOURCE_SAVE_FAILED", t("panels.dataAdapters.errors.saveFailed"));
        }

        return savedConfig(multiDataSourceType, envelope.data);
      }

      // Single-source save
      const draftConn = isPlainObject(values.connection) ? values.connection : {};
      const storedConn = config.dataAdapterConnections[selected.type];
      const resolved = resolveConnectionPayload(selected, draftConn, storedConn, "/connection", locale);
      if (resolved.errors.length > 0) {
        return {
          kind: "refusal",
          code: "INVALID_DATA_ADAPTER",
          message: resolved.errors[0]!.message,
          errors: resolved.errors,
        };
      }

      const payload = { type: selected.type, ...resolved.connection };
      const envelope = await ownerPost(host, "/businessConfig/useDataAdapter", payload, envelopeWithDataSchema);
      if (!envelope.success) {
        return ownerWriteFailure(envelope, "DATA_ADAPTER_SAVE_FAILED", t("panels.dataAdapters.errors.saveFailed"));
      }
      return savedConfig(selected.type, envelope.data);
    },
  },
  {
    handlerRef: SAVE_DATA_ADAPTER_ROUTING,
    labelKey: "panels.dataAdapters.operations.saveRouting",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: DATA_ADAPTER_CONFIG },
    targetType: DATA_ADAPTER_CONFIG,
    targetSchema: dataAdapterTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: saveResultSchema,
    draftInput: (input) => saveInputSchema.parse(input).values,
    async execute(
      host: PanelOperationHost,
      _target: PanelOperationTarget,
      input: Record<string, unknown>,
    ): Promise<SinglePanelOperationOutcome> {
      const locale = host.locale;
      const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
      const { values } = saveInputSchema.parse(input);
      const [config, adaptersData, ontology] = await Promise.all([
        readBusinessConfig(host, host.executor.credentials),
        readDataAdapters(host, host.executor.credentials),
        readOntologyOutline(host, host.executor.credentials),
      ]);
      const storedSources: DataSourceEntry[] = (config.multiDataSource?.dataSources ?? []).map((entry) => ({
        id: entry.id,
        label: entry.label,
        adapterType: entry.adapterType,
        readOnly: Boolean(entry.readOnly),
        connection: entry.connection,
      }));
      if (storedSources.length === 0) {
        return {
          kind: "refusal",
          code: "INVALID_MULTI_DATA_SOURCE",
          message: t("panels.dataAdapters.multiSourceSaveSourcesFirst"),
          errors: [],
        };
      }

      const incomingClassRoutes = extractIncomingClassRoutes(values.classRoutes);
      const classes = ontology.classNames.flatMap((className) => {
        const sourceId = incomingClassRoutes.get(className)?.trim() ?? "";
        return sourceId ? [{ forOntoMap: className, sourceId }] : [];
      });

      const incomingRealEdges = extractIncomingRealEdges(values.relationshipRoutes);
      const relationships = ontology.relationships.flatMap(({ name }) => {
        const realEdge = incomingRealEdges.get(name)?.trim() ?? "";
        return realEdge ? [{ forOntoMap: name, realEdge }] : [];
      });

      const definition: MultiDataSourceDefinition = {
        dataSources: storedSources,
        classes,
        relationships,
      };
      const envelope = await ownerPost(host, "/businessConfig/useMultiDataSource", definition, envelopeWithDataSchema);
      if (!envelope.success) {
        const rejection = multiDataSourceRejectionSchema.safeParse(envelope);
        if (rejection.success && rejection.data.data.problems.length > 0) {
          const problems = rejection.data.data.problems;
          const sourceAdapters = adaptersData.adapters.filter((a) => a.type !== multiDataSourceType);
          const rows = normalizeMultiSourceRowsFromStored(config.multiDataSource, sourceAdapters);
          const mappedErrors = problems.map((problem) => mapMultiSourceProblemToFieldError(problem, rows, ontology));
          const summary = problems.map((p) => `${p.path}: ${p.detail}`).join("; ");
          return {
            kind: "refusal",
            code: "MULTI_DATA_SOURCE_REJECTED",
            message: t("panels.dataAdapters.errors.multiSourceRejected", { details: summary }),
            errors: mappedErrors,
            details: { problems: problems.map((p) => ({ path: p.path, message: p.detail })) },
          };
        }
        return ownerWriteFailure(envelope, "MULTI_DATA_SOURCE_SAVE_FAILED", t("panels.dataAdapters.errors.saveFailed"));
      }

      return savedConfig(multiDataSourceType, envelope.data);
    },
  },
  {
    handlerRef: CHECK_DATA_ADAPTER_SANDBOX_PERMISSION,
    labelKey: "panels.dataAdapters.operations.checkSandboxPermission",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: CHECK_DATA_ADAPTER_SANDBOX_PERMISSION },
    targetType: DATA_ADAPTER_CONFIG,
    targetSchema: dataAdapterTargetSchema,
    targetInput: "config",
    targetLabel: async (host) => tForLocale(host.locale, "panels.dataAdapters.sandbox.title"),
    inputSchema: z.object({}).strict(),
    resultSchema: sandboxPermissionResultSchema,
    execute: (host) => checkSandboxPermission(host, SANDBOX_AFFECTED_TYPES),
  },
  {
    handlerRef: TEST_DATA_ADAPTER_CONNECTION,
    labelKey: "panels.dataAdapters.operations.testConnection",
    kind: "action",
    effect: "read",
    batch: false,
    binding: { kind: "PlatformOperation", id: TEST_DATA_ADAPTER_CONNECTION },
    target: { source: "draft" },
    targetSchema: dataAdapterTargetSchema.optional(),
    inputSchema: panelReadOperationInputSchema,
    resultSchema: jsonResultSchema,
    async execute(
      host: PanelOperationHost,
      call: z.infer<typeof panelReadOperationCallSchema>,
    ) {
      const locale = host.locale;
      const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
      const { draft, parameters } = panelReadOperationInputSchema.parse(call.input);
      const { sourceId: rawSourceId } = testParamsSchema.parse(parameters);
      const [config, adaptersData] = await Promise.all([
        readBusinessConfig(host, host.executor.credentials),
        readDataAdapters(host, host.executor.credentials),
      ]);
      const adapters = adaptersData.adapters;
      const adapterMode = typeof draft.adapterMode === "string" && draft.adapterMode.trim()
        ? draft.adapterMode.trim()
        : (config.dataAdapter || adaptersData.currentType);

      let targetAdapter: DataAdapterInfo | undefined;
      let resolvedConn: DataAdapterConnection;
      let testedSourceId: string | undefined;

      if (adapterMode === multiDataSourceType) {
        const sourceAdapters = adapters.filter((a) => a.type !== multiDataSourceType);
        const rows = normalizeMultiSourceRowsFromIncoming(draft.dataSources, sourceAdapters);
        const requestedId = typeof rawSourceId === "string" ? rawSourceId.trim() : "";
        let row: MultiSourceRowDraft | undefined;
        if (requestedId) {
          row = rows.find((item) => item.id.trim() === requestedId);
          if (!row) {
            throw new HttpError(422, t("panels.dataAdapters.errors.unknownSource", { id: requestedId }), "DATA_SOURCE_NOT_FOUND");
          }
        } else if (rows.length === 1 && rows[0]!.id.trim()) {
          row = rows[0]!;
        } else {
          throw new HttpError(422, t("panels.dataAdapters.test.selectSource"), "DATA_SOURCE_REQUIRED");
        }
        testedSourceId = row.id.trim();
        targetAdapter = sourceAdapters.find((a) => a.type === row!.adapter.adapterType);
        if (!targetAdapter) {
          throw new HttpError(
            422,
            t("panels.dataAdapters.errors.adapterNotInstalled", { type: row.adapter.adapterType || "—" }),
            "INVALID_DATA_ADAPTER",
          );
        }
        const storedSource = (config.multiDataSource?.dataSources ?? []).find(
          (entry) => entry.id === testedSourceId && entry.adapterType === targetAdapter!.type,
        );
        const resolved = resolveConnectionPayload(
          targetAdapter,
          row.adapter.connection,
          storedSource?.connection,
          "/connection",
          locale,
        );
        if (resolved.errors.length > 0) {
          throw new HttpError(422, resolved.errors[0]!.message, "INVALID_DATA_ADAPTER");
        }
        resolvedConn = resolved.connection;
      } else {
        targetAdapter = adapters.find((a) => a.type === adapterMode);
        if (!targetAdapter) {
          throw new HttpError(
            422,
            t("panels.dataAdapters.errors.adapterNotInstalled", { type: adapterMode || "—" }),
            "INVALID_DATA_ADAPTER",
          );
        }
        const draftConn = isPlainObject(draft.connection) ? draft.connection : {};
        const storedConn = config.dataAdapterConnections[targetAdapter.type];
        const resolved = resolveConnectionPayload(targetAdapter, draftConn, storedConn, "/connection", locale);
        if (resolved.errors.length > 0) {
          throw new HttpError(422, resolved.errors[0]!.message, "INVALID_DATA_ADAPTER");
        }
        resolvedConn = resolved.connection;
      }

      const payload = { type: targetAdapter.type, ...resolvedConn, ...(testedSourceId ? { sourceId: testedSourceId } : {}) };
      const envelope = await ownerPost(host, "/businessConfig/testDataAdapter", payload, envelopeWithDataSchema);
      if (!envelope.success) {
        throw new HttpError(
          422,
          envelope.message ?? t("panels.dataAdapters.test.failed"),
          "DATA_ADAPTER_TEST_FAILED",
        );
      }
      const report = dataAdapterTestResultSchema.safeParse(envelope.data);
      if (!report.success) {
        throw new HttpError(502, t("panels.dataAdapters.test.invalidReport"), "INVALID_TEST_REPORT");
      }

      return {
        kind: "json" as const,
        value: report.data,
      };
    },
  } satisfies PanelReadServerOperation,
];
