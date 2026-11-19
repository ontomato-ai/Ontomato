import type {
  FeedbackRating,
  FeedbackSourceType,
} from "@ontomato/contracts/feedback";
import { Request, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { listFeedback } from "../../services/admin/feedback-store";
import { feedbackCsv } from "../../services/admin/feedback-export";
import { requirePermission } from "../../identity/installed";
import { asyncHandler, buildAttachmentContentDisposition } from "../utils/http";
import { HttpError } from "../../utils/errors";
const router: ReturnType<typeof Router> = Router();

function normalizeSourceType(value: unknown): FeedbackSourceType | null {
  return value === "qa" || value === "analysis_task" ? value : null;
}

function normalizeRating(value: unknown): FeedbackRating | null {
  return value === "like" || value === "dislike" ? value : null;
}

/** A feedback record ID the store can cast to a UUID. */
function feedbackId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new HttpError(400, "Invalid feedback ID", "INVALID_REQUEST");
  return value;
}

/** The viewer's IANA time zone, required so exported times are the reader's rather than the server's. */
function viewerTimeZone(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: name }).format();
  } catch {
    throw new HttpError(400, "A valid IANA time zone is required", "INVALID_REQUEST");
  }
  return name;
}

router.get(
  "/export",
  requirePermission(["user-feedback"]),
  asyncHandler(async (req: Request, res: Response) => {
    const identity = req as AuthenticatedRequest;
    const timeZone = viewerTimeZone(req.query.timeZone);
    const data = await listFeedback({
      domainId: identity.domainId,
      sourceType: normalizeSourceType(req.query.sourceType) || undefined,
      rating: normalizeRating(req.query.rating) || undefined,
      keyword:
        typeof req.query.keyword === "string" ? req.query.keyword : undefined,
      all: true,
      locale: identity.locale,
    });
    const fileName = `feedback_records_${new Date().toISOString().slice(0, 10)}.csv`;
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": buildAttachmentContentDisposition(fileName),
      })
      .send(feedbackCsv(data.records, identity.locale, timeZone));
  }),
);

router.get(
  "/",
  requirePermission(["user-feedback"]),
  asyncHandler(async (req: Request, res: Response) => {
    const sourceType = normalizeSourceType(req.query.sourceType);
    const rating = normalizeRating(req.query.rating);
    const data = await listFeedback({
      domainId: (req as AuthenticatedRequest).domainId,
      sourceType: sourceType || undefined,
      rating: rating || undefined,
      userId:
        typeof req.query.userId === "string" ? req.query.userId : undefined,
      threadId:
        typeof req.query.threadId === "string" ? req.query.threadId : undefined,
      taskId:
        typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      targetIds:
        typeof req.query.targetIds === "string"
          ? req.query.targetIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
      keyword:
        typeof req.query.keyword === "string" ? req.query.keyword : undefined,
      limit: Number(req.query.limit || 20),
      offset: Number(req.query.offset || 0),
      locale: (req as AuthenticatedRequest).locale,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/state",
  asyncHandler(async (req: Request, res: Response) => {
    const sourceType = normalizeSourceType(req.query.sourceType);
    const identity = req as AuthenticatedRequest;
    const userId = identity.userId;
    const data = await listFeedback({
      domainId: identity.domainId,
      sourceType: sourceType || undefined,
      userId,
      threadId:
        typeof req.query.threadId === "string" ? req.query.threadId : undefined,
      taskId:
        typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      targetIds:
        typeof req.query.targetIds === "string"
          ? req.query.targetIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
      limit: Number(req.query.limit || 500),
      offset: 0,
      locale: identity.locale,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  requirePermission(["user-feedback"]),
  asyncHandler(async (req: Request, res: Response) => {
    const identity = req as AuthenticatedRequest;
    const data = await listFeedback({
      domainId: identity.domainId,
      feedbackId: feedbackId(req.params.id),
      all: true,
      locale: identity.locale,
    });
    const record = data.records[0];
    if (!record) throw new HttpError(404, "Feedback record not found", "NOT_FOUND");
    res.json({ success: true, data: record });
  }),
);

export default router;
