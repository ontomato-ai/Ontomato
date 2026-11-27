import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { RequestHandler } from "express";
import { environment } from "../../config/environment";
import { isQueryRuntimeGrant } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";

export const executionCallbackPurpose = z.enum(["workbench", "ontology", "authoring", "panels", "retrieval", "knowledge-submit"]);
const scopeSchema = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("execution"), capability: executionCallbackPurpose }).strict(),
  z.object({ purpose: z.literal("governance"), sessionId: z.string().uuid() }).strict(),
  z.object({
    purpose: z.literal("presentation"),
    host: z.enum(["workbench", "observe"]),
    sessionId: z.string().uuid(),
    viewId: z.string().uuid(),
  }).strict(),
  z.object({ purpose: z.literal("diagnosis-evidence") }).strict(),
]);
export type CallbackScope = z.infer<typeof scopeSchema>;

const claimsSchema = z
  .object({
    scope: scopeSchema,
    runId: z.string().uuid(),
    expiresAt: z.number(),
    token: z.string(),
    apiKey: z.string(),
  })
  .strict();
function key() {
  const value = environment.agentRuntime().token;
  if (!value) throw new Error("Runtime service credential is not configured");
  return createHash("sha256")
    .update("workbench-callback-v2\0" + value)
    .digest();
}
/** Sealed user delegation: a worker receives only a short-lived callback capability. */
export function callbackCredential(input: z.infer<typeof claimsSchema>) {
  const claims = claimsSchema.parse(input),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final(),
  ]);
  return {
    kind: "bearer" as const,
    value:
      "wbc2." +
      Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
        "base64url",
      ),
  };
}
export interface RuntimeCallback { runId: string; businessGrant?: string }

export const presentationHostPaths = {
  workbench: "/api/assistant",
  observe: "/api/observe/agent",
} as const;

function permits(scope: CallbackScope, runId: string, path: string): boolean {
  switch (scope.purpose) {
    case "execution": {
      const endpoint = `/api/assistant/executions/${runId}/${scope.capability}`;
      return scope.capability === "retrieval" || scope.capability === "knowledge-submit" ? path === endpoint : path.startsWith(endpoint + "/");
    }
    case "governance":
      return path === `/api/assistant/sessions/${scope.sessionId}/governance-window`;
    case "presentation":
      return path === `${presentationHostPaths[scope.host]}/sessions/${scope.sessionId}/runs/${runId}/presentation-call/${scope.viewId}`;
    case "diagnosis-evidence":
      return path.startsWith("/api/observe/evidence/");
  }
}

/** Installed before ordinary authentication, which still verifies the delegated user. */
export const unwrapCallbackCredential: RequestHandler = (req, res, next) => {
  const auth = req.header("X-Ontomato-Callback-Credential") ?? (typeof req.headers.tk === "string" ? req.headers.tk : "");
  if (auth.startsWith("wbc1.")) return next(new HttpError(401, "Expired runtime callback credential"));
  if (!auth.startsWith("wbc2.")) return next();
  try {
    const bytes = Buffer.from(auth.slice("wbc2.".length), "base64url"),
      decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const claims = claimsSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      ),
    );
    if (
      !permits(claims.scope, claims.runId, req.path) ||
      claims.expiresAt <= Date.now() ||
      req.header("X-Ontomato-Run-Id") !== claims.runId
    )
      throw new Error("Wrong callback scope");
    const businessGrant = req.header("tk");
    res.locals.runtimeCallback = { runId: claims.runId, ...(isQueryRuntimeGrant(businessGrant) && { businessGrant }) };
    delete req.headers["x-ontomato-callback-credential"];
    delete req.headers.authorization;
    delete req.headers.tk;
    delete req.headers["x-api-key"];
    if (claims.token) req.headers.tk = claims.token;
    if (claims.apiKey) req.headers["x-api-key"] = claims.apiKey;
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired runtime callback credential"));
  }
};
