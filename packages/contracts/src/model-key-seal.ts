import { createDecipheriv, createHash } from "node:crypto";

/**
 * Model keys come from the data engine sealed (Java's ModelKeySeal): AES-256-GCM with key = SHA-256 of
 * ONTOMATO_MODEL_RUNTIME_TOKEN, written as `enc:v1:` + base64url(iv | ciphertext | tag). The page only ever sees masks
 * and ciphertext. This Node-only wire codec is shared by the workbench and agent runtime; callers supply the token
 * from their own startup configuration. It must never be imported by a browser entry point.
 */
export const MODEL_RUNTIME_TOKEN_ENV = "ONTOMATO_MODEL_RUNTIME_TOKEN";
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function modelKeySealKey(token: string | undefined): Buffer {
  // Blank counts as missing, as on the Java side; the value itself is used as configured.
  if (!token?.trim()) {
    throw new Error(
      `${MODEL_RUNTIME_TOKEN_ENV} is not set: the workbench server, agent runtime and data engine must use the same value`
    );
  }
  return createHash("sha256").update(token, "utf8").digest();
}

export function openSealedModelKey(sealed: string, token: string | undefined): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("The model key from the data engine is not sealed");
  const combined = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  if (combined.length <= IV_BYTES + TAG_BYTES) throw new Error("The sealed model key is truncated");
  const decipher = createDecipheriv("aes-256-gcm", modelKeySealKey(token), combined.subarray(0, IV_BYTES));
  decipher.setAuthTag(combined.subarray(combined.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(combined.subarray(IV_BYTES, combined.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
