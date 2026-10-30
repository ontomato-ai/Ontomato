import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { environment } from "../../config/environment";
import { workbenchIdentity } from "../../identity/installed";
import type { ScheduledRunCredentials } from "../../identity/types";
import { createLogger } from "../../logging/logger";
import { scheduledTaskStore, type ScheduledTaskOwner } from "./store";

/**
 * The owner's background credential for scheduled runs: one per owner and domain, shared by all of the owner's
 * scheduled tasks there. The identity installed by the edition issues and verifies it; this module only keeps it,
 * sealed with a key derived from the runtime service token, which never leaves the server.
 */
const logger = createLogger("scheduled-task-credentials");
const PREFIX = "stc1.";

function sealKey() {
  const token = environment.agentRuntime().token;
  if (!token) throw new Error("AGENT_RUNTIME_SERVICE_TOKEN is not configured");
  return createHash("sha256").update("workbench-scheduled-credential-v1\0" + token).digest();
}

function seal(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), nonce);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url");
}

/** Null when the value cannot be opened, e.g. after the runtime service token changed. */
function open(sealed: string): string | null {
  try {
    if (!sealed.startsWith(PREFIX)) return null;
    const bytes = Buffer.from(sealed.slice(PREFIX.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const issuing = new Map<string, Promise<void>>();

/** Issues a credential with the caller's login and keeps it, replacing the stored one. One issue per owner at a time. */
async function issue(owner: ScheduledTaskOwner, caller: { token?: string; apiKey?: string }): Promise<void> {
  const key = `${owner.domainId}\0${owner.userId}`;
  const pending = issuing.get(key);
  if (pending) return pending;
  const work = (async () => {
    const credential = await workbenchIdentity().issueScheduledCredential(caller);
    await scheduledTaskStore.saveCredential(owner, credential === null ? null : seal(credential));
  })().finally(() => issuing.delete(key));
  issuing.set(key, work);
  return work;
}

/**
 * Makes sure the owner has a credential that has not been found dead; issues one with the caller's login otherwise.
 * A working credential is kept: issuing again would end the one that running scheduled runs use.
 */
export async function ensureScheduledCredential(
  owner: ScheduledTaskOwner,
  caller: { token?: string; apiKey?: string },
): Promise<{ renewed: boolean }> {
  const stored = await scheduledTaskStore.credential(owner);
  if (stored?.state === "valid") return { renewed: false };
  await issue(owner, caller);
  return { renewed: stored !== null };
}

/**
 * Renews a credential that runs found dead, when the caller's login can issue one, and reports whether the owner now
 * has a working credential. Failures to renew are logged and leave the state unchanged.
 */
export async function renewDeadScheduledCredential(
  owner: ScheduledTaskOwner,
  caller: { token?: string; apiKey?: string },
): Promise<boolean> {
  const stored = await scheduledTaskStore.credential(owner);
  if (stored?.state !== "invalid") return false;
  if (!caller.token) return false;
  try {
    await issue(owner, caller);
    return true;
  } catch (error) {
    logger.warn("Could not renew a scheduled task credential", {
      domainId: owner.domainId,
      userId: owner.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

/** Records that downstream services rejected the stored credential, so the owner's next visit renews it. */
export async function markScheduledCredentialDead(owner: ScheduledTaskOwner) {
  const stored = await scheduledTaskStore.credential(owner);
  if (stored?.state === "valid") await scheduledTaskStore.invalidateCredential(owner, stored.sealedKey);
}

export type ResolvedCredential =
  | { ok: true; credentials: ScheduledRunCredentials }
  | { ok: false; reason: "invalid" };

/**
 * The credentials of one scheduled run. A missing, unreadable or rejected credential is marked dead, so the owner's
 * next visit renews it; an unreachable verifier throws and leaves it alone.
 */
export async function resolveScheduledCredential(owner: ScheduledTaskOwner): Promise<ResolvedCredential> {
  const stored = await scheduledTaskStore.credential(owner);
  if (!stored || stored.state === "invalid") return { ok: false, reason: "invalid" };
  const plain = stored.sealedKey === null ? null : open(stored.sealedKey);
  const credentials =
    stored.sealedKey !== null && plain === null
      ? null
      : await workbenchIdentity().resolveScheduledCredential(owner, plain);
  if (credentials) return { ok: true, credentials };
  await scheduledTaskStore.invalidateCredential(owner, stored.sealedKey);
  return { ok: false, reason: "invalid" };
}
