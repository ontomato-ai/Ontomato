import pg from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceLogStore } from "../postgres";

afterEach(() => vi.restoreAllMocks());

it("contains log database client errors while checked out and idle", async () => {
  // Inject a real pool with no network connection into the log store.
  const pool = new pg.Pool();
  vi.spyOn(pg, "Pool").mockImplementation(function () { return pool; });
  vi.spyOn(pg.Client.prototype, "connect").mockImplementation(function (this: pg.Client, callback) {
    (callback as (err: null, client: pg.Client) => void)(null, this);
  });
  const warn = vi.fn();
  const store = new ServiceLogStore("workbench", "postgres://unused/unused", "public", warn);
  try {
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
    expect(warn).toHaveBeenCalledTimes(3);
  } finally { await store.close(); }
});
