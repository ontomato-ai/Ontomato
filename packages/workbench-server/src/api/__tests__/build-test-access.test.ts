import express from "express";
import { createServer } from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BUILD_TEST_HEADER, BUILD_TEST_UNSUPPORTED } from "@ontomato/contracts/build-tests";
import { buildTestAccess } from "../build-test-access";
import { errorHandler } from "../middleware";

let server: ReturnType<typeof createServer>;
let base: string;
let executed: string[];

beforeEach(async () => {
  executed = [];
  const app = express();
  app.use("/api", buildTestAccess);
  app.post("/api/dashboards/query-card", (_req, res) => {
    executed.push("query-card");
    res.json({ success: true, data: [] });
  });
  app.post("/api/dashboards/card-parameter-form", (_req, res) => {
    executed.push("card-parameter-form");
    res.json({ success: true, data: { fields: [] } });
  });
  app.post("/api/skills/import", (_req, res) => {
    executed.push("skills-import");
    res.json({ success: true });
  });
  app.get("/api/preferences", (_req, res) => {
    executed.push("preferences");
    res.json({ success: true, data: {} });
  });
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function testHeader() {
  return { [BUILD_TEST_HEADER]: JSON.stringify({ kind: "build-test", contextId: "context-a" }) };
}

it("refuses a build-test request to a business route before it executes", async () => {
  const response = await fetch(`${base}/api/dashboards/query-card`, { method: "POST", headers: testHeader() });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    success: false,
    error: "This interface does not support test data",
    code: BUILD_TEST_UNSUPPORTED,
  });
  expect(executed).toEqual([]);
});

it("refuses a build-test request to a pure management write", async () => {
  const response = await fetch(`${base}/api/skills/import`, { method: "POST", headers: testHeader() });
  expect(response.status).toBe(422);
  expect(executed).toEqual([]);
});

it("lets a declared metadata read and parameter conversion through", async () => {
  const preferences = await fetch(`${base}/api/preferences`, { headers: testHeader() });
  const form = await fetch(`${base}/api/dashboards/card-parameter-form`, { method: "POST", headers: testHeader() });
  expect(preferences.status).toBe(200);
  expect(form.status).toBe(200);
  expect(executed).toEqual(["preferences", "card-parameter-form"]);
});

it("keeps a request without the build-test header on its original path", async () => {
  const response = await fetch(`${base}/api/dashboards/query-card`, { method: "POST" });
  expect(response.status).toBe(200);
  expect(executed).toEqual(["query-card"]);
});
