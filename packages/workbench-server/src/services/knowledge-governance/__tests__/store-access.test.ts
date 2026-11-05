import { beforeEach, expect, it, vi } from "vitest";

// No authorized row is returned by storage. Check denial at the public read and
// authorization boundaries; SQL row isolation itself requires PostgreSQL.
const query = vi.hoisted(() => vi.fn());
vi.mock("../../../infrastructure/postgres", () => ({
  qualifiedTable: (name: string) => name,
  getPostgresPool: () => ({ query }),
}));
vi.mock("../../../infrastructure/harness-sessions", () => ({ harnessSessions: {} }));
import { governanceStore } from "../store";

beforeEach(() => query.mockReset());
it("does not authorize or return a session when storage finds no row for the caller", async () => {
  const caller = { userId: "denied-user", domainId: "denied-domain" };
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  await expect(governanceStore.authorize("session", caller)).rejects.toMatchObject({ status: 404 });
  await expect(governanceStore.get("session", caller)).rejects.toMatchObject({ status: 404 });
});
