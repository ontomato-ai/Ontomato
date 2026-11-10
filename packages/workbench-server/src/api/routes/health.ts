import { Router } from "express";
import type { HealthResponse } from "@ontomato/contracts/health";
import { readBuildInfo } from "../../content/build-info";

export function createHealthRouter(): Router {
  const build = readBuildInfo();
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      build,
    } satisfies HealthResponse);
  });
  return router;
}
