import type { HttpErrorResponse } from "@ontomato/contracts/http";
import type { Response } from "express";
import { toErrorMessage } from "./errors";

export function sendError(res: Response, error: unknown, status?: number) {
  const providedStatus = (error as { status?: unknown } | null)?.status;
  const fallbackStatus = typeof providedStatus === "number" ? providedStatus : 500;
  const finalStatus = status ?? fallbackStatus;
  const message = toErrorMessage(error);
  const body: HttpErrorResponse = { success: false, error: message };
  const explicitCode = (error as { code?: unknown } | null)?.code;

  if (typeof explicitCode === "string") {
    body.code = explicitCode;
  } else if (finalStatus >= 400 && finalStatus < 500) {
    body.code =
      finalStatus === 401
        ? "UNAUTHORIZED"
        : finalStatus === 403
          ? "FORBIDDEN"
          : finalStatus === 404
            ? "NOT_FOUND"
            : finalStatus === 422
              ? "VALIDATION_ERROR"
              : "BAD_REQUEST";
  }

  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === "object") {
    body.details = details;
  }

  res.status(finalStatus).json(body);
}
