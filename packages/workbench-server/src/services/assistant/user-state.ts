import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
export async function deleteMemories(domainId: string, userId: string) {
  const r = await getPostgresPool().query(
    `DELETE FROM ${table("user_memories")} WHERE domain_id=$1 AND user_id=$2`,
    [domainId, userId],
  );
  return r.rowCount ?? 0;
}
export async function readPreferences(userId: string) {
  return (
    await getPostgresPool().query(
      `SELECT key,value,created_at AS "createdAt",updated_at AS "updatedAt" FROM ${table("user_preferences")} WHERE user_id=$1 ORDER BY key`,
      [userId],
    )
  ).rows;
}
export async function deleteUserState(userId: string) {
  await transaction(async (c) => {
    await c.query(`DELETE FROM ${table("user_memories")} WHERE user_id=$1`, [
      userId,
    ]);
    await c.query(`DELETE FROM ${table("user_preferences")} WHERE user_id=$1`, [
      userId,
    ]);
  });
}
