import pg from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { closePostgres, getPostgresPool } from "../postgres";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("../../config/environment", () => ({
  environment: { pgSchema: () => "public", pgConnection: () => "postgres://unused/unused" },
}));
vi.mock("../../logging/logger", () => ({ createLogger: () => ({ error: logError, info: vi.fn() }) }));
vi.mock("../../i18n", () => ({ tApp: (key: string) => key }));
vi.mock("../postgres-migrations/index.js", () => ({ runPostgresBusinessMigrations: vi.fn() }));

afterEach(async () => {
  await closePostgres();
  vi.restoreAllMocks();
});

it("handles client errors across checkout, reuse and return to the idle pool", async () => {
  // Keep pg's real pool lifecycle; replace only the network connection.
  vi.spyOn(pg.Client.prototype, "connect").mockImplementation(function (this: pg.Client, callback) {
    (callback as (err: null, client: pg.Client) => void)(null, this);
  });
  const pool = getPostgresPool();
  const failure = new Error("Connection terminated unexpectedly");
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await pool.connect();
    try {
      expect(() => client.emit("error", failure)).not.toThrow();
    } finally { client.release(); }
  }
  const client = await pool.connect();
  client.release();
  expect(() => client.emit("error", failure)).not.toThrow();
  expect(logError.mock.calls.map(([, error]) => error)).toEqual([failure, failure, failure]);
});
