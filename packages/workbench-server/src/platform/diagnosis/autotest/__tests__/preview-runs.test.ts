import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";

/** An ops test run is platform work, not a business write: a preview starts and stops one as anyone may. */

const mocks = vi.hoisted(() => ({ startRun: vi.fn(), stopRun: vi.fn(), deleteRun: vi.fn(), listCaseSets: vi.fn(() => []) }));
vi.mock("../runner/run-controller", () => ({
  getActiveRun: () => null, isRunActive: () => false, startRun: mocks.startRun, stopRun: mocks.stopRun, subscribeRunEvents: vi.fn(),
}));
vi.mock("../results/store", async original => ({
  ...await original<typeof import("../results/store")>(), deleteRun: mocks.deleteRun,
  loadRunMeta: (id: string) => id === "run-1" ? { runId: "run-1", domainId: "domain" } : null,
}));
vi.mock("../../../../identity/management", async original => ({
  ...await original<typeof import("../../../../identity/management")>(),
  requireManagement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../../utils/request-identity")>(), requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const { default: autotestRouter } = await import("../routes");
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { userId: "U", domainId: "domain", token: "tk", apiKey: "", locale: "en" }); next(); });
  app.use("/api/observe/autotest", autotestRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/observe/autotest`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });

const preview = { [EXECUTION_CONTEXT_HEADER]: previewExecutionContextHeader };
const send = (path: string, method: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify({ caseSetId: "set-1" }) });

it("starts and stops a formal test run for a preview as for anyone", async () => {
  mocks.startRun.mockResolvedValue({ runId: "run-1", status: "running" });
  for (const headers of [preview, {}]) {
    mocks.startRun.mockClear();
    expect((await send("/runs", "POST", headers)).status).toBe(201);
    expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({ caseSetId: "set-1", userId: "U" }));
  }
  mocks.stopRun.mockReturnValue({ runId: "run-1", status: "stopped" });
  expect((await send("/runs/run-1/stop", "POST", preview)).status).toBe(200);
  expect(mocks.stopRun).toHaveBeenCalledWith("run-1");
});
