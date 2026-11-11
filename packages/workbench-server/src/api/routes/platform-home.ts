import { Router } from "express";
import { z } from "zod";
import {
  homeDashboardsSchema,
  homeFavoritesSchema,
} from "@ontomato/contracts/platform-home";
import {
  readHome,
  recordApplicationOpen,
  saveDashboards,
  saveFavorites,
} from "../../services/platform-home/service";
import { context, wrap } from "../utils/agent-host";

const router: ReturnType<typeof Router> = Router();
const applicationId = z.string().min(1);

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

export default router;
