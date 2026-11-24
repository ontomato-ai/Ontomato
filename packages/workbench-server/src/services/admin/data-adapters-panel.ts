import { z } from "zod";
import {
  dataAdapterTestResultSchema,
  multiDataSourceRejectionSchema,
  multiDataSourceType,
  type ConfigurationProblem,
  type DataAdapterConnection,
  type DataAdapterFieldInfo,
  type DataAdapterInfo,
  type DataAdapterTestResult,
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
  DATA_ADAPTER_CONFIG,
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
const SAVE_OP = `${DATA_ADAPTER_CONFIG}.save`;
const SECRET_NAME_RE = /(password|secret|token|private.?key|access.?key|api.?key)/i;

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
const saveResultSchema = z.object({ adapterMode: z.string() }).strict();
const markdownResultSchema = panelReadOperationJsonResultSchema.options[0];
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
      fullWidth: Boolean(info.fullWidth),
    }));
  }
  return (adapter.fields ?? []).map((name) => ({
    name,
    label: null,
    required: false,
    secret: SECRET_NAME_RE.test(name),
    example: adapter.examples?.[name] ?? null,
    fullWidth: false,
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
      label,
      ...(hasSavedSecret ? { help: t("panels.dataAdapters.secretSavedHelp") } : {}),
      required,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(required ? z.string().min(1) : z.string()),
      control: {
        kind: "text",
        secret: true,
        placeholder: hasSavedSecret ? SECRET_MASK : (field.example ?? SECRET_MASK),
      },
    };
  }
  return {
    path,
    ...(section ? { section } : {}),
    label,
    required: field.required,
    readOnly: false,
    valueSchema: cachedZodToRuntimeJsonSchema(field.required ? z.string().min(1) : z.string()),
    control: {
      kind: "text",
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

function extractIncomingRealEdges(rawRoutes: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rawRoutes)) return map;
  for (const row of rawRoutes) {
    if (!isPlainObject(row)) continue;
    const name = typeof row.relationship === "string" ? row.relationship : "";
    if (!name) continue;
    const edgeObj = isPlainObject(row.edge) ? row.edge : null;
    if (edgeObj && typeof edgeObj.realEdge === "string") {
      map.set(name, edgeObj.realEdge);
    } else if (typeof row.realEdge === "string") {
      map.set(name, row.realEdge);
    }
  }
  return map;
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
    if (ontology.classNames.includes(className)) {
      return { field: `/classRoutes/${escapeJsonPointer(className)}`, code: "invalid_option", message };
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
        field: lower.includes("edge") ? `/relationshipRoutes/${relIndex}/edge/realEdge` : `/relationshipRoutes/${relIndex}`,
        code: "invalid_format",
        message,
      };
    }
    return { field: "/relationshipRoutes", code: "invalid_array", message };
  }

  return { field: "/adapterMode", code: "invalid_format", message };
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatTestReportMarkdown(
  report: DataAdapterTestResult,
  adapter: DataAdapterInfo,
  locale?: string,
  sourceId?: string,
): string {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(locale, key, params);
  const lines: string[] = [
    `### ${t("panels.dataAdapters.test.succeeded")}`,
    "",
    `| ${t("panels.dataAdapters.test.colField")} | ${t("panels.dataAdapters.test.colValue")} |`,
    "| --- | --- |",
  ];
  if (sourceId) {
    lines.push(`| ${t("panels.dataAdapters.test.dataSource")} | \`${escapeMarkdownCell(sourceId)}\` |`);
  }
  lines.push(`| ${t("panels.dataAdapters.test.adapter")} | ${escapeMarkdownCell(adapter.label)} (\`${escapeMarkdownCell(adapter.type)}\`) |`);
  lines.push(`| ${t("panels.dataAdapters.test.duration")} | ${report.elapsedMs} ms |`);

  if (report.kind === "catalog") {
    lines.push(`| ${t("panels.dataAdapters.test.database")} | ${escapeMarkdownCell(`${report.databaseProduct} ${report.databaseVersion}`.trim())} |`);
    lines.push(`| ${t("panels.dataAdapters.test.driver")} | ${escapeMarkdownCell(`${report.driverName} ${report.driverVersion}`.trim())} |`);
    if (report.catalog !== null) {
      lines.push(`| ${t("panels.dataAdapters.test.catalog")} | \`${escapeMarkdownCell(report.catalog)}\` |`);
    }
    if (report.schema !== null) {
      lines.push(`| ${t("panels.dataAdapters.test.schema")} | \`${escapeMarkdownCell(report.schema)}\` |`);
    }
    lines.push("", `#### ${t("panels.dataAdapters.test.tablesHeading", { count: report.tables.length })}`, "");
    if (report.tables.length > 0) {
      lines.push(`| ${t("panels.dataAdapters.test.colName")} | ${t("panels.dataAdapters.test.colType")} |`, "| --- | --- |");
      for (const table of report.tables) {
        lines.push(`| \`${escapeMarkdownCell(table.name)}\` | ${escapeMarkdownCell(table.type)} |`);
      }
    } else {
      lines.push(`_${t("panels.dataAdapters.test.noTables")}_`);
    }
  } else {
    const engine = [report.databaseProduct, report.databaseVersion ?? ""].filter(Boolean).join(" ");
    lines.push(`| ${t("panels.dataAdapters.test.searchEngine")} | ${escapeMarkdownCell(engine)} |`);
    if (report.clusterName !== null) {
      lines.push(`| ${t("panels.dataAdapters.test.cluster")} | \`${escapeMarkdownCell(report.clusterName)}\` |`);
    }
    lines.push("", `#### ${t("panels.dataAdapters.test.indicesHeading", { count: report.indices.length })}`, "");
    if (report.indices.length > 0) {
      for (const indexName of report.indices) {
        lines.push(`- \`${escapeMarkdownCell(indexName)}\``);
      }
    } else {
      lines.push(`_${t("panels.dataAdapters.test.noIndices")}_`);
    }
  }

  return lines.join("\n");
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
      return {
        primaryKey: DOMAIN_KEY,
        label: summary.displayName,
        fields: {
          adapterType: summary.currentType || t("panels.dataAdapters.record.unconfigured"),
          displayName: summary.displayName,
          mode: summary.modeLabel,
          summary: summary.summary,
        },
        fieldLabels: {
          adapterType: t("panels.dataAdapters.record.adapterType"),
          displayName: t("panels.dataAdapters.record.displayName"),
          mode: t("panels.dataAdapters.record.mode"),
          summary: t("panels.dataAdapters.record.summary"),
        },
        outputs: {
          currentType: summary.currentType,
          mode: summary.mode,
          configured: summary.mode !== "unconfigured",
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
        const ontology = await readOntologyOutline(host, actor.credentials);
        const sourceAdapters = adapters.filter((a) => a.type !== multiDataSourceType);
        const defaultSourceType = sourceAdapters[0]?.type ?? "";
        const storedMulti = config.multiDataSource;

        const dataSources = !incoming || switchedMode
          ? normalizeMultiSourceRowsFromStored(storedMulti, sourceAdapters)
          : normalizeMultiSourceRowsFromIncoming(incoming.dataSources, sourceAdapters);

        const routableIds = [...new Set(dataSources.map((s) => s.id.trim()).filter((id) => id.length > 0))];
        const routableOptions: PanelFormOption[] = routableIds.map((id) => ({
          value: id,
          label: id,
          description: null,
          disabled: false,
          disabledReason: null,
        }));
        const fallbackSource = dataSources.length === 1 && dataSources[0]!.id.trim()
          ? dataSources[0]!
          : null;

        const storedClassMap = new Map((storedMulti?.classes ?? []).map((c) => [c.forOntoMap, c.sourceId]));
        const incomingClassRoutes = !incoming || switchedMode
          ? undefined
          : (isPlainObject(incoming.classRoutes) ? incoming.classRoutes : undefined);
        const classRoutes: Record<string, string> = {};
        for (const className of ontology.classNames) {
          const candidate = incomingClassRoutes && typeof incomingClassRoutes[className] === "string"
            ? (incomingClassRoutes[className] as string)
            : (incomingClassRoutes ? "" : (storedClassMap.get(className) ?? ""));
          classRoutes[className] = candidate;
        }

        const storedRealEdges = new Map((storedMulti?.relationships ?? []).map((r) => [r.forOntoMap, r.realEdge]));
        const incomingRealEdges = !incoming || switchedMode
          ? new Map<string, string>()
          : extractIncomingRealEdges(incoming.relationshipRoutes);

        const adapterByType = new Map(sourceAdapters.map((a) => [a.type, a]));
        const sourceAdapterTypeById = new Map<string, string>();
        for (const row of dataSources) {
          const trimmedId = row.id.trim();
          if (trimmedId && !sourceAdapterTypeById.has(trimmedId)) {
            sourceAdapterTypeById.set(trimmedId, row.adapter.adapterType);
          }
        }

        const relationshipRoutes = ontology.relationships.map((rel) => {
          const from = classRoutes[rel.fromClass]?.trim() || fallbackSource?.id.trim() || undefined;
          const to = classRoutes[rel.toClass]?.trim() || fallbackSource?.id.trim() || undefined;
          const sameSourceId = from !== undefined && from === to ? from : undefined;
          const crossSource = from !== undefined && to !== undefined && from !== to;
          const sourceType = sameSourceId ? sourceAdapterTypeById.get(sameSourceId) : undefined;
          const isGraph = Boolean(sourceType && adapterByType.get(sourceType)?.requiresJoinFields === false);
          const realEdge = incomingRealEdges.has(rel.name)
            ? incomingRealEdges.get(rel.name)!
            : (storedRealEdges.get(rel.name) ?? "");
          const edgeEditable = isGraph || realEdge.trim().length > 0;
          const sourceSummary = crossSource
            ? t("panels.dataAdapters.multiSourceCrossSourceSummary", { from, to })
            : sameSourceId ?? t("panels.dataAdapters.multiSourceUnrouted");
          return {
            relationship: rel.name,
            ends: `${rel.fromClass} → ${rel.toClass}`,
            sourceSummary,
            edge: {
              mode: edgeEditable ? "editable" : "readonly",
              realEdge,
            },
          };
        });
        const anyEdgeEditable = relationshipRoutes.some((row) => row.edge.mode === "editable");

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
          label: t("panels.dataAdapters.fields.dataSources"),
          help: dataSources.length === 0 ? t("panels.dataAdapters.multiSourceNoSources") : undefined,
          required: true,
          readOnly: false,
          refreshOnChange: true,
          valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
          control: {
            kind: "object-array",
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
                refreshOnChange: true,
                valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
                control: { kind: "text", placeholder: t("panels.dataAdapters.fields.sourceIdPlaceholder") },
              },
              {
                path: "/label",
                label: t("panels.dataAdapters.fields.sourceLabel"),
                required: false,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
                control: { kind: "text" },
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
                label: t("panels.dataAdapters.fields.sourceConnection"),
                required: true,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
                control: {
                  kind: "object",
                  defaultObject: { adapterType: defaultSourceType, connection: {} },
                  variantBy: "/adapterType",
                  fields: [
                    {
                      path: "/adapterType",
                      label: t("panels.dataAdapters.fields.sourceAdapterType"),
                      required: true,
                      readOnly: false,
                      refreshOnChange: true,
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

        const classRouteFields: PanelFormField[] = ontology.classNames.length > 0
          ? ontology.classNames.map((className): PanelFormField => {
            const current = classRoutes[className] ?? "";
            const options: PanelFormOption[] = [...routableOptions];
            if (current && !routableIds.includes(current)) {
              options.push({
                value: current,
                label: current,
                description: null,
                disabled: true,
                disabledReason: t("panels.dataAdapters.errors.unknownSource", { id: current }),
              });
            }
            return {
              path: `/classRoutes/${escapeJsonPointer(className)}`,
              section: "classRoutes",
              label: className,
              required: false,
              readOnly: false,
              refreshOnChange: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "select",
                options,
                placeholder: fallbackSource ? fallbackSource.id.trim() : t("panels.dataAdapters.multiSourceUnrouted"),
              },
            };
          })
          : [
            {
              path: "/classRoutesNotice",
              section: "classRoutes",
              label: t("panels.dataAdapters.fields.classRoutes"),
              required: false,
              readOnly: true,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: { kind: "text" },
            },
          ];

        const relationshipRoutesField: PanelFormField = {
          path: "/relationshipRoutes",
          section: "relationshipRoutes",
          label: t("panels.dataAdapters.fields.relationshipRoutes"),
          help: ontology.relationships.length === 0
            ? t("panels.dataAdapters.multiSourceNoRelationships")
            : undefined,
          required: false,
          readOnly: !anyEdgeEditable || ontology.relationships.length === 0,
          refreshOnChange: anyEdgeEditable,
          valueSchema: cachedZodToRuntimeJsonSchema(z.array(z.record(z.unknown()))),
          control: {
            kind: "object-array",
            itemKeyPath: "/relationship",
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
                path: "/sourceSummary",
                label: t("panels.dataAdapters.fields.relationshipSource"),
                required: false,
                readOnly: true,
                valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
                control: { kind: "text" },
              },
              {
                path: "/edge",
                label: t("panels.dataAdapters.fields.realEdgeSection"),
                required: true,
                readOnly: false,
                valueSchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
                control: {
                  kind: "object",
                  defaultObject: { mode: "readonly", realEdge: "" },
                  variantBy: "/mode",
                  fields: [
                    {
                      path: "/mode",
                      label: t("panels.dataAdapters.fields.edgeMode"),
                      required: true,
                      readOnly: true,
                      valueSchema: cachedZodToRuntimeJsonSchema(z.enum(["editable", "readonly"])),
                      control: {
                        kind: "select",
                        options: [
                          {
                            value: "editable",
                            label: t("panels.dataAdapters.edgeMode.editable"),
                            description: null,
                            disabled: false,
                            disabledReason: null,
                          },
                          {
                            value: "readonly",
                            label: t("panels.dataAdapters.edgeMode.readonly"),
                            description: null,
                            disabled: false,
                            disabledReason: null,
                          },
                        ],
                      },
                    },
                  ],
                  variants: {
                    editable: [
                      {
                        path: "/realEdge",
                        label: t("panels.dataAdapters.fields.realEdge"),
                        required: false,
                        readOnly: false,
                        valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
                        control: {
                          kind: "text",
                          placeholder: t("panels.dataAdapters.fields.realEdgePlaceholder"),
                        },
                      },
                    ],
                    readonly: [
                      {
                        path: "/realEdge",
                        label: t("panels.dataAdapters.fields.realEdge"),
                        required: false,
                        readOnly: true,
                        readOnlyReason: t("panels.dataAdapters.fields.realEdgeReadOnlyReason"),
                        valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
                        control: { kind: "text" },
                      },
                    ],
                  },
                },
              },
            ],
          },
        };

        const sections: PanelFormSection[] = [
          { key: "mode", title: t("panels.dataAdapters.sections.mode") },
          { key: "dataSources", title: t("panels.dataAdapters.sections.dataSources") },
          {
            key: "classRoutes",
            title: t("panels.dataAdapters.sections.classRoutes"),
            ...(fallbackSource
              ? { hint: t("panels.dataAdapters.multiSourceSingleFallback", { id: fallbackSource.id.trim() }) }
              : {}),
          },
          { key: "relationshipRoutes", title: t("panels.dataAdapters.sections.relationshipRoutes") },
        ];

        const values: PanelFormValues = {
          adapterMode: multiDataSourceType,
          dataSources,
          ...(ontology.classNames.length > 0
            ? { classRoutes }
            : { classRoutesNotice: t("panels.dataAdapters.multiSourceNoClasses") }),
          relationshipRoutes,
        };

        return {
          sections,
          fields: [modeField, dataSourcesField, ...classRouteFields, relationshipRoutesField],
          values,
          errors: [],
          save: {
            method: "POST",
            path: "/api/data-query/businessConfig/useMultiDataSource",
            bodySchema: cachedZodToRuntimeJsonSchema(z.record(z.unknown())),
          },
        };
      }

      // Single-source mode
      const selectedAdapter = adapters.find((a) => a.type === adapterMode);
      const storedConn = config.dataAdapterConnections[adapterMode];
      const connectionValues = !incoming || switchedMode
        ? storedConnectionToFormValues(selectedAdapter, storedConn)
        : sanitizeIncomingConnectionValues(
          selectedAdapter,
          isPlainObject(incoming.connection) ? incoming.connection : undefined,
        );

      const connectionFields = selectedAdapter
        ? normalizeAdapterFields(selectedAdapter).map((field) =>
          buildConnectionField(
            field,
            `/connection/${escapeJsonPointer(field.name)}`,
            field.secret && hasSavedSecretValue(storedConn, field.name),
            locale,
            "connection",
          ),
        )
        : [];

      const sections: PanelFormSection[] = [
        { key: "mode", title: t("panels.dataAdapters.sections.mode") },
        ...(selectedAdapter && connectionFields.length > 0
          ? [{ key: "connection", title: selectedAdapter.label }]
          : []),
      ];

      const errors = incoming && !switchedMode && selectedAdapter
        ? resolveConnectionPayload(selectedAdapter, connectionValues, storedConn, "/connection", locale).errors
        : [];

      return {
        sections,
        fields: [modeField, ...connectionFields],
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
        const ontology = await readOntologyOutline(host, host.executor.credentials);
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

        const rawClassRoutes = isPlainObject(values.classRoutes) ? values.classRoutes : {};
        const classes = ontology.classNames.flatMap((className) => {
          const sourceId = typeof rawClassRoutes[className] === "string" ? (rawClassRoutes[className] as string).trim() : "";
          return sourceId ? [{ forOntoMap: className, sourceId }] : [];
        });

        const incomingRealEdges = extractIncomingRealEdges(values.relationshipRoutes);
        const relationships = ontology.relationships.flatMap(({ name }) => {
          const realEdge = incomingRealEdges.get(name)?.trim() ?? "";
          return realEdge ? [{ forOntoMap: name, realEdge }] : [];
        });

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
            const mappedErrors = problems.map((problem) => mapMultiSourceProblemToFieldError(problem, rows, ontology));
            const summary = problems.map((p) => `${p.path}: ${p.detail}`).join("; ");
            return {
              kind: "refusal",
              code: "MULTI_DATA_SOURCE_REJECTED",
              message: t("panels.dataAdapters.errors.multiSourceRejected", { details: summary }),
              errors: mappedErrors,
            };
          }
          return ownerWriteFailure(envelope, "MULTI_DATA_SOURCE_SAVE_FAILED", t("panels.dataAdapters.errors.saveFailed"));
        }

        return {
          kind: "success",
          data: { adapterMode: multiDataSourceType },
          affected: affected(DATA_ADAPTER_CONFIG, DOMAIN_KEY, [DATA_ADAPTER_CONFIG]),
        };
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
      return {
        kind: "success",
        data: { adapterMode: selected.type },
        affected: affected(DATA_ADAPTER_CONFIG, DOMAIN_KEY, [DATA_ADAPTER_CONFIG]),
      };
    },
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
    resultSchema: markdownResultSchema,
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

      const payload = { type: targetAdapter.type, ...resolvedConn };
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
        kind: "markdown" as const,
        markdown: formatTestReportMarkdown(report.data, targetAdapter, locale, testedSourceId),
      };
    },
  } satisfies PanelReadServerOperation,
];
