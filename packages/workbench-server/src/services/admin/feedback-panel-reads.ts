import { z } from "zod";
import { panelDownloadReceiptSchema } from "@ontomato/contracts/panel-download";
import { panelReadOperationJsonResultSchema } from "@ontomato/contracts/panel-operations";
import { EXPORT_FEEDBACK, FEEDBACK_RECORD } from "@ontomato/contracts/platform-object-types";
import type { FeedbackRecord } from "@ontomato/contracts/feedback";
import { panelReadParameterSchemas, type PanelGroupCounts, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { PanelReadServerOperation } from "../product-panels/server-operations";
import { localReadRegistration, managedRegisteredOpsRead, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import type { ProductOwner } from "../product-governance/service-authentication";
import { countFeedback, listFeedback } from "./feedback-store";
import { exportFeedback, feedbackExportTimeZone } from "./feedback-export";

/*
 * The feedback owner's named reads for direct panels: queried list, ordered filter counts, and single record lookup.
 * Reads delegate filtering, keyword matching, and localized labels to `feedback-store` under the feedback management boundary.
 */

const queryInputSchema = z.object({
  search: z.string().optional(),
  sourceType: panelReadParameterSchemas.feedbackSourceType.optional(),
  rating: panelReadParameterSchemas.feedbackRating.optional(),
  page: panelReadParameterSchemas.page.optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  size: z.number().int().positive().optional(),
}).strict();

const countsInputSchema = z.object({
  by: panelReadParameterSchemas.feedbackCountField,
  search: z.string().optional(),
  sourceType: panelReadParameterSchemas.feedbackSourceType.optional(),
  rating: panelReadParameterSchemas.feedbackRating.optional(),
}).strict();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW_MAX_LENGTH = 80;

/** Collapses whitespace and truncates long feedback text to an 80-character table preview. */
function previewText(text?: string): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > PREVIEW_MAX_LENGTH ? `${normalized.slice(0, PREVIEW_MAX_LENGTH)}…` : normalized;
}

function feedbackRow(record: FeedbackRecord, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: record.id,
    label: record.feedbackText || record.userInput || record.id,
    subtitle: `${record.sourceTypeLabel} · ${record.ratingLabel}`,
    fieldLabels,
    fields: {
      sourceType: record.sourceTypeLabel,
      // Value-carried tag tone (green for like, red for dislike) without a separate sidecar map.
      rating: {
        kind: "tag",
        label: record.ratingLabel,
        tone: record.rating === "like" ? "success" : "danger",
      },
      userId: record.userName || record.userId,
      userInput: record.userInput ?? "",
      userInputPreview: previewText(record.userInput),
      assistantOutput: record.assistantOutput ?? "",
      assistantOutputPreview: previewText(record.assistantOutput),
      feedbackText: record.feedbackText ?? "",
      feedbackTextPreview: previewText(record.feedbackText),
      turnKey: record.turnKey,
      relatedId: record.taskId || record.threadId || record.targetId,
      updatedAt: new Date(record.updatedAt).toISOString(),
    },
  };
}

