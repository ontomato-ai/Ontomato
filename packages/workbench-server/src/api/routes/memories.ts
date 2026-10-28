import { Router } from "express";
import { deleteMemories } from "../../services/assistant/user-state";
import { asyncHandler } from "../utils/http";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
const router: ReturnType<typeof Router> = Router();
router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const actor = req as AuthenticatedRequest;
    res.json({
      success: true,
      deletedCount: await deleteMemories(requireDomainId(actor), actor.userId),
    });
  }),
);
export default router;
