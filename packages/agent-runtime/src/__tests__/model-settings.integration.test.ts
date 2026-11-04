import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { RuntimeStore } from "../store";
import { RuntimeModelSettings } from "../model-settings";
import { emptyModelSettings } from "../model-migration";
import { sealModelKey } from "@ontomato/contracts/model-key-seal";
const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
describe("persisted domain model settings and upgrade", () => {
  const schema = "models_" + randomUUID().replaceAll("-", "");
  let store: RuntimeStore, models: RuntimeModelSettings;
  const draft = () => ({ ...emptyModelSettings(), providers: { gateway: {
    api: "openai-completions" as const, baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-first-key-0001",
    models: [{ id: "vendor/chat", type: "chat" as const }],
  } }, defaultModelId: "gateway/vendor/chat" });
  beforeAll(async () => {
    store = new RuntimeStore(database!, schema); await store.initialize();
    models = new RuntimeModelSettings(store, "seal-token"); await models.initialize();
  });
  afterAll(async () => {
    await store.close(); const pool = new pg.Pool({ connectionString: database });
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end();
  });
  it("encrypts keys, masks reads, retains matched masks and rejects foreign masks atomically", async () => {
    const saved = await models.save("d1", draft());
    expect(saved.providers.gateway!.apiKey).toBe("******0001");
    const raw = (await store.pool.query(`SELECT settings FROM ${store.table("model_settings")} WHERE domain_id='d1'`)).rows[0].settings;
    expect(raw.providers.gateway.apiKey).toMatch(/^enc:v1:/);
    expect(JSON.stringify(raw)).not.toContain("sk-first");
    await models.save("d1", saved);
    await expect(models.save("d2", saved)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(models.save("d1", { ...saved, providers: { gateway: { ...saved.providers.gateway, apiKey: "******9999" } } })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await models.get("d1")).toEqual(saved);
    expect((await models.resolve("d1", null)).id).toBe("vendor/chat");
    await expect(models.resolve("d1", "missing/chat")).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
    expect(JSON.stringify(await models.options("d1"))).not.toContain("apiKey");
  });
  it("upgrades once, exposes the mapping, and acknowledges repeated Java imports without overwriting edits", async () => {
    const legacy = { models: [{ name: "main", modelName: "chat", baseUrl: "https://gateway/v1",
      apiKeys: [sealModelKey("key", "seal-token")], timeout: "PT10S" }], defaultModelId: "main" };
    await store.pool.query(`INSERT INTO ${store.table("model_settings")} VALUES($1,$2)`, ["upgrade", legacy]);
    await models.initialize();
    expect((await models.migrationMap("upgrade")).references).toEqual({ main: "gateway/chat" });
    const input = { baseUrl: "https://gateway/v1", apiKey: "key", modelName: "embed", dimensions: 2 };
    const first = await models.importEmbedding("upgrade", input);
    expect(first).toEqual({ importedModelId: "gateway/embed", embeddingModelId: "gateway/embed" });
    const saved = await models.get("upgrade"); saved.embeddingModelId = null;
    await models.save("upgrade", saved);
    await models.initialize();
    expect(await models.importEmbedding("upgrade", input)).toEqual({ importedModelId: "gateway/embed", embeddingModelId: null });
    expect((await models.get("upgrade")).providers.gateway!.models).toHaveLength(2);
  });
});
