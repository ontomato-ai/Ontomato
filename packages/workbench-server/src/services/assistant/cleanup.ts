import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { assistantService } from "./service";
import { HttpError } from "../../utils/errors";
export async function deleteUserAssistantSessions(userId: string) {
  const sessions = (
    await getPostgresPool().query(
      `SELECT id,domain_id FROM ${table("assistant_sessions")} WHERE owner_id=$1`,
      [userId],
    )
  ).rows;
  for (const s of sessions) {
    const owner = { userId, domainId: s.domain_id },
      snapshot = await assistantService.snapshot(s.id, owner);
    if (snapshot.latestRun?.run.status === "running")
      await assistantService.cancel(s.id, snapshot.latestRun.run.id, owner, {});
    await assistantService.delete(s.id, owner);
  }
  const auxiliary = (
    await getPostgresPool().query(
      `SELECT id,domain_id FROM ${table("assistant_auxiliary_sessions")} WHERE owner_id=$1`,
      [userId],
    )
  ).rows;
  for (const s of auxiliary) {
    const c = new RuntimeClient(s.domain_id);
    try {
      const snapshot = await c.session(s.id);
      if (snapshot.latestRun?.run.status === "running")
        await c.cancel(snapshot.latestRun.run.id);
      await c.deleteSession(s.id);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    await getPostgresPool().query(
      `DELETE FROM ${table("assistant_auxiliary_sessions")} WHERE id=$1`,
      [s.id],
    );
  }
  await getPostgresPool().query(
    `DELETE FROM ${table("assistant_external_threads")} WHERE owner_id=$1`,
    [userId],
  );
}
