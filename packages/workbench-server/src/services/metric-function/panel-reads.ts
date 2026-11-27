import { presentedRegisteredDataRead, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { dashboardMetricDescriptionSchema, dashboardMetricOutputSchema, type DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { FUNCTION, METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import {
  panelFormDescriptionSchema, panelReadParameterSchemas, type PanelFormValues, type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/service-authentication";
import { metricResultParameters } from "./result-read";

/*
 * The metric and function owners' named reads for a panel, each read as the viewer. Both catalogues query the owner's
 * list, searched and paged here as the business knowledge list is, read one record and its definition form, for a saved
 * object or a new one; the data engine answers the display names, labels and form in the reader's language, and the
 * column names are this owner's text.
 *
 * A metric also reads its `result`: it runs one selected metric and answers its output, the metric's declared columns,
 * its rows, and the truncation that marks a partial result. The owner's query surface judges everything: whether the
 * reader may run the metric, the reader's data permissions, and the parameter values against the metric's current
 * definition. A metric runs at the revision its description names, so a definition changed between the two calls is the
 * owner's conflict rather than rows of another definition.
 */

/** The values of a result read, each named by the metric's own parameter it fills. */
export type MetricResultParams = Readonly<Record<string, RuntimeJsonValue>>;

const catalogueQuerySchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  cursor: panelReadParameterSchemas.cursor.optional(),
  size: panelReadParameterSchemas.size.optional(),
}).strict();

const metricCatalogueQuerySchema = catalogueQuerySchema.extend({
  status: panelReadParameterSchemas.metricViewStatus.optional(),
  origin: panelReadParameterSchemas.metricViewOrigin.optional(),
}).strict();

const metricCatalogueListSchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  status: panelReadParameterSchemas.metricViewStatus.optional(),
  origin: panelReadParameterSchemas.metricViewOrigin.optional(),
}).strict();

const functionCatalogueQuerySchema = catalogueQuerySchema.extend({
  operation: panelReadParameterSchemas.functionOperation.optional(),
}).strict();

const functionCatalogueListSchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  operation: panelReadParameterSchemas.functionOperation.optional(),
}).strict();

/**
 * The records a search keeps, matching name or description in any case, from the offset the cursor names, at most `size`
 * of them, with the total the search keeps. The owner answers its whole domain list, so the query reads it once.
 */
function queried(records: readonly PanelRecord[], { search, cursor, size }: z.infer<typeof catalogueQuerySchema>): PanelRecordQuery {
  // A cursor is the decimal offset this query answered as nextCursor.
  if (cursor !== undefined && !/^\d+$/.test(cursor))
    throw new HttpError(400, "The cursor does not name a position in the list", "INVALID_CURSOR");
  const offset = cursor === undefined ? 0 : Number(cursor);
  const term = search?.trim().toLowerCase();
  const kept = term ? records.filter(record => `${record.label} ${record.subtitle ?? ""}`.toLowerCase().includes(term)) : records;
  return {
    rows: kept.slice(offset, size === undefined ? undefined : offset + size),
    ...(size !== undefined && offset + size < kept.length ? { nextCursor: String(offset + size) } : {}),
    total: kept.length,
  };
}

/** A definition form's values to check or recompute; without them, the owner's opening form. */
export interface DefinitionFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

const metricSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  statusLabel: z.string().nullish(),
  originLabel: z.string().nullish(),
  createdByName: z.string().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
  modifyTimestamp: z.number().nullish(),
}).passthrough();
const countSchema = z.object({ total: z.number().int().nonnegative() }).strict();
const functionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  operationLabel: z.string().nullish(),
}).passthrough();

/** A negative owner answer to a read: an object it no longer has is missing, its other refusals conflict, the rest fail. */
function readRefusal(envelope: z.infer<typeof ownerEnvelopeSchema>, failureCode: string, fallbackMessage: string): HttpError {
  const outcome = ownerWriteFailure(envelope, failureCode, fallbackMessage);
  if (outcome.kind === "failure") return new HttpError(500, outcome.message, outcome.code);
  return new HttpError(outcome.code.endsWith("_NOT_FOUND") ? 404 : 409, outcome.message, outcome.code);
}

