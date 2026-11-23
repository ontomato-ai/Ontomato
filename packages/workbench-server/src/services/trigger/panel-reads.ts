import { z } from "zod";
import { DELETE_TRIGGER, SET_TRIGGER_STATUS, TRIGGER } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  panelFormDescriptionSchema, panelReadParameterSchemas, type PanelFormDescription, type PanelFormValues,
  type PanelRecord, type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";
import { describeServerOperation, panelServerOperation } from "../product-panels/server-operations";

/*
 * The trigger catalogue's named reads for a direct panel, read as the viewer: the full list, the searched and paged
 * query, one trigger as a record, and the owner's definition form for an existing trigger or a new draft. The data
 * engine answers display names, cadence wording and form fields in the reader's language; column names come from this
 * server's locale table.
 */

const TRIGGER_FIELDS = [
  "status", "enabled", "condition", "timeZone", "effect", "executor",
  "nextRunAt", "lastFiredAt", "createdBy", "reviewedBy", "updatedAt",
] as const;

const triggerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  statusLabel: z.string().nullish(),
  enabled: z.boolean().nullish(),
  conditionKindLabel: z.string().nullish(),
  cadenceSummary: z.string().nullish(),
  condition: z.object({ timeZone: z.string().nullish() }).passthrough().nullish(),
  effectLabel: z.string().nullish(),
  executor: z.string().nullish(),
  executorName: z.string().nullish(),
  nextRunAt: z.string().nullish(),
  lastFiredAt: z.string().nullish(),
  createdByName: z.string().nullish(),
  reviewedByName: z.string().nullish(),
  modifyTimestamp: z.number().nullish(),
}).passthrough();
type TriggerAsset = z.infer<typeof triggerSchema>;

const catalogueQuerySchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  cursor: panelReadParameterSchemas.cursor.optional(),
  size: panelReadParameterSchemas.size.optional(),
}).strict();

export interface TriggerFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

function statusTone(status: string | null | undefined): "success" | "warning" | "info" {
  if (status === "PUBLISHED") return "success";
  if (status === "PENDING_REVIEW") return "warning";
  return "info";
}

function triggerRecord(trigger: TriggerAsset, fieldLabels: Record<string, string>): PanelRecord {
  const enabled = Boolean(trigger.enabled);
  return {
    primaryKey: trigger.id,
    label: trigger.name,
    ...(trigger.description ? { subtitle: trigger.description } : {}),
    fieldLabels,
    fields: {
      status: trigger.statusLabel ?? trigger.status ?? "",
      enabled,
      condition: trigger.cadenceSummary ?? trigger.conditionKindLabel ?? "",
      timeZone: trigger.condition?.timeZone ?? "",
      effect: trigger.effectLabel ?? "",
      executor: trigger.executorName ?? trigger.executor ?? "",
      nextRunAt: trigger.nextRunAt ?? "",
      lastFiredAt: trigger.lastFiredAt ?? "",
      createdBy: trigger.createdByName ?? "",
      reviewedBy: trigger.reviewedByName ?? "",
      updatedAt: typeof trigger.modifyTimestamp === "number" ? new Date(trigger.modifyTimestamp).toISOString() : "",
    },
    tones: {
      status: statusTone(trigger.status),
      enabled: enabled ? "success" : "info",
    },
  };
}

function queried(records: readonly PanelRecord[], params: Record<string, unknown>): PanelRecordQuery {
  const { search, cursor, size } = catalogueQuerySchema.parse(params);
  if (cursor !== undefined && !/^\d+$/.test(cursor))
    throw new HttpError(400, "The cursor does not name a position in the list", "INVALID_CURSOR");
  const offset = cursor === undefined ? 0 : Number(cursor);
  const term = search?.trim().toLowerCase();
  const kept = term
    ? records.filter(record => [
      record.label,
      record.subtitle ?? "",
      String(record.fields.condition ?? ""),
      String(record.fields.effect ?? ""),
      String(record.fields.executor ?? ""),
    ].join(" ").toLowerCase().includes(term))
    : records;
  return {
    rows: kept.slice(offset, size === undefined ? undefined : offset + size),
    ...(size !== undefined && offset + size < kept.length ? { nextCursor: String(offset + size) } : {}),
    total: kept.length,
  };
}

function triggerReadStatus(code: string): number {
  if (code === "TRIGGER_NOT_GRANTED" || code === "FORBIDDEN") return 403;
  if (code === "TRIGGER_NOT_FOUND") return 404;
  return 409;
}

function triggerOwner(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  return async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
    if (!envelope.success) {
      const outcome = ownerWriteFailure(envelope, "TRIGGER_READ_FAILED", "The owner could not read the triggers");
      throw new HttpError(outcome.kind === "failure" ? 500 : triggerReadStatus(outcome.code), outcome.message, outcome.code);
    }
    return schema.parse(envelope.data);
  };
}

export function createTriggerReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const owner = triggerOwner(viewer);
  const translate = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => Object.fromEntries(
    TRIGGER_FIELDS.map(name => [name, translate(`panels.trigger.fields.${name}`)]),
  );
  function definitionForm(name: string, target: PanelFormTarget, { values, changedField }: TriggerFormParams) {
    return owner(name, "/trigger/form", {
      target, ...(values !== undefined && { values }), changedField: changedField ?? null,
    }, panelFormDescriptionSchema);
  }
  async function list(): Promise<PanelRecord[]> {
    const labels = fieldLabels();
    return (await owner("trigger-list", "/trigger/queryList", {}, z.array(triggerSchema)))
      .map(trigger => triggerRecord(trigger, labels));
  }
  return {
    list,
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      return queried(await list(), params);
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return triggerRecord(await owner("trigger-record", "/trigger/queryById", { id: primaryKey }, triggerSchema), fieldLabels());
    },
    async form(primaryKey: string, params: TriggerFormParams): Promise<PanelFormDescription> {
      return definitionForm("trigger-form", { kind: "object", objectType: TRIGGER, primaryKey }, params);
    },
    async createForm(params: TriggerFormParams): Promise<PanelFormDescription> {
      return definitionForm("trigger-create-form", { kind: "draft" }, params);
    },
    [`${SET_TRIGGER_STATUS}.describe`]() {
      return describeServerOperation(panelServerOperation(SET_TRIGGER_STATUS), viewer.locale);
    },
    [`${DELETE_TRIGGER}.describe`]() {
      return describeServerOperation(panelServerOperation(DELETE_TRIGGER), viewer.locale);
    },
  };
}
