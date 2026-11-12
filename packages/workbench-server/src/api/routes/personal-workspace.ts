import { Router } from "express";
import { personalWorkspaceSchema, recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";
import { personalWorkspaceStore, type PersonalWorkspaceOwner } from "../../services/personal-workspace/store";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
import { personalHome, saveHomeWorkspace } from "../../services/product-assets/store";
import { wrap } from "../utils/agent-host";
import { context } from "../utils/agent-host";

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
router.get("/", wrap(async (req, res) => {
  const asset = await personalHome(owner(req as AuthenticatedRequest),context(req).credentials);
  if (asset.document.kind !== "page") throw new Error("Home must be a page");
  res.json({ data: asset.document.workspace, revision:asset.revision, assetId:asset.id });
}));
router.put("/", wrap(async (req, res) => {
  const parsed = personalWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_PERSONAL_WORKSPACE" }); return; }
  const revisionHeader = req.header("If-Match");
  if(!revisionHeader){res.status(428).json({error:{code:'REVISION_REQUIRED',message:'Read the current home and supply If-Match'}});return;}
  const revision = Number(revisionHeader);
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) { res.status(400).json({error:"INVALID_REVISION"}); return; }
  const asset = await saveHomeWorkspace(owner(req as AuthenticatedRequest), parsed.data, revision,context(req).credentials);
  res.json({ data: parsed.data, revision:asset.revision, assetId:asset.id });
}));
export default router;
