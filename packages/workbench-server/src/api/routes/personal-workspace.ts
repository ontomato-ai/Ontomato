import { Router } from "express";
import { personalWorkspaceSchema, recentWorkInputSchema,defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { personalWorkspaceStore, type PersonalWorkspaceOwner } from "../../services/personal-workspace/store";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
import { personalHome, saveHomeWorkspace, readProductOverlay } from "../../services/product-assets/store";
import { platformHomeStore } from "../../services/platform-home/store";
import { homeItemRefSchema, homeFavoritesSchema } from "@ontomato/contracts/platform-home";
import { wrap, context } from "../utils/agent-host";

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
  const currentOwner = owner(req as AuthenticatedRequest);
  const [asset, homePreferences, pinnedObjects] = await Promise.all([
    personalHome(currentOwner, context(req).credentials),
    platformHomeStore.preferences(currentOwner),
    platformHomeStore.pinnedObjects(currentOwner),
  ]);
  if (asset.document.kind !== "page") throw new Error("Home must be a page");
  const overlay = await readProductOverlay(currentOwner, asset.id);
  const base = overlay.workspace ?? asset.document.workspace ?? defaultPersonalWorkspace();
  const data = {
    ...base,
    applicationIds: homePreferences.favorites.filter(item => item.kind === "application").map(item => item.id),
    agentIds: homePreferences.favorites.filter(item => item.kind === "agent").map(item => item.id),
    dashboardIds: homePreferences.dashboardIds,
    pinnedObjects,
  };
  res.json({ data, revision: asset.revision, assetId: asset.id });
}));
router.put("/", wrap(async (req, res) => {
  const parsed = personalWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_PERSONAL_WORKSPACE" }); return; }
  const revisionHeader = req.header("If-Match");
  if (!revisionHeader) { res.status(428).json({ error: { code: "REVISION_REQUIRED", message: "Read the current home and supply If-Match" } }); return; }
  const revision = Number(revisionHeader);
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) { res.status(400).json({ error: "INVALID_REVISION" }); return; }
  const currentOwner = owner(req as AuthenticatedRequest);
  const asset = await saveHomeWorkspace(currentOwner, parsed.data, revision, context(req).credentials);
  const favorites = homeFavoritesSchema.shape.items.parse([
    ...parsed.data.applicationIds.map(id => ({ kind: "application" as const, id })),
    ...parsed.data.agentIds.flatMap(id => {
      const candidate = homeItemRefSchema.safeParse({ kind: "agent", id });
      return candidate.success ? [candidate.data] : [];
    }),
  ]);
  await Promise.all([
    platformHomeStore.saveFavorites(currentOwner, favorites),
    platformHomeStore.saveDashboards(currentOwner, parsed.data.dashboardIds),
    platformHomeStore.savePinnedObjects(currentOwner, parsed.data.pinnedObjects),
  ]);
  res.json({ data: parsed.data, revision: asset.revision, assetId: asset.id });
}));
export default router;