function ownerReads(viewer: AssistantCredentials, failureCode: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  /** One data-query read: the owner's data, or its refusal or failure as an error. */
  async function owner(name: string, path: string, body: unknown): Promise<unknown> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
    if (!envelope.success) throw readRefusal(envelope, failureCode, "The owner could not read the definition");
    return envelope.data;
  }
  /** The owner's form for a saved definition, or for a new one when there is no primary key. */
  function form(
    name: string, path: string, objectType: string, primaryKey: string | null, { values, changedField }: DefinitionFormParams,
  ) {
    return owner(name, path, {
      target: primaryKey === null ? { kind: "draft" } : { kind: "object", objectType, primaryKey },
      ...(values !== undefined && { values }),
      changedField: changedField ?? null,
    });
  }
  return { owner, form };
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
    // The page always coloured the status: published green, pending review amber, anything else grey.
    tones: { status: metric.status === "PUBLISHED" ? "success" : metric.status === "PENDING_REVIEW" ? "warning" : "info" },
  };
}

type CataloguePaging = z.infer<typeof catalogueQuerySchema>;

function fieldLabels(type: string, fields: readonly string[], locale?: string) {
  return Object.fromEntries(fields.map(field => [field, tForLocale(locale, `panels.${type}.fields.${field}`)]));
}

const presentForm = (payload: unknown) => panelFormDescriptionSchema.parse(payload);

/** Presents successful metric payloads with the search and paging prepared for the read. */
export function createMetricPanelReadPresenter(locale?: string) {
  const labels = () => fieldLabels("metricView", METRIC_FIELDS, locale);
  function query(payload: unknown, paging: CataloguePaging): PanelRecordQuery {
    const columns = labels();
    return queried(z.array(metricSchema).parse(payload).map(metric => metricRecord(metric, columns)), paging);
  }
  return {
    list: (payload: unknown, { search }: Pick<CataloguePaging, "search">) => query(payload, { search }),
    query,
    record: (payload: unknown) => metricRecord(metricSchema.parse(payload), labels()),
    form: presentForm,
    createForm: presentForm,
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

function presentFunctionCatalogue(payload: unknown, paging: CataloguePaging, locale?: string): PanelRecordQuery {
  const labels = fieldLabels("function", ["operation"], locale);
  return queried(z.array(functionSchema).parse(payload).map(fn => functionRecord(fn, labels)), paging);
}

/** Presents successful function payloads with the search prepared for the read. */
export function createFunctionPanelReadPresenter(locale?: string) {
  return {
    list: (payload: unknown, { search }: Pick<CataloguePaging, "search">) => presentFunctionCatalogue(payload, { search }, locale),
    query: (payload: unknown, paging: CataloguePaging) => presentFunctionCatalogue(payload, paging, locale),
    record: (payload: unknown) => functionRecord(functionSchema.parse(payload), fieldLabels("function", ["operation"], locale)),
    form: presentForm,
    createForm: presentForm,
  };
}


export const metricFunctionDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["list", "record", "form", "createForm"] as const).map(method =>
    presentedRegisteredDataRead(FUNCTION, method, createFunctionPanelReadPresenter, undefined,
      method === "record" ? { messageOnlyCodes: ["FUNCTION_NOT_FOUND"] } : undefined)),
  presentedRegisteredDataRead(FUNCTION, "query", createFunctionPanelReadPresenter, undefined, undefined,
    ({ params }) => ({ type: FUNCTION, name: "list", parameters: { ...(params.operation !== undefined && { operation: params.operation }) } })),
  ...(["list", "query", "record", "form", "createForm"] as const).map(method =>
    presentedRegisteredDataRead(METRIC_VIEW, method, createMetricPanelReadPresenter, undefined,
      method === "record" ? { messageOnlyCodes: ["METRIC_VIEW_NOT_FOUND"] } : undefined)),
];
