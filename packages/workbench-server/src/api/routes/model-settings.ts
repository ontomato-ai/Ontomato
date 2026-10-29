import { Router, type Request } from "express";
import { modelSettingsSchema, modelSettingsWriteSchema } from "@ontomato/contracts/model-settings";
import { runtimeModelTestRequestSchema } from "@ontomato/contracts/runtime-model-test";
import { requirePermission } from "../../identity/installed";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
import { validateBody } from "../middleware/validate";

const router: ReturnType<typeof Router> = Router();
const client = (req: Request) => new RuntimeClient((req as AuthenticatedRequest).domainId);
router.use((req, res, next) => {
  if (!(req as AuthenticatedRequest).domainId) {
    res.status(403).json({ success: false, message: "A verified domain is required" });
    return;
  }
  next();
});
router.get("/", asyncHandler(async (req, res) => {
  // Project the page view explicitly: ciphertext is only for server-side model callers.
  res.json({ success: true, data: modelSettingsSchema.parse(await client(req).modelSettings()) });
}));
router.use(requirePermission(["system-config"]));
router.post("/save", validateBody(modelSettingsWriteSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await client(req).saveModelSettings(req.body) });
}));
router.post("/test", validateBody(runtimeModelTestRequestSchema), asyncHandler(async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const result = await client(req).testModel(req.body, controller.signal);
  if (!controller.signal.aborted) res.json({ success: true, data: result.content });
}));
export default router;
