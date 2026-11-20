import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { skillManager } from "../../services/skills/skill-manager";
import { filterReadableAgentDefinitions } from "../../services/assistant/definitions";
import { InvalidSkillPackageError } from "../../core/skills/manifest";
import { t, tApp } from "../../i18n";
import { requirePermission } from "../../identity/installed";
import { credentialsFromRequest, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler, sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";
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

function referenceAccess(request: AuthenticatedRequest, domainId: string) {
  const owner = { domainId, userId: request.userId };
  const credentials = credentialsFromRequest(request);
  return {
    credentials,
    readableAgentIds: (ids: readonly string[]) => filterReadableAgentDefinitions(owner, credentials, ids),
  };
}

// Read-only endpoints — authenticated by the shared /api boundary.
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const catalogue = domainId ? await skillManager.getAllSkills(domainId, credentialsFromRequest(req as AuthenticatedRequest)) : { skills: [] };
    res.json({ success: true, ...catalogue });
  })
);

router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const query = String(req.query.q || "").trim();
    const catalogue = domainId ? await skillManager.searchSkills(domainId, query, credentialsFromRequest(req as AuthenticatedRequest)) : { skills: [] };
    res.json({ success: true, ...catalogue });
  })
);

router.get(
  "/:id/references",
  asyncHandler(async (req: Request, res: Response) => {
    const request = req as AuthenticatedRequest;
    const { domainId } = request;
    const affectedAgents = domainId
      ? await skillManager.getSkillReferences(domainId, req.params.id, referenceAccess(request, domainId))
      : [];
    res.json({ success: true, affectedAgents });
  })
);

router.get(
  "/:id/files",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const files = domainId ? await skillManager.listSkillFiles(domainId, req.params.id, credentialsFromRequest(req as AuthenticatedRequest)) : [];
    res.json({ success: true, files });
  })
);

router.get(
  "/:id/file",
  requireDomain,
  asyncHandler(async (req: Request, res: Response) => {
    const content = await skillManager.readSkillFile((req as AuthenticatedRequest).domainId!, req.params.id,
      String(req.query.path ?? ""), credentialsFromRequest(req as AuthenticatedRequest));
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
    const zipBuffer = await skillManager.exportSkill(domainId, req.params.id, credentialsFromRequest(req as AuthenticatedRequest));
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
    const request = req as AuthenticatedRequest;
    const domainId = request.domainId!;
    const result = await skillManager.deleteSkill(
      domainId,
      req.params.id,
      referenceAccess(request, domainId),
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
        credentialsFromRequest(req as AuthenticatedRequest),
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
