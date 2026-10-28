import { Router } from "express";
import { z } from "zod";
import {
  getQueryHistoryDetail,
  getQueryHistoryList,
} from "../../services/admin/query-history";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
const router: ReturnType<typeof Router> = Router();
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = req as AuthenticatedRequest;
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().nonnegative().default(0),
        status: z.string().optional(),
        objectClass: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
      .parse(req.query);
    res.json(
      await getQueryHistoryList({
        ...query,
        userId: actor.userId,
        domainId: requireDomainId(actor),
      }),
    );
  }),
);
router.get(
  "/:sessionId/turns/:turnId",
  asyncHandler(async (req, res) => {
    const actor = req as AuthenticatedRequest;
    res.json(
      await getQueryHistoryDetail(
        z.string().uuid().parse(req.params.sessionId),
        z.string().uuid().parse(req.params.turnId),
        actor.userId,
        requireDomainId(actor),
      ),
    );
  }),
);
export default router;
