import { Router } from "express";
import { z } from "zod";
import {
  homeDashboardsSchema,
  homeFavoritesSchema,
  homePanelPreferenceSchema,
  homePanelResponseSchema,
} from "@ontomato/contracts/platform-home";
import {
  readHome,
  readHomePanel,
  recordApplicationOpen,
  saveDashboards,
  saveFavorites,
  saveHomePanel,
} from "../../services/platform-home/service";
import { context, wrap } from "../utils/agent-host";
import {ensurePlatformAssets} from '../../services/product-assets/platform-assets';

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
    await ensurePlatformAssets(context(req).owner,context(req).credentials);
    res.json(await readHome(context(req).owner,context(req).credentials));
  }),
);

router.put(
  "/favorites",
  wrap(async (req, res) => {
    const { items } = homeFavoritesSchema.parse(req.body);
    res.json(await saveFavorites(context(req).owner, items,context(req).credentials));
  }),
);

router.put(
  "/dashboards",
  wrap(async (req, res) => {
    const { ids } = homeDashboardsSchema.parse(req.body);
    res.json(await saveDashboards(context(req).owner, ids,context(req).credentials));
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

export default router;
