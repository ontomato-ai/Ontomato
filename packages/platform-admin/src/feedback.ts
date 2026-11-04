import { z } from "zod";
import type { FeedbackPage, FeedbackRating, FeedbackSourceType } from "@ontomato/contracts/feedback";

/**
 * Feedback records the domain's users gave on query and analysis results, read from the workbench's feedback service
 * (GET /api/feedback, the address the Agent Platform's own admin page reads). The ontology service shows and exports
 * them; the records are the workbench's and are never written here.
 */

// Java and Node both omit absent fields; the boundary normalizes an absent value to null/undefined once per field.
const feedbackRecordSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["qa", "analysis_task"]),
  targetId: z.string(),
  threadId: z.string().optional(),
  requestSeq: z.number().int().optional(),
  taskId: z.string().optional(),
  rating: z.enum(["like", "dislike"]),
  userId: z.string(),
  userName: z.string().optional(),
  userInput: z.string().optional(),
  assistantOutput: z.string().optional(),
  feedbackText: z.string().optional(),
  metadata: z.unknown().optional(),
  createdAt: z.number(),
});

export const feedbackPageSchema = z.object({
  records: z.array(feedbackRecordSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export interface FeedbackQuery {
  sourceType?: FeedbackSourceType | "";
  rating?: FeedbackRating | "";
  keyword?: string;
  limit?: number;
  offset?: number;
}

/** The workbench's address of one page of feedback records, filters included. */
export function feedbackPath(query: FeedbackQuery): string {
  const params = new URLSearchParams();
  if (query.sourceType) params.set("sourceType", query.sourceType);
  if (query.rating) params.set("rating", query.rating);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const text = params.toString();
  return text ? `/feedback?${text}` : "/feedback";
}

export type FeedbackPageData = FeedbackPage;
