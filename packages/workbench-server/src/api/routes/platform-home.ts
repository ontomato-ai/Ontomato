import { Router } from "express";
import { z } from "zod";
import {
  homeDashboardsSchema,
  homeFavoritesSchema,
  homePanelPreferenceSchema,
  homePanelResponseSchema,
} from "@ontomato/contracts/platform-home";
import { recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";
import { personalWorkspaceStore } from "../../services/personal-workspace/store";
import {
  readHome,
  readHomePanel,
  recordApplicationOpen,
  saveDashboards,
  saveFavorites,
  saveHomePanel,
} from "../../services/platform-home/service";
import { context, wrap } from "../utils/agent-host";

const router: ReturnType<typeof Router> = Router();
const applicationId = z.string().min(1);

router.get("/panel", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const panel = await readHomePanel(owner, credentials);
  res.set("Cache-Control", "no-store").json(homePanelResponseSchema.parse({ panel }));
}));

router.put("/panel", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const selection = homePanelPreferenceSchema.parse(req.body);
  await saveHomePanel(owner, credentials, selection.homePanelId);
  res.json(selection);
}));

router.get(
  "/",
  wrap(async (req, res) => {
    res.json(await readHome(context(req).owner));
  }),
);

router.put(
  "/favorites",
  wrap(async (req, res) => {
    const { items } = homeFavoritesSchema.parse(req.body);
    res.json(await saveFavorites(context(req).owner, items));
  }),
);

router.put(
  "/dashboards",
  wrap(async (req, res) => {
    const { ids } = homeDashboardsSchema.parse(req.body);
    res.json(await saveDashboards(context(req).owner, ids));
  }),
);

router.post(
  "/applications/:applicationId/open",
  wrap(async (req, res) => {
    res.json(
      await recordApplicationOpen(
        context(req).owner,
        applicationId.parse(req.params.applicationId),
      ),
    );
  }),
);

router.get(
  "/recent",
  wrap(async (req, res) => {
    res.json({ data: await personalWorkspaceStore.recent(context(req).owner) });
  }),
);

router.post(
  "/recent",
  wrap(async (req, res) => {
    const parsed = recentWorkInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_RECENT_WORK" });
      return;
    }
    const item = { ...parsed.data, visitedAt: new Date().toISOString() };
    await personalWorkspaceStore.recordVisit(context(req).owner, item);
    res.json({ data: item });
  }),
);

export default router;
