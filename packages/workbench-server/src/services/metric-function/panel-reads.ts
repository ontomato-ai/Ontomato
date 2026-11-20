import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { dashboardMetricDescriptionSchema, dashboardMetricOutputSchema, type DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { FUNCTION, METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import { panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import {
  panelFormDescriptionSchema, type PanelFormDescription, type PanelFormValues, type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";

/*
 * The metric and function owners' named reads for a panel, each read as the viewer. Both catalogues read the owner's
 * list, one record and its definition form, for a saved object or a new one; the data engine answers the display names,
 * labels and form in the reader's language, and the column names are this owner's text.
 *
 * A metric also reads its `result`: it runs one selected metric and answers its output, the metric's declared columns,
 * its rows, and the truncation that marks a partial result. The owner's query surface judges everything: whether the
 * reader may run the metric, the reader's data permissions, and the parameter values against the metric's current
 * definition. A metric runs at the revision its description names, so a definition changed between the two calls is the
 * owner's conflict rather than rows of another definition.
 */

/** The values of a result read, each named by the metric's own parameter it fills. */
export type MetricResultParams = Readonly<Record<string, RuntimeJsonValue>>;

/** A definition form's values to check or recompute; without them, the owner's opening form. */
export interface DefinitionFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

const metricSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  statusLabel: z.string().nullish(),
  originLabel: z.string().nullish(),
  createdByName: z.string().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
  modifyTimestamp: z.number().nullish(),
}).passthrough();
const functionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  operationLabel: z.string().nullish(),
}).passthrough();

/**
 * An object chosen in a panel fills a metric parameter with its primary key, and a checked list of objects with their
 * keys in order; any other value goes as it is.
 */
function parameterValue(value: RuntimeJsonValue): RuntimeJsonValue {
  if (Array.isArray(value)) return value.map(parameterValue);
  const object = panelObjectRefSchema.safeParse(value);
  return object.success ? object.data.primaryKey : value;
}

/** A negative owner answer to a read: an object it no longer has is missing, its other refusals conflict, the rest fail. */
function readRefusal(envelope: z.infer<typeof ownerEnvelopeSchema>, failureCode: string, fallbackMessage: string): HttpError {
  const outcome = ownerWriteFailure(envelope, failureCode, fallbackMessage);
  if (outcome.kind === "failure") return new HttpError(500, outcome.message, outcome.code);
  return new HttpError(outcome.code.endsWith("_NOT_FOUND") ? 404 : 409, outcome.message, outcome.code);
}

function ownerReads(viewer: AssistantCredentials, failureCode: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const translate = (key: string) => tForLocale(viewer.locale, key);
  /** One data-query read: the owner's data, or its refusal or failure as an error. */
  async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
    if (!envelope.success) throw readRefusal(envelope, failureCode, "The owner could not read the definition");
    return schema.parse(envelope.data);
  }
  /** The column names, in the reader's language, for the fields a record shows. */
  const fieldLabels = (type: string, fields: readonly string[]) =>
    Object.fromEntries(fields.map(field => [field, translate(`panels.${type}.fields.${field}`)]));
  /** The owner's form for a saved definition, or for a new one when there is no primary key. */
  function form(
    name: string, path: string, objectType: string, primaryKey: string | null, { values, changedField }: DefinitionFormParams,
  ) {
    return owner(name, path, {
      target: primaryKey === null ? { kind: "draft" } : { kind: "object", objectType, primaryKey },
      ...(values !== undefined && { values }),
      changedField: changedField ?? null,
    }, panelFormDescriptionSchema);
  }
  return { owner, fieldLabels, form };
}

const METRIC_FIELDS = ["function", "origin", "status", "createdBy", "reviewedBy", "modified"] as const;

function metricRecord(metric: z.infer<typeof metricSchema>, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: metric.id,
    label: metric.name,
    ...(metric.description ? { subtitle: metric.description } : {}),
    fieldLabels,
    fields: {
      function: metric.function?.name ?? "",
      origin: metric.originLabel ?? "",
      status: metric.statusLabel ?? "",
      createdBy: metric.createdByName ?? "",
      reviewedBy: metric.reviewedByName ?? "",
      modified: typeof metric.modifyTimestamp === "number" ? new Date(metric.modifyTimestamp).toISOString() : "",
    },
  };
}

export function createMetricReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const { owner, fieldLabels, form } = ownerReads(viewer, "METRIC_VIEW_READ_FAILED");
  const labels = () => fieldLabels("metricView", METRIC_FIELDS);
  // A failed run is the owner's answer, not a transport fault worth running the query again for.
  const runOptions = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  async function query<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await backendPost(name, base + path, body, runOptions);
    return schema.parse(JSON.parse(response.text));
  }
  return {
    async list(): Promise<PanelRecord[]> {
      const columns = labels();
      return (await owner("metric-list", "/metricView/queryList", {}, z.array(metricSchema))).map(metric => metricRecord(metric, columns));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return metricRecord(await owner("metric-record", "/metricView/queryById", { id: primaryKey }, metricSchema), labels());
    },
    form(primaryKey: string, params: DefinitionFormParams): Promise<PanelFormDescription> {
      return form("metric-form", "/metricView/form", METRIC_VIEW, primaryKey, params);
    },
    createForm(params: DefinitionFormParams): Promise<PanelFormDescription> {
      return form("metric-form", "/metricView/form", METRIC_VIEW, null, params);
    },
    async result(primaryKey: string, params: MetricResultParams): Promise<DashboardMetricOutput> {
      const { revision } = await query(
        "metric-describe", "/ontology/query/metrics/describe", { id: primaryKey }, dashboardMetricDescriptionSchema,
      );
      const parameters = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, parameterValue(value)]));
      return query(
        "metric-execute", "/ontology/query/metrics/execute", { id: primaryKey, revision, parameters }, dashboardMetricOutputSchema,
      );
    },
  };
}

function functionRecord(fn: z.infer<typeof functionSchema>, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: fn.id,
    label: fn.name,
    ...(fn.description ? { subtitle: fn.description } : {}),
    fieldLabels,
    fields: { operation: fn.operationLabel ?? "" },
  };
}

export function createFunctionReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const { owner, fieldLabels, form } = ownerReads(viewer, "FUNCTION_READ_FAILED");
  const labels = () => fieldLabels("function", ["operation"]);
  return {
    async list(): Promise<PanelRecord[]> {
      const columns = labels();
      return (await owner("function-list", "/function/queryList", {}, z.array(functionSchema))).map(fn => functionRecord(fn, columns));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return functionRecord(await owner("function-record", "/function/queryById", { id: primaryKey }, functionSchema), labels());
    },
    form(primaryKey: string, params: DefinitionFormParams): Promise<PanelFormDescription> {
      return form("function-form", "/function/form", FUNCTION, primaryKey, params);
    },
    createForm(params: DefinitionFormParams): Promise<PanelFormDescription> {
      return form("function-form", "/function/form", FUNCTION, null, params);
    },
  };
}
