import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { skillManager } from "../../services/skills/skill-manager";
import { renderObjectView } from "../../services/skills/render-view";
import { InvalidSkillPackageError } from "../../core/skills/manifest";
import { t, tApp } from "../../i18n";
import { validateBody } from "../middleware";
import { requirePermission } from "../../identity/installed";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler, sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";
import { getLocaleFromRequest } from "../utils/request";
const router: ReturnType<typeof Router> = Router();
const upload = multer({ storage: multer.memoryStorage() });
const requireSkillAdmin = requirePermission(["skill-management"]);

function requireDomain(req: Request, res: Response, next: NextFunction): void {
  if (!(req as AuthenticatedRequest).domainId) {
    sendError(res, new HttpError(403, tApp("foundation.domain.required")));
    return;
  }
  next();
}

router.post("/:id/render", requireDomain, validateBody(z.object({ input: z.object({
  data: z.unknown(), chartType: z.string().max(100), title: z.string().max(200),
}).catchall(z.unknown()) })), asyncHandler(async (req: Request, res: Response) => {
  const request = req as AuthenticatedRequest;
  const result = await renderObjectView({ domainId: request.domainId!, userId: request.userId },
    { token: request.token, apiKey: request.apiKey, locale: request.locale }, req.params.id, req.body.input);
  res.json({ success: true, result });
}));

// Read-only endpoints — authenticated by the shared /api boundary.
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const skills = domainId ? await skillManager.getAllSkills(domainId, getLocaleFromRequest(req)) : [];
    res.json({ success: true, skills });
  })
);

router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const query = String(req.query.q || "").trim();
    const skills = domainId ? await skillManager.searchSkills(domainId, query, getLocaleFromRequest(req)) : [];
    res.json({ success: true, skills });
  })
);

router.get(
  "/:id/references",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const affectedAgents = domainId
      ? await skillManager.getSkillReferences(domainId, req.params.id)
      : [];
    res.json({ success: true, affectedAgents });
  })
);

router.get(
  "/:id/files",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const files = domainId ? await skillManager.listSkillFiles(domainId, req.params.id) : [];
    res.json({ success: true, files });
  })
);

router.get(
  "/:id/file",
  requireDomain,
  asyncHandler(async (req: Request, res: Response) => {
    const content = await skillManager.readSkillFile((req as AuthenticatedRequest).domainId!, req.params.id,
      String(req.query.path ?? ""), getLocaleFromRequest(req));
    res.json({ success: true, content });
  })
);

router.get(
  "/:id/export",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!domainId) {
      res.status(204).end();
      return;
    }
    const zipBuffer = await skillManager.exportSkill(domainId, req.params.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.zip"`);
    res.send(zipBuffer);
  })
);

// Write endpoints — authenticated by the shared /api boundary and require a domain.
router.delete(
  "/:id",
  requireDomain,
  requireSkillAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await skillManager.deleteSkill(
      (req as AuthenticatedRequest).domainId!,
      req.params.id
    );
    res.json({ success: true, ...result });
  })
);

router.post(
  "/import",
  requireDomain,
  requireSkillAdmin,
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new HttpError(400, t("api.noFileUploaded"));
      }
      if (!req.file.originalname.endsWith(".zip")) {
        throw new HttpError(400, t("api.onlyZipSupported"));
      }
      const overwrite =
        req.query.overwrite === "true" || (req.body && (req.body as any).overwrite === "true");
      const skill = await skillManager.importSkill(
        (req as AuthenticatedRequest).domainId!,
        req.file.buffer,
        overwrite
      );
      res.json({ success: true, skill });
    } catch (error: unknown) {
      if (error instanceof InvalidSkillPackageError) {
        throw new HttpError(error.status, error.message, error.code);
      }
      throw error;
    }
  })
);

export default router;
