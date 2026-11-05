import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { errorHandler } from "../../middleware/error-handler";
import { RunStreamStore } from "../run-stream";
import { generateTitleAsync } from "../title";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));
vi.mock("../../../config/model-factory", () => ({ createModel: () => { throw new Error("model unavailable"); } }));
vi.mock("../../../infrastructure/connection", () => ({ getCheckpointer: () => null }));
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.post("/fail", () => { throw new Error("upstream failed"); });
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

it("returns an HTTP failure without converting it to success", async () => {
  const response = await fetch(`${baseUrl}/fail`, { method: "POST" });
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, error: "upstream failed" });
});
it("does not invent a title after generation fails", async () => {
  expect(await generateTitleAsync("question", "thread", "user", "domain")).toBeNull();
});
it("does not append an event to a nonexistent run", () => {
  expect(new RunStreamStore().appendJson("missing", { type: "event" })).toBeUndefined();
});
