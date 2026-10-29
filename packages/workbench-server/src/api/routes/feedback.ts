import type {
  FeedbackRating,
  FeedbackSourceType,
} from "@ontomato/contracts/feedback";
import { Request, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { listFeedback } from "../../services/admin/feedback-store";
import { asyncHandler } from "../utils/http";
const router: ReturnType<typeof Router> = Router();

function normalizeSourceType(value: unknown): FeedbackSourceType | null {
  return value === "qa" || value === "analysis_task" ? value : null;
}

function normalizeRating(value: unknown): FeedbackRating | null {
  return value === "like" || value === "dislike" ? value : null;
}

router.get(
  "/",
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
    });
    res.json({ success: true, data });
  }),
);

export default router;
