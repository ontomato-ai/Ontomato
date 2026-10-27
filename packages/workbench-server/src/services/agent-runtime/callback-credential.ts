import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { RequestHandler } from "express";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";

const claimsSchema = z
  .object({
    pathPrefix: z.string(),
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
    .update("workbench-callback-v1\0" + value)
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
      "wbc1." +
      Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
        "base64url",
      ),
  };
}
/** Installed before ordinary authentication, which still verifies the delegated user. */
export const unwrapCallbackCredential: RequestHandler = (req, _res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer wbc1.")) return next();
  try {
    const bytes = Buffer.from(auth.slice("Bearer wbc1.".length), "base64url"),
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
      req.method !== "POST" ||
      !req.path.startsWith(claims.pathPrefix) ||
      claims.expiresAt <= Date.now() ||
      req.body?.identity?.runId !== claims.runId
    )
      throw new Error("Wrong callback scope");
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
