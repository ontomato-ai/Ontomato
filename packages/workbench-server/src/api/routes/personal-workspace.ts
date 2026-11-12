import { Router } from "express";
import { personalWorkspaceSchema, recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";
import { personalWorkspaceStore, type PersonalWorkspaceOwner } from "../../services/personal-workspace/store";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";

const router: ReturnType<typeof Router> = Router();
function owner(req: AuthenticatedRequest): PersonalWorkspaceOwner {
  return { domainId: requireDomainId(req), userId: req.userId };
}
router.get("/recent", asyncHandler(async (req, res) => {
  res.json({ data: await personalWorkspaceStore.recent(owner(req as AuthenticatedRequest)) });
}));
router.post("/recent", asyncHandler(async (req, res) => {
  const parsed = recentWorkInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_RECENT_WORK" }); return; }
  const item = { ...parsed.data, visitedAt: new Date().toISOString() };
  await personalWorkspaceStore.recordVisit(owner(req as AuthenticatedRequest), item);
  res.json({ data: item });
}));
router.get("/", asyncHandler(async (req, res) => {
  res.json({ data: await personalWorkspaceStore.read(owner(req as AuthenticatedRequest)) });
}));
router.put("/", asyncHandler(async (req, res) => {
  const parsed = personalWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_PERSONAL_WORKSPACE" }); return; }
  await personalWorkspaceStore.save(owner(req as AuthenticatedRequest), parsed.data);
  res.json({ data: parsed.data });
}));
export default router;
