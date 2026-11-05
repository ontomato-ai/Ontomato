/**
 * The owner's background credential for scheduled runs: one per owner and domain, shared by all of the owner's rules
 * there. The installed identity issues and verifies it (the enterprise edition an internal API Key that a logout,
 * a new login or a restart does not end); this module only keeps it, sealed with a server secret.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { environment } from "../../../config/environment";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { workbenchIdentity } from "../../../identity/installed";
import type { ScheduledRunCredentials } from "../../../identity/types";
import { createLogger } from "../../../logging/logger";
import { HttpError } from "../../../utils/errors";
import { getAnalysisScheduleRuleService } from "./schedule-rules";

const logger = createLogger("analysis-schedule-credentials");
const PREFIX = "stc1.";

export interface ScheduleOwner {
  userId: string;
  domainId: string;
}

type Caller = { token?: string; apiKey?: string };
type StoredCredential = { sealedKey: string | null; state: "valid" | "invalid" };

function sealKey() {
  const secret = environment.scheduledCredentialSecret();
  if (!secret) throw new Error("ONTOMATO_MODEL_RUNTIME_TOKEN is not configured");
  return createHash("sha256").update("workbench-scheduled-credential-v1\0" + secret).digest();
}

function seal(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), nonce);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url");
}

/** Null when the value cannot be opened, e.g. after the server secret changed. */
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

const table = () => qualifiedTable("analysis_schedule_credentials");

async function load(owner: ScheduleOwner): Promise<StoredCredential | null> {
  const result = await getPostgresPool().query(
    `SELECT sealed_key, state FROM ${table()} WHERE domain_id = $1 AND user_id = $2`,
    [owner.domainId, owner.userId]
  );
  const row = result.rows[0];
  return row ? { sealedKey: row.sealed_key, state: row.state === "valid" ? "valid" : "invalid" } : null;
}

async function save(owner: ScheduleOwner, sealedKey: string | null): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO ${table()} (domain_id, user_id, sealed_key, state, updated_at)
     VALUES ($1, $2, $3, 'valid', $4)
     ON CONFLICT (domain_id, user_id)
     DO UPDATE SET sealed_key = EXCLUDED.sealed_key, state = 'valid', updated_at = EXCLUDED.updated_at`,
    [owner.domainId, owner.userId, sealedKey, Date.now()]
  );
}

/** Marks only the credential that was found dead, so a credential issued meanwhile stays valid. */
async function invalidate(owner: ScheduleOwner, sealedKey: string | null): Promise<void> {
  await getPostgresPool().query(
    `UPDATE ${table()} SET state = 'invalid', updated_at = $3
     WHERE domain_id = $1 AND user_id = $2 AND sealed_key IS NOT DISTINCT FROM $4`,
    [owner.domainId, owner.userId, Date.now(), sealedKey]
  );
}

export async function deleteScheduleCredentialsOfUser(userId: string): Promise<void> {
  await getPostgresPool().query(`DELETE FROM ${table()} WHERE user_id = $1`, [userId]);
}

const issuing = new Map<string, Promise<void>>();

/** Issues a credential with the caller's login and keeps it, replacing the stored one. One issue per owner at a time. */
async function issue(owner: ScheduleOwner, caller: Caller): Promise<void> {
  const key = `${owner.domainId}\0${owner.userId}`;
  const pending = issuing.get(key);
  if (pending) return pending;
  const work = (async () => {
    const credential = await workbenchIdentity().issueScheduledCredential(caller);
    await save(owner, credential === null ? null : seal(credential));
  })().finally(() => issuing.delete(key));
  issuing.set(key, work);
  return work;
}

/**
 * Makes sure the owner has a credential that has not been found dead before a rule is created, edited, switched on
 * or run now; issues one with the caller's login otherwise. A working credential is kept: issuing again would end the
 * one that running scheduled runs use.
 */
export async function ensureScheduleCredential(owner: ScheduleOwner, caller: Caller): Promise<void> {
  const stored = await load(owner);
  if (stored?.state === "valid") return;
  await issue(owner, caller);
  await getAnalysisScheduleRuleService().clearLegacyTokens(owner);
}

/**
 * On the owner's visit with a valid login: renews a credential that runs found dead and resumes the rules paused for
 * it. Failures to renew are logged and leave everything paused.
 */
export async function renewScheduleCredential(owner: ScheduleOwner, caller: Caller): Promise<void> {
  if (!caller.token) return;
  const rules = getAnalysisScheduleRuleService();
  const stored = await load(owner);
  const paused = await rules.hasCredentialPaused(owner);
  // Owners without a dead credential or a paused rule are left alone: a visit never issues a first credential.
  if (stored?.state !== "invalid" && !paused) return;
  try {
    if (stored?.state !== "valid") await issue(owner, caller);
    await rules.clearLegacyTokens(owner);
    await rules.resumeCredentialPaused(owner);
  } catch (error) {
    logger.warn("Could not renew a scheduled task credential", {
      domainId: owner.domainId,
      userId: owner.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * The credentials of one scheduled run, or null when the owner has none that works (the rule is then paused).
 * A rule created before credentials existed still holds its owner's login token: while that login lasts it is
 * exchanged once for a credential and the plaintext token is dropped; a rejected login leaves no credential. An
 * unreachable issuer or verifier throws and changes nothing.
 */
export async function resolveScheduleCredential(
  owner: ScheduleOwner,
  legacyToken: string | undefined
): Promise<ScheduledRunCredentials | null> {
  let stored = await load(owner);
  if (!stored) {
    try {
      await issue(owner, { token: legacyToken });
      await getAnalysisScheduleRuleService().clearLegacyTokens(owner);
    } catch (error) {
      if (!(error instanceof HttpError && (error.status === 401 || error.status === 403))) throw error;
      logger.warn("A schedule rule's login token could not be exchanged for a credential", {
        domainId: owner.domainId,
        userId: owner.userId,
        status: error.status,
      });
    }
    stored = await load(owner);
  }
  if (!stored || stored.state === "invalid") return null;
  const plain = stored.sealedKey === null ? null : open(stored.sealedKey);
  const credentials =
    stored.sealedKey !== null && plain === null
      ? null
      : await workbenchIdentity().resolveScheduledCredential(owner, plain);
  if (credentials) return credentials;
  await invalidate(owner, stored.sealedKey);
  return null;
}