function feedbackReads(owner: ProductOwner, locale: string | undefined, requireAccess: () => Promise<void> | void) {
  const t = (key: string) => tForLocale(locale, key);
  const fieldLabels = () => ({
    sourceType: t("api.feedback.filters.sourceType"),
    rating: t("api.feedback.filters.rating"),
    userId: t("api.feedbackExport.columns.user"),
    userInput: t("api.feedbackExport.columns.input"),
    userInputPreview: t("api.feedbackExport.columns.input"),
    assistantOutput: t("api.feedbackExport.columns.output"),
    assistantOutputPreview: t("api.feedbackExport.columns.output"),
    feedbackText: t("api.feedbackExport.columns.feedback"),
    feedbackTextPreview: t("api.feedbackExport.columns.feedback"),
    turnKey: t("api.feedbackExport.columns.turnKey"),
    relatedId: t("api.feedbackExport.columns.relatedId"),
    updatedAt: t("api.feedbackExport.columns.updatedAt"),
  });

  return {
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      await requireAccess();
      const { search, sourceType, rating, page: pageParam, cursor, size } = queryInputSchema.parse(params);
      const effectiveSize = pageParam?.size ?? size;
      const offset = pageParam
        ? (pageParam.number - 1) * pageParam.size
        : (cursor === undefined ? 0 : Number(cursor));
      const page = await listFeedback({
        domainId: owner.domainId,
        keyword: search || undefined,
        sourceType: sourceType && sourceType !== "all" ? sourceType : undefined,
        rating: rating && rating !== "all" ? rating : undefined,
        limit: effectiveSize,
        offset,
        locale,
      });
      const labels = fieldLabels();
      return {
        rows: page.records.map((item) => feedbackRow(item, labels)),
        ...(offset + page.limit < page.total ? { nextCursor: String(offset + page.limit) } : {}),
        total: page.total,
      };
    },

    async counts(params: Record<string, unknown>): Promise<PanelGroupCounts> {
      await requireAccess();
      const { by, search, sourceType, rating } = countsInputSchema.parse(params);
      const grouped = await countFeedback({
        domainId: owner.domainId,
        by,
        keyword: search || undefined,
        sourceType: sourceType && sourceType !== "all" ? sourceType : undefined,
        rating: rating && rating !== "all" ? rating : undefined,
      });
      const keys = by === "sourceType" ? (["qa", "analysis_task"] as const) : (["like", "dislike"] as const);
      const prefix = by === "sourceType" ? "api.feedback.sources" : "api.feedback.ratings";
      const total = keys.reduce((sum, key) => sum + (grouped[key] ?? 0), 0);
      return [
        { key: "all", label: t("panels.feedback.all"), count: total },
        ...keys.map((key) => ({ key, label: t(`${prefix}.${key}`), count: grouped[key] ?? 0 })),
      ];
    },

    async record(primaryKey: string): Promise<PanelRecord> {
      await requireAccess();
      if (!UUID_PATTERN.test(primaryKey)) throw new HttpError(400, "Invalid feedback ID", "INVALID_REQUEST");
      const page = await listFeedback({
        domainId: owner.domainId,
        feedbackId: primaryKey,
        all: true,
        locale,
      });
      const found = page.records[0];
      if (!found) throw new HttpError(404, "Feedback record not found", "NOT_FOUND");
      return feedbackRow(found, fieldLabels());
    },
  };
}

export function createFeedbackReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  return feedbackReads(owner, viewer.locale, () => assertManagement(workbenchManagement.feedbackRead, owner, viewer));
}

export function createRegisteredFeedbackReadAdapter(owner: ProductOwner, locale: string | undefined, javaFacts: unknown) {
  return feedbackReads(owner, locale, () => {
    if (javaFacts !== workbenchManagement.feedbackRead.id)
      throw new HttpError(502, "Invalid feedback read approval", "PANEL_READ_OWNER_RESPONSE_INVALID");
  });
}

const exportInputSchema = queryInputSchema.pick({ search: true, sourceType: true, rating: true })
  .extend({ timeZone: z.string() });

export const feedbackExportOperation = {
  handlerRef: EXPORT_FEEDBACK,
  labelKey: "panels.feedback.export",
  binding: { kind: "PlatformOperation", id: EXPORT_FEEDBACK },
  kind: "action",
  effect: "read",
  batch: false,
  target: { source: "none" },
  targetSchema: z.undefined(),
  inputSchema: exportInputSchema,
  resultSchema: z.union([panelDownloadReceiptSchema, panelReadOperationJsonResultSchema]),
  async execute({ executor: { owner, credentials } }, call) {
    await assertManagement(workbenchManagement.feedbackExport, owner, credentials);
    const { search, sourceType, rating, timeZone } = exportInputSchema.parse(call.input);
    const file = await exportFeedback({
      domainId: owner.domainId,
      keyword: search || undefined,
      sourceType: sourceType === "all" ? undefined : sourceType,
      rating: rating === "all" ? undefined : rating,
      locale: credentials.locale,
      timeZone: feedbackExportTimeZone(timeZone),
    });
    if (file.count === 0) {
      return {
        kind: "json",
        value: { exported: 0, empty: true },
        message: tForLocale(credentials.locale, "panels.feedback.exportEmpty"),
      };
    }
    return { kind: "file", bytes: file.bytes, suggestedName: file.suggestedName, mime: file.mime };
  },
} satisfies PanelReadServerOperation & { labelKey: string };

export const feedbackDataReadRegistrations: RegisteredDataReadRegistration[] = [
  localReadRegistration(FEEDBACK_RECORD, "query",
    managedRegisteredOpsRead(createRegisteredFeedbackReadAdapter, (reads, _key, params) => reads.query(params))),
  localReadRegistration(FEEDBACK_RECORD, "counts",
    managedRegisteredOpsRead(createRegisteredFeedbackReadAdapter, (reads, _key, params) => reads.counts(params))),
  localReadRegistration(FEEDBACK_RECORD, "record",
    managedRegisteredOpsRead(createRegisteredFeedbackReadAdapter, (reads, key) => reads.record(key))),
];
