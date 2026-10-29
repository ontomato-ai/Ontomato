import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Node-only AES-256-GCM codec for runtime storage and sealed-key transport to workbench callers. */
export const MODEL_RUNTIME_TOKEN_ENV = "ONTOMATO_MODEL_RUNTIME_TOKEN";
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function modelKeySealKey(token: string | undefined): Buffer {
  // Blank counts as missing, as on the Java side; the value itself is used as configured.
  if (!token?.trim()) {
    throw new Error(
      `${MODEL_RUNTIME_TOKEN_ENV} is not set: the workbench server and agent runtime must use the same value`
    );
  }
  return createHash("sha256").update(token, "utf8").digest();
}

export function openSealedModelKey(sealed: string, token: string | undefined): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("The model key from the runtime is not sealed");
  const combined = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  if (combined.length < IV_BYTES + TAG_BYTES) throw new Error("The sealed model key is truncated");
  const decipher = createDecipheriv("aes-256-gcm", modelKeySealKey(token), combined.subarray(0, IV_BYTES));
  decipher.setAuthTag(combined.subarray(combined.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(combined.subarray(IV_BYTES, combined.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

export function sealModelKey(value: string, token: string | undefined): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", modelKeySealKey(token), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}
