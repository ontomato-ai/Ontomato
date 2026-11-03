import { afterAll, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ pool: null as pg.Pool | null, schema: "" }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool!,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
import { ensurePlatformEventCursorSchema } from "../../../infrastructure/postgres-migrations/20261103-platform-events/schema";
import { platformEventCursor } from "../platform-event-cursor";
import { consumeAccountDeletions } from "../account-deletion-consumer";

afterAll(async () => { if (state.pool) await state.pool.end(); });

it.skipIf(!process.env.BATCH2_TEST_PG_URL)("persists per-event progress across connections and restarts, including an offline backlog", async () => {
  state.schema = "node_identity_" + randomUUID().replaceAll("-", "");
  const connect = () => new pg.Pool({ connectionString: process.env.BATCH2_TEST_PG_URL });
  state.pool = connect();
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensurePlatformEventCursorSchema(state.pool);
  await state.pool.query(`CREATE TABLE "${state.schema}".resources(user_id text PRIMARY KEY); INSERT INTO "${state.schema}".resources VALUES ('alice'),('bob')`);
  const readEvents = async (after: string) => ({
    events: ["alice", "bob"].map((userId, i) => ({ sequence: String(i + 1), userId, type: "account.deleted" as const, occurredAt: "2026-11-03T00:00:00Z" }))
      .filter((event) => BigInt(event.sequence) > BigInt(after)),
    nextCursor: "2", hasMore: false,
  });
  let fail = true;
  const cleanup = async (users: readonly string[]) => {
    if (fail && users[0] === "bob") throw new Error("dependency failure");
    await state.pool!.query(`DELETE FROM "${state.schema}".resources WHERE user_id=$1`, [users[0]]);
  };
  await expect(consumeAccountDeletions({ ...platformEventCursor, readEvents, cleanup })).rejects.toThrow("dependency failure");
  expect(await platformEventCursor.readCursor()).toBe("1");
  await state.pool.end(); state.pool = connect(); fail = false;
  await consumeAccountDeletions({ ...platformEventCursor, readEvents, cleanup });
  expect(await platformEventCursor.readCursor()).toBe("2");
  expect((await state.pool.query(`SELECT * FROM "${state.schema}".resources`)).rows).toEqual([]);
  await platformEventCursor.saveCursor("0");
  await consumeAccountDeletions({ ...platformEventCursor, readEvents, cleanup });
  expect(await platformEventCursor.readCursor()).toBe("2");
});
