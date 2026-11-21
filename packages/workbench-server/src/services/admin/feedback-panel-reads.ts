import { z } from "zod";
import { panelDownloadReceiptSchema } from "@ontomato/contracts/panel-download";
import { EXPORT_FEEDBACK } from "@ontomato/contracts/platform-object-types";
import type { FeedbackRecord } from "@ontomato/contracts/feedback";
import { panelReadParameterSchemas, type PanelGroupCounts, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { assertPermission } from "../../identity/installed";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { PanelReadServerOperation } from "../product-panels/server-operations";
import type { ProductOwner } from "../product-governance/grants";
import { countFeedback, listFeedback } from "./feedback-store";
import { exportFeedback, feedbackExportTimeZone } from "./feedback-export";

/*
 * The feedback owner's named reads for direct panels: queried list, ordered filter counts, and single record lookup.
 * Reads delegate filtering, keyword matching, and localized labels to `feedback-store` under the `user-feedback`
 * permission boundary.
 */

const queryInputSchema = z.object({
  search: z.string().optional(),
  sourceType: panelReadParameterSchemas.feedbackSourceType.optional(),
  rating: panelReadParameterSchemas.feedbackRating.optional(),
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

function feedbackRow(record: FeedbackRecord, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: record.id,
    label: record.feedbackText || record.userInput || record.id,
    subtitle: `${record.sourceTypeLabel} · ${record.ratingLabel}`,
    fieldLabels,
    fields: {
      sourceType: record.sourceTypeLabel,
      rating: record.ratingLabel,
      userId: record.userName || record.userId,
      userInput: record.userInput ?? "",
      assistantOutput: record.assistantOutput ?? "",
      feedbackText: record.feedbackText ?? "",
      turnKey: record.turnKey,
      createdAt: new Date(record.createdAt).toISOString(),
    },
  };
}

export function createFeedbackReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const t = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => ({
    sourceType: t("api.feedback.filters.sourceType"),
    rating: t("api.feedback.filters.rating"),
    userId: t("api.feedbackExport.columns.user"),
    userInput: t("api.feedbackExport.columns.input"),
    assistantOutput: t("api.feedbackExport.columns.output"),
    feedbackText: t("api.feedbackExport.columns.feedback"),
    turnKey: t("api.feedbackExport.columns.turnKey"),
    createdAt: t("api.feedbackExport.columns.time"),
  });
  const requireAccess = () => assertPermission(viewer, ["user-feedback"]);

  return {
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      await requireAccess();
      const { search, sourceType, rating, cursor, size } = queryInputSchema.parse(params);
      const offset = cursor === undefined ? 0 : Number(cursor);
      const page = await listFeedback({
        domainId: owner.domainId,
        keyword: search || undefined,
        sourceType: sourceType && sourceType !== "all" ? sourceType : undefined,
        rating: rating && rating !== "all" ? rating : undefined,
        limit: size,
        offset,
        locale: viewer.locale,
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
        locale: viewer.locale,
      });
      const found = page.records[0];
      if (!found) throw new HttpError(404, "Feedback record not found", "NOT_FOUND");
      return feedbackRow(found, fieldLabels());
    },
  };
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
  resultSchema: panelDownloadReceiptSchema,
  async execute({ executor: { owner, credentials } }, call) {
    await assertPermission(credentials, ["user-feedback"]);
    const { search, sourceType, rating, timeZone } = exportInputSchema.parse(call.input);
    const file = await exportFeedback({
      domainId: owner.domainId,
      keyword: search || undefined,
      sourceType: sourceType === "all" ? undefined : sourceType,
      rating: rating === "all" ? undefined : rating,
      locale: credentials.locale,
      timeZone: feedbackExportTimeZone(timeZone),
    });
    return { kind: "file", ...file };
  },
} satisfies PanelReadServerOperation & { labelKey: string };
