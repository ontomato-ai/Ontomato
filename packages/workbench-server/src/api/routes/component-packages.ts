import { Router, type Express as ExpressApp, type RequestHandler } from "express";
import multer from "multer";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkBuildSchema } from "@ontomato/contracts/apps-sdk";
import {
  componentPackageInstallRequestSchema, componentPackageParamsSchema,
} from "@ontomato/contracts/component-packages";
import { credentialsFromRequest, type AuthenticatedRequest } from "../../utils/request-identity";
import { HttpError } from "../../utils/errors";
import { componentPackageAssetsPath, inspectComponentPackage } from "../../services/component-packages/release";
import {
  componentPackageArtifactDirectory, installComponentPackage, readComponentPackage, requireCompatibleComponentPackage, type CheckComponentPackageUpgrade,
} from "../../services/component-packages/store";
import { asyncHandler } from "../utils/http";

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
}).fields([{ name: "archive", maxCount: 1 }, { name: "files" }]);

const decodeUpload: RequestHandler = (req, res, next) => {
  upload(req, res, error => {
    if (error instanceof multer.MulterError) {
      next(new HttpError(400, error.message, "INVALID_REQUEST"));
      return;
    }
    next(error);
  });
};

export function createComponentPackagesRouter(requireMaintainer: RequestHandler, checkUpgrade?: CheckComponentPackageUpgrade) {
  const router = Router();
  router.post("/install", requireMaintainer, decodeUpload, asyncHandler(async (req, res) => {
    const { archive, files } = (req.files ?? {}) as Record<string, { originalname: string; buffer: Buffer }[]>;
    const input = componentPackageInstallRequestSchema.safeParse({
      ...req.body,
      ...(archive && { archive: archive[0]!.buffer }),
      ...(files && { files: files.map(file => ({ path: file.originalname, bytes: file.buffer })) }),
    });
    if (!input.success) throw new HttpError(400, input.error.message, "INVALID_REQUEST");
    const { release, files: assets } = await inspectComponentPackage(input.data);
    const caller = req as AuthenticatedRequest;
    const { userId, userName, domainId, roles, loginCode, domainName } = caller;
    const actor = { userId, userName, domainId, roles, loginCode, domainName, credentials: credentialsFromRequest(caller) };
    if (input.data.mode === "inspect") {
      await requireCompatibleComponentPackage(await readComponentPackage(release.name), release, actor, checkUpgrade);
      res.json(release);
      return;
    }
    res.json(await installComponentPackage(release, assets, actor, checkUpgrade));
  }));
  router.get("/:name", asyncHandler(async (req, res) => {
    const params = componentPackageParamsSchema.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid package name", "INVALID_REQUEST");
    const { name } = params.data;
    const release = await readComponentPackage(name);
    if (!release) throw new HttpError(404, `Component package '${name}' is not installed`, "COMPONENT_PACKAGE_NOT_FOUND");
    res.set("Cache-Control", "no-store").json(release);
  }));
  return router;
}

const assetParams = componentPackageParamsSchema.extend({
  digest: appsSdkBuildSchema.shape.digest,
  0: runtimeRelativePathSchema,
});

export function mountComponentPackageAssets(app: ExpressApp) {
  app.get(`${componentPackageAssetsPath}/:name/:digest/*`, asyncHandler(async (req, res, next) => {
    const params = assetParams.safeParse(req.params);
    if (!params.success) throw new HttpError(404, "Component package file not found", "NOT_FOUND");
    const { name, digest, 0: file } = params.data;
    const current = await readComponentPackage(name);
    if (current?.digest !== digest) throw new HttpError(404, "Component package release is not enabled", "NOT_FOUND");
    res.set({ "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=0" });
    res.sendFile(file, {
      root: componentPackageArtifactDirectory(name, digest), cacheControl: false,
    }, error => {
      if (error) next(error);
    });
  }));
}
