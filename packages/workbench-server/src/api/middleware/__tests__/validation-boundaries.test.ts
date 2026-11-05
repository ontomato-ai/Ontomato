import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";
import { validateBody, validateParams, validateQuery } from "../validate";
import { rateLimiter } from "../rate-limit";

configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const schema = z.object({ value: z.string().min(3) });
  app.post("/body", validateBody(schema), (req, res) => res.json(req.body));
  app.get("/query", validateQuery(schema), (req, res) => res.json(req.query));
  app.get("/params/:value", validateParams(schema), (req, res) => res.json(req.params));
  app.get("/limited", rateLimiter({ maxRequests: 1, windowSeconds: 60 }), (_req, res) => res.json({ success: true }));
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

it.each(["body", "query", "params"] as const)("validates the HTTP %s boundary before handing data to its handler", async (location) => {
  const request = (value: string) => fetch(`${base}/${location}${location === "query" ? `?value=${value}` : location === "params" ? `/${value}` : ""}`,
    location === "body" ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) } : {});
  const invalid = await request("x");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ success: false, details: [{ field: "value" }] });
  const valid = await request("valid");
  expect(valid.status).toBe(200);
  expect(await valid.json()).toEqual({ value: "valid" });
});
it("rejects requests that exceed the configured rate budget", async () => {
  expect((await fetch(`${base}/limited`)).status).toBe(200);
  const rejected = await fetch(`${base}/limited`);
  expect(rejected.status).toBe(429);
  expect(await rejected.json()).toMatchObject({ success: false, code: "RATE_LIMITED" });
});
