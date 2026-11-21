import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const { records, permission } = vi.hoisted(() => ({
  records: vi.fn(),
  permission: vi.fn(),
}));
vi.mock("../../../services/admin/feedback-store", () => ({ listFeedback: records }));
vi.mock("../../../identity/installed", () => ({
  requirePermission: (keys: string[]) => {
    return (_req: unknown, _res: unknown, next: () => void) => {
      permission(keys);
      next();
    };
  },
}));

import router from "../feedback";

const feedbackId = "44444444-4444-4444-8444-444444444444";
const record = {
  id: feedbackId,
  sourceType: "qa" as const,
  sourceTypeLabel: "Query",
  targetId: "33333333-3333-4333-8333-333333333333",
  threadId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  rating: "like" as const,
  ratingLabel: "Like",
  userId: "user-1",
  turnKey: "turn.11111111-1111-4111-8111-111111111111.3",
  updatedAt: Date.UTC(2026, 10, 19, 8, 0, 0),
};
const page = { records: [record], total: 1, limit: 20, offset: 0, filters: { sourceType: { label: "", options: [] }, rating: { label: "", options: [] } } };

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { domainId: "domain-1", userId: "viewer-1", locale: "en" });
    next();
  });
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  records.mockReset();
  permission.mockReset();
});

it("reads one record with its turn key and labels under the list's admission", async () => {
  records.mockResolvedValue(page);

  const response = await fetch(`${base}/${feedbackId}`);

  expect(response.status).toBe(200);
  expect(permission).toHaveBeenCalledWith(["user-feedback"]);
  expect(records).toHaveBeenCalledWith({
    domainId: "domain-1",
    feedbackId,
    all: true,
    locale: "en",
  });
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data).toMatchObject({
    id: feedbackId,
    sourceTypeLabel: "Query",
    ratingLabel: "Like",
    turnKey: record.turnKey,
  });
});

it("answers 404 when the record is not in the caller's domain", async () => {
  records.mockResolvedValue({ ...page, records: [], total: 0 });

  const response = await fetch(`${base}/${feedbackId}`);

  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe("NOT_FOUND");
});

it("refuses an id that is not a feedback record id before reading", async () => {
  const response = await fetch(`${base}/not-a-record-id`);

  expect(response.status).toBe(400);
  expect(records).not.toHaveBeenCalled();
});
