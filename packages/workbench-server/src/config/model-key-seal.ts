import { createDecipheriv, createHash } from "node:crypto";

/**
 * Model keys come from the data engine sealed (Java's ModelKeySeal): AES-256-GCM with key = SHA-256 of
 * ONTOMATO_MODEL_RUNTIME_TOKEN, written as `enc:v1:` + base64url(iv | ciphertext | tag). The page only ever sees masks
 * and ciphertext; Node opens the key it is about to use. Every edition requires the variable, and startup checks it
 * first so a missing or blank value stops the server before it serves anything.
 */
export const MODEL_RUNTIME_TOKEN_ENV = "ONTOMATO_MODEL_RUNTIME_TOKEN";
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function modelKeySealKey(): Buffer {
  const token = process.env[MODEL_RUNTIME_TOKEN_ENV];
  // Blank counts as missing, as on the Java side; the value itself is used as configured.
  if (!token?.trim()) {
    throw new Error(
      `${MODEL_RUNTIME_TOKEN_ENV} is not set: the workbench server and the data engine must be started with the same value`
    );
  }
  return createHash("sha256").update(token, "utf8").digest();
}

export function openSealedModelKey(sealed: string): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("The model key from the data engine is not sealed");
  const combined = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  if (combined.length <= IV_BYTES + TAG_BYTES) throw new Error("The sealed model key is truncated");
  const decipher = createDecipheriv("aes-256-gcm", modelKeySealKey(), combined.subarray(0, IV_BYTES));
  decipher.setAuthTag(combined.subarray(combined.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(combined.subarray(IV_BYTES, combined.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
