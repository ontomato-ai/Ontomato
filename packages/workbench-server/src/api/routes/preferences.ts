import { Router } from "express";
import { readPreferences } from "../../services/assistant/user-state";
import { asyncHandler } from "../utils/http";
import type { AuthenticatedRequest } from "../../utils/request-identity";
const router: ReturnType<typeof Router> = Router();
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await readPreferences((req as AuthenticatedRequest).userId));
  }),
);
export default router;
