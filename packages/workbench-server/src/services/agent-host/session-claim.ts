import type { PoolClient } from "pg";
import { qualifiedTable as table } from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import type { AgentHostOwner } from "./types";

/** Surface indexes share one runtime host: a supplied UUID must never claim another surface's session. */
export async function lockSessionClaim(tx: PoolClient, id: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent-session:${id}`]);
}
export async function assertUnclaimedSession(tx: PoolClient, id: string, owner: AgentHostOwner) {
  const existing = await tx.query(`SELECT id FROM ${table("assistant_sessions")} WHERE id=$1 UNION ALL SELECT id FROM ${table("ops_sessions")} WHERE id=$1`, [id]);
  if (existing.rowCount) throw new HttpError(409, "Session identifier is already in use", "IDEMPOTENCY_CONFLICT");
  try { await new RuntimeClient(owner.domainId).session(id); }
  catch (error) { if (error instanceof HttpError && error.status === 404) return; throw error; }
  throw new HttpError(409, "Session identifier is already in use", "IDEMPOTENCY_CONFLICT");
}
