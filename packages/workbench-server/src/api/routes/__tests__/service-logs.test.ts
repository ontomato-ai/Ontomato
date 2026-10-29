import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { expect, it, vi } from "vitest";
import { LogQueryError, withServiceLogContext } from "@ontomato/service-logging";
import serviceLogRouter from "../service-logs";
import * as queries from "../../../platform/diagnosis/observe/service-logs";

it("reports unavailable log storage as an error, never as an empty successful page", async () => {
  const query = vi.spyOn(queries, "queryWorkbenchServiceLogs").mockRejectedValue(
    new LogQueryError(503, "LOG_STORE_UNAVAILABLE", "Service log store is unavailable"),
  );
  const app = express();
  app.use((_req, _res, next) => withServiceLogContext({ correlationId: "log-query-contract" }, next));
  app.use(serviceLogRouter);
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/logs`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "LOG_STORE_UNAVAILABLE", message: "Service log store is unavailable" },
      correlationId: "log-query-contract",
    });
  } finally { query.mockRestore(); await new Promise<void>((done) => server.close(() => done())); }
});
