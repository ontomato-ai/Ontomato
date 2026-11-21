import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { homePanelResponseSchema } from "@ontomato/contracts/platform-home";
import { productPanelInputSchema } from "@ontomato/contracts/product-panels";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
import { config } from "../../config/application";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensurePlatformHomeSchema } from "../../infrastructure/postgres-migrations/20261111-platform-home/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import router from "../routes/platform-home";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const table = (name: string) => `"${state.schema}"."${name}"`;
const oldQueryUrl = config.dataQuery.baseUrl;
let server: Server | undefined;
let base: string;
let canUsePanel = true;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  state.schema = `platform_home_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);
  await ensurePlatformHomeSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  const app = express();
  app.use(express.json());
  app.post("/java/product-governance/check", (req, res) => {
    res.json({ allowed: canUsePanel && req.get("tk") === "home-reader" && req.body.id === "shared-home" && req.body.verb === "use" });
  });
  app.post("/java/product-governance/resources", (_req, res) => res.json({ ids: [] }));
  app.use("/api/platform/home", (req, _res, next) => {
    const userId = req.header("test-user") ?? "owner";
    Object.assign(req, { userId, domainId: req.header("test-domain") ?? "domain-a", token: userId });
    next();
  }, router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.dataQuery.baseUrl = base + "/java";
});

afterAll(async () => {
  config.dataQuery.baseUrl = oldQueryUrl;
  if (server) {
    server.close();
    await once(server, "close");
  }
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
});

function request(userId: string, domainId = "domain-a", body?: object) {
  return fetch(base + "/api/platform/home/panel", {
    method: body === undefined ? "GET" : "PUT",
    headers: { "content-type": "application/json", "test-user": userId, "test-domain": domainId },
    body: JSON.stringify(body),
  });
}

it("stores only the caller's home panel choice and checks current use when saving and reading it", async () => {
  const userId = "home-reader";
  const favorites = [{ kind: "application", id: "datasets" }];
  const dashboardIds = ["metrics"];
  await state.pool!.query(
    `INSERT INTO ${table("platform_home_preferences")} (domain_id,user_id,favorites,dashboard_ids)
     VALUES ('domain-a',$1,$2::jsonb,$3::jsonb)`, [userId, JSON.stringify(favorites), JSON.stringify(dashboardIds)],
  );
  const definition = productPanelInputSchema.parse({
    name: "Shared home", description: "", visibility: "domain", content: vuePanelContent(),
    manifest: { state: {}, members: {}, events: {} },
  });
  await state.pool!.query(
    `INSERT INTO ${table("product_panels")} (domain_id,id,owner_id,definition)
     VALUES ('domain-a','shared-home','panel-author',$1), ('domain-a','private-home','panel-author',$1)`, [definition],
  );
  const read = (owner = userId, domain = "domain-a") => request(owner, domain);
  const empty = await read();
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ panel: null });

  const saved = await request(userId, "domain-a", { homePanelId: "shared-home" });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ homePanelId: "shared-home" });
  const refused = await request(userId, "domain-a", { homePanelId: "private-home" });
  expect(refused.status, await refused.text()).toBe(403);
  const selected = await read();
  expect(selected.status).toBe(200);
  expect(homePanelResponseSchema.parse(await selected.json())).toMatchObject({ panel: { id: "shared-home", editable: false } });
  expect(await (await read("other-user")).json()).toEqual({ panel: null });
  expect(await (await read(userId, "domain-b")).json()).toEqual({ panel: null });

  const preferences = () => state.pool!.query(
    `SELECT home_panel_id AS "homePanelId", favorites, dashboard_ids AS "dashboardIds"
     FROM ${table("platform_home_preferences")} WHERE domain_id='domain-a' AND user_id=$1`, [userId],
  );
  expect((await preferences()).rows).toEqual([{ homePanelId: "shared-home", favorites, dashboardIds }]);
  canUsePanel = false;
  const revoked = await read();
  expect(revoked.status).toBe(403);
  expect(await revoked.json()).toMatchObject({ error: { code: "PRODUCT_FORBIDDEN" } });

  const cleared = await request(userId, "domain-a", { homePanelId: null });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual({ homePanelId: null });
  expect(await (await read()).json()).toEqual({ panel: null });
  expect((await preferences()).rows).toEqual([{ homePanelId: null, favorites, dashboardIds }]);
});
