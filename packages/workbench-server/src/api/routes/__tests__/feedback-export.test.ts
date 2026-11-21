import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { configureI18n } from "../../../i18n";

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

const record = {
  id: "feedback-1",
  sourceType: "qa" as const,
  sourceTypeLabel: "Query",
  targetId: "33333333-3333-4333-8333-333333333333",
  threadId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  rating: "like" as const,
  ratingLabel: "Like",
  userId: "user-1",
  userInput: "What is the refund rule?",
  assistantOutput: "Within 7 days.",
  feedbackText: "Thanks",
  turnKey: "turn.11111111-1111-4111-8111-111111111111.3",
  updatedAt: Date.UTC(2026, 10, 19, 8, 0, 0),
};

let server: Server;
let base: string;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
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

it("exports the filtered records as a BOM CSV attachment with the admin page's columns", async () => {
  records.mockResolvedValue({ records: [record], total: 1, limit: 20, offset: 0, filters: { sourceType: { label: "", options: [] }, rating: { label: "", options: [] } } });

  const response = await fetch(`${base}/export?sourceType=qa&rating=like&keyword=refund&timeZone=America%2FNew_York`);

  expect(response.status).toBe(200);
  expect(permission).toHaveBeenCalledWith(["user-feedback"]);
  expect(records).toHaveBeenCalledWith({
    domainId: "domain-1",
    sourceType: "qa",
    rating: "like",
    keyword: "refund",
    all: true,
    locale: "en",
  });
  expect(response.headers.get("content-type")).toContain("text/csv");
  expect(response.headers.get("content-disposition")).toMatch(
    /attachment; filename="feedback_records_\d{4}-\d{2}-\d{2}\.csv"/,
  );

  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const [header, row] = new TextDecoder().decode(bytes).split("\n");
  expect(header).toBe('"Last updated","Source","Rating","User","Turn key","Question","Answer","Comment"');
  expect(row).toContain('"11/19/2026, 3:00:00 AM"');
  expect(row).toContain('"Query"');
  expect(row).toContain('"Like"');
  expect(row).toContain('"user-1"');
  expect(row).toContain(`"${record.turnKey}"`);
  expect(row).toContain('"What is the refund rule?"');
  expect(row).toContain('"Within 7 days."');
  expect(row).toContain('"Thanks"');
});

it("keeps the list's admission and sends no filter it was not given", async () => {
  records.mockResolvedValue({ records: [], total: 0, limit: 20, offset: 0, filters: { sourceType: { label: "", options: [] }, rating: { label: "", options: [] } } });

  const response = await fetch(`${base}/export?timeZone=Asia%2FShanghai`);

  expect(response.status).toBe(200);
  expect(permission).toHaveBeenCalledWith(["user-feedback"]);
  expect(records).toHaveBeenCalledWith({
    domainId: "domain-1",
    sourceType: undefined,
    rating: undefined,
    keyword: undefined,
    all: true,
    locale: "en",
  });
  expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))).toBe(
    '"Last updated","Source","Rating","User","Turn key","Question","Answer","Comment"',
  );
});

it.each([
  ["a missing time zone", ""],
  ["an empty time zone", "?timeZone="],
  ["an invalid time zone", `?timeZone=${encodeURIComponent("Not/AZone")}`],
])("refuses %s with a 400 before reading records", async (_case, query) => {
  const response = await fetch(`${base}/export${query}`);

  expect(response.status).toBe(400);
  expect(records).not.toHaveBeenCalled();
});
