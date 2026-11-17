import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";

export const platformService: RequestHandler = (req, _res, next) => {
  const actual = Buffer.from(req.header("X-Ontomato-Query-Service-Token") ?? ""), expected = Buffer.from(environment.agentRuntime().queryServiceToken);
  if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return next(new HttpError(403, "Platform service authorization required", "FORBIDDEN"));
  next();
};
