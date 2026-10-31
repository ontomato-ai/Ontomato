import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { MODEL_ROLES, modelSettingsSchema, modelSettingsWriteSchema, parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { openSealedModelKey } from "@ontomato/contracts/model-key-seal";
import { runtimeStartRunRequestSchema } from "@ontomato/contracts/agent-runtime";
import { RuntimeStore } from "../store";
import { RuntimeModelSettings } from "../model-settings";
import { createRuntimeHttp } from "../http";
import type { AgentRuntime } from "../runtime";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
const roles = Object.fromEntries(MODEL_ROLES.map(role => [role, null]));
const draft = (keys = ["sk-first-key-0001", "sk-second-key-0001"]) => ({
  name: "main", baseUrl: "http://127.0.0.1:9/v1", modelName: "fixture-model", apiKeys: keys,
  maxTokens: null, contextWindow: null, timeout: null, temperature: 0, topP: 0,
  customRequestParameters: { vendor: { enabled: false }, seed: 0 },
});
it("keeps complete role replacement and nullable editor defaults in one schema", () => {
  const parsed = modelSettingsWriteSchema.parse({ models: [draft()], agents: roles });
  expect(parsed.models[0]).toMatchObject({ maxTokens: 50000, contextWindow: 256000, displayName: "main", temperature: 0 });
  expect(modelSettingsWriteSchema.safeParse({ models: [draft()], agents: { ...roles, general: "missing" } }).success).toBe(false);
  expect(modelSettingsWriteSchema.safeParse({ models: [draft(), draft()], agents: roles }).success).toBe(false);
  expect(modelSettingsWriteSchema.safeParse({ models: [], agents: { general: null } }).success).toBe(false);
  expect(modelSettingsWriteSchema.safeParse({ models: [], agents: { ...roles, extra: null } }).success).toBe(false);
  for (const value of [[], "not-an-object", 12]) {
    expect(modelSettingsWriteSchema.safeParse({ models: [{ ...draft(), customRequestParameters: value }], agents: roles }).success).toBe(false);
  }
  expect(parseIsoDurationSeconds("PT1H30M")).toBe(5400);
  expect(() => parseIsoDurationSeconds("PT")).toThrow();
  expect(runtimeStartRunRequestSchema.shape).not.toHaveProperty("modelCredential");
});

// Needs PostgreSQL; a missing database fails instead of reporting a green skip.
if (!database)
  throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
describe("runtime domain model configuration HTTP/PG contract", () => {
  const schema = "models_" + randomUUID().replaceAll("-", "");
  const sealToken = "fixture-seal-token";
  let store: RuntimeStore, models: RuntimeModelSettings, server: Server, provider: Server;
  let url = "", providerUrl = "", observedKey = "";
  const hosts = [{ id: "workbench", token: "host-a", providers: [] }, { id: "ontology", token: "host-b", providers: [] }];
  async function request(path: string, body?: unknown, domain = "1", token = "host-a", method = body ? "PUT" : "GET") {
    const response = await fetch(url + path, { method,
      headers: { authorization: `Bearer ${token}`, "x-domain-id": domain, "x-correlation-id": "fixture", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  async function start() {
    store = new RuntimeStore(database!, schema);
    await store.initialize();
    models = new RuntimeModelSettings(store, sealToken);
    server = createServer(createRuntimeHttp({ options: { hosts }, models } as unknown as AgentRuntime));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await store.close();
  }
  beforeAll(async () => {
    await start();
    provider = createServer(async (req, res) => {
      observedKey = req.headers.authorization ?? "";
      for await (const _chunk of req) { /* Drain request. */ }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", model: "fixture-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "connected" }, finish_reason: "stop" }],
      })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  });
  afterAll(async () => {
    await stop();
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    const pool = new pg.Pool({ connectionString: database });
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });
  it("shares one library across hosts, isolates domains, and never returns or stores plaintext keys", async () => {
    expect((await request("/v1/models/settings", undefined, "1", "invalid")).status).toBe(401);
    const saved = await request("/v1/models/settings", { models: [draft()], agents: roles });
    expect(saved.status).toBe(200);
    expect(saved.data.models[0].apiKeys).toEqual(["******0001", "******0001"]);
    expect(saved.data.agents).toEqual(Object.fromEntries(MODEL_ROLES.map(role => [role, { model: "main" }])));
    const read = await request("/v1/models/settings", undefined, "1", "host-b");
    expect(read.data.agents).toEqual(saved.data.agents);
    expect(read.data.models[0].apiKeys).toEqual(["******0001", "******0001"]);
    expect(JSON.stringify(read.data)).not.toContain("sk-first");
    expect((await request("/v1/models/settings", undefined, "other", "host-b")).data.models).toEqual([]);
    const stored = (await store.pool.query(`SELECT settings FROM ${store.table("model_settings")} WHERE domain_id='1'`)).rows[0];
    expect(JSON.stringify(stored)).not.toContain("sk-first");
    expect(stored.settings.models[0].apiKeys[0]).toMatch(/^enc:v1:/);
    expect(stored.settings.models[0].apiKeys.map((k: string) => openSealedModelKey(k, sealToken))).toEqual(draft().apiKeys);
    await expect(models.resolve("other", "general")).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
  });
  it("restores duplicate masks in order and rejects unmatched or foreign masks atomically", async () => {
    const keys = ["******0001", "sk-replacement-5555", "******0001"];
    expect((await request("/v1/models/settings", { models: [draft(keys)], agents: roles })).status).toBe(200);
    const before = await models.get("1");
    const stored = (await store.pool.query(`SELECT settings FROM ${store.table("model_settings")} WHERE domain_id='1'`)).rows[0];
    expect(stored.settings.models[0].apiKeys.map((key: string) => openSealedModelKey(key, sealToken)))
      .toEqual(["sk-first-key-0001", "sk-replacement-5555", "sk-second-key-0001"]);
    expect(before.agents.general.model).toBeNull(); // Later saves do not refill roles.
    for (const domain of ["1", "other"]) {
      const result = await request("/v1/models/settings", { models: [draft(["******9999"])], agents: roles }, domain);
      expect(result.status).toBe(400);
    }
    expect((await models.get("1")).models).toEqual(before.models);
    expect((await request("/v1/models/settings", { models: [], agents: { ...roles, general: "main" } })).status).toBe(400);
    const sealed = stored.settings.models[0].apiKeys[0];
    expect((await request("/v1/models/settings", { models: [draft([sealed])], agents: roles })).status).toBe(400);
  });
  it("tests a saved mask at the new owner without writing", async () => {
    const before = await models.get("1");
    const result = await request("/v1/models/test", { model: { ...draft(["******0001"]), baseUrl: providerUrl }, prompt: "hello" }, "1", "host-b", "POST");
    expect(result).toEqual({ status: 200, data: { content: "connected" } });
    expect(observedKey).toBe("Bearer sk-first-key-0001");
    expect((await models.get("1")).models).toEqual(before.models);
    expect((await request("/v1/models/test", { model: draft(["******0001"]) }, "other", "host-a", "POST")).status).toBe(400);
  });
  it("persists configuration across restart and does not reseed an intentionally emptied library", async () => {
    await stop(); await start();
    expect((await request("/v1/models/settings", undefined, "1", "host-b")).data.models[0].name).toBe("main");
    const seeded = new RuntimeModelSettings(store, sealToken, { baseUrl: providerUrl, apiKey: "seed-key", modelName: "seed-model" });
    expect((await seeded.get("seeded")).agents.general.model).toBe("default");
    await seeded.save("seeded", { models: [], agents: roles });
    expect((await seeded.get("seeded")).models).toEqual([]);
  });
});
