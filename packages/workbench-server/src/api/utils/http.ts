import { Request, Response, NextFunction } from "express";
import { toErrorMessage } from "../../utils/errors";
import { sendError } from "../../utils/http-error-response";
import { createLogger } from "../../logging/logger";

export { sendError };

export function buildAttachmentContentDisposition(fileName: string) {
  const normalized = String(fileName || "download")
    .replace(/[\r\n]/g, " ")
    .trim();

  const asciiFallback =
    normalized
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/[\\/:*?"<>|;]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "download";

  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      sendError(res, error);
    });
  };
}

const routeLogger = createLogger("api:route");

export function asyncHandlerWithLog(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  context: string
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      routeLogger.error(`[${context}] ${toErrorMessage(error)}`);
      sendError(res, error);
    });
  };
}
