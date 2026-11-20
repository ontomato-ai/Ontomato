import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../../services/product-panels/operations", () => ({ readPanelOperation: read }));
vi.mock("../../../services/skills/view", () => ({}));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

import { panelOperationsRouter } from "../product-panels";

let server: Server;
let endpoint: string;
const request = {
  applicationId: "app", useId: "use", operationId: "report.download",
  call: { input: { search: "summary" } },
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "reader", token: "reader-token", locale: "en" });
    next();
  });
  app.use("/api", panelOperationsRouter);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/panel-operations/read`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function download() {
  return fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  });
}

it("sends the exact owner's byte range with a UTF-8 attachment name", async () => {
  read.mockResolvedValueOnce({
    kind: "file", mime: "text/csv", suggestedName: "反馈.csv",
    bytes: new Uint8Array([0, 239, 187, 191, 120, 0]).subarray(1, 5),
  });
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/csv");
  const disposition = response.headers.get("content-disposition");
  expect(disposition).toMatch(/^attachment;/u);
  expect(disposition).toContain("filename*=UTF-8''%E5%8F%8D%E9%A6%88.csv");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([239, 187, 191, 120]);
  expect(read).toHaveBeenLastCalledWith({ domainId: "domain", userId: "reader" },
    expect.objectContaining({ token: "reader-token" }), request);
});

it("refuses an invalid owner file before sending any attachment headers", async () => {
  read.mockResolvedValueOnce({ kind: "file", mime: "application/zip", bytes: new Uint8Array([80]), suggestedName: "../owner.zip" });
  const response = await download();
  expect(response.status).toBe(502);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toMatchObject({ error: {
    code: "PANEL_OPERATION_FILE_INVALID", message: expect.stringContaining("basename"),
  } });
});

it("keeps ordinary read results and owner refusals as JSON", async () => {
  read.mockResolvedValueOnce({ kind: "markdown", markdown: "Trial result" });
  const success = await download();
  expect(success.headers.get("content-disposition")).toBeNull();
  expect(await success.json()).toEqual({ kind: "markdown", markdown: "Trial result" });

  read.mockRejectedValueOnce(new HttpError(403, "No access to this report", "REPORT_FORBIDDEN"));
  const refusal = await download();
  expect(refusal.status).toBe(403);
  expect(refusal.headers.get("content-disposition")).toBeNull();
  expect(await refusal.json()).toMatchObject({ error: { code: "REPORT_FORBIDDEN", message: "No access to this report" } });
});
