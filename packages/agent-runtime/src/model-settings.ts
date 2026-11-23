import type { PoolClient } from "pg";
import { z } from "zod";
import { isMaskedSecret, maskModelKey, modelSettingsConfigurationSchema,
  modelSettingsWriteSchema, type ModelSettingsData, type ModelSettingsWrite } from "@ontomato/contracts/model-settings";
import { legacyEmbeddingImportSchema, type ModelMigrationMap } from "@ontomato/contracts/model-migration";
import { openSealedModelKey, sealModelKey } from "@ontomato/contracts/model-key-seal";
import { runtimeModelTestRequestSchema, runtimeModelDiscoveryRequestSchema } from "@ontomato/contracts/runtime-model-test";
import { RuntimeStore } from "./store";
import { RuntimeError } from "./errors";
import { resolvedModel, type ResolvedKind, type ResolvedModel } from "./model";
import { emptyModelSettings, migrateLegacyModelSettings, importLegacyEmbedding, unavailableReferencePrefix } from "./model-migration";
import { runtimeLogger } from "./logging";

/** One model library per domain; every mutation and upgrade shares the same transaction lock. */
export class RuntimeModelSettings {
  constructor(private readonly store: RuntimeStore, private readonly token: string | undefined,
    private readonly seed: { baseUrl?: string; apiKey?: string; modelName?: string } = {}) {}
  async initialize() {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS ${this.store.table("model_migration")} (
      domain_id text PRIMARY KEY, references_map jsonb NOT NULL DEFAULT '{}', imported_embedding text)`);
    const rows = (await this.store.pool.query(`SELECT domain_id FROM ${this.store.table("model_settings")}`)).rows;
    for (const row of rows) await this.read(row.domain_id);
  }
  private keys(data: ModelSettingsWrite, fn: (value: string) => string): ModelSettingsWrite {
    return { ...data, connections: Object.fromEntries(Object.entries(data.connections)
      .map(([name, connection]) => [name, { ...connection, apiKey: fn(connection.apiKey) }])) };
  }
  private open(raw: unknown) {
    const stored = z.object({
      connections: z.record(z.object({ provider: z.string(), apiBase: z.string().optional(),
        extraHeaders: z.record(z.string()).optional(), apiKey: z.string() }).passthrough()),
      models: z.record(z.unknown()),
      defaultModel: z.string().nullable().optional(),
      embeddingModel: z.string().nullable().optional(),
    }).parse(raw);
    return modelSettingsConfigurationSchema.parse({ ...stored, connections: Object.fromEntries(Object.entries(stored.connections)
      .map(([name, connection]) => [name, { ...connection, apiKey: openSealedModelKey(connection.apiKey, this.token) }])) });
  }
  private async write(c: PoolClient, domain: string, data: ModelSettingsWrite) {
    await c.query(`INSERT INTO ${this.store.table("model_settings")} (domain_id,settings) VALUES($1,$2::jsonb)
      ON CONFLICT(domain_id) DO UPDATE SET settings=EXCLUDED.settings`,
    [domain, JSON.stringify(this.keys(data, value => sealModelKey(value, this.token)))]);
  }
  private async current(c: PoolClient, domain: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify([this.store.schema, "model_settings", domain])]);
    const row = (await c.query(`SELECT settings FROM ${this.store.table("model_settings")} WHERE domain_id=$1`, [domain])).rows[0];
    if (row?.settings.connections && row.settings.models) return this.open(row.settings);
    let legacy: unknown = row?.settings;
    if (!row && this.seed.baseUrl && this.seed.apiKey && this.seed.modelName)
      legacy = { models: [{ name: "default", modelName: this.seed.modelName, baseUrl: this.seed.baseUrl,
        apiKeys: [sealModelKey(this.seed.apiKey, this.token)], timeout: "PT300S", temperature: 0, topP: 0.1 }], defaultModelId: "default" };
    const migrated = legacy ? migrateLegacyModelSettings(legacy, key => openSealedModelKey(key, this.token)) : null;
    const settings = migrated?.settings ?? emptyModelSettings();
    await this.write(c, domain, settings);
    await c.query(`INSERT INTO ${this.store.table("model_migration")} (domain_id,references_map) VALUES($1,$2::jsonb)
      ON CONFLICT(domain_id) DO NOTHING`, [domain, JSON.stringify(migrated?.mapping.references ?? {})]);
    if (migrated) runtimeLogger.info("model settings migrated", { domainId: domain, discardedKeyCount: migrated.discardedKeys });
    return settings;
  }
  private read(domain: string) { return this.store.transaction(c => this.current(c, domain)); }
  async get(domain: string): Promise<ModelSettingsData> { return this.keys(await this.read(domain), maskModelKey); }
  async options(domain: string) {
    const data = await this.read(domain);
    return { models: Object.entries(data.models).map(([name, model]) => ({
      name, type: model.type, ...(model.type === "embedding" ? { dimensions: model.dimensions } : {}),
    })), defaultModel: data.defaultModel, embeddingModel: data.embeddingModel };
  }
  private restoreKey(name: string, key: string, previous: ModelSettingsWrite) {
    if (!isMaskedSecret(key)) return key;
    const saved = previous.connections[name]?.apiKey;
    if (!saved || maskModelKey(saved) !== key)
      throw new RuntimeError(400, "INVALID_REQUEST", "The masked key does not match a saved value; enter it again");
    return saved;
  }
  async save(domain: string, body: unknown): Promise<ModelSettingsData> {
    const input = modelSettingsWriteSchema.parse(body);
    return this.store.transaction(async c => {
      const previous = await this.current(c, domain);
      const data = { ...input, connections: Object.fromEntries(Object.entries(input.connections)
        .map(([name, connection]) => [name, { ...connection, apiKey: this.restoreKey(name, connection.apiKey, previous) }])) };
      await this.write(c, domain, data);
      return this.keys(data, maskModelKey);
    });
  }
  async resolve<K extends "chat" | "embedding" = "chat">(domain: string, name?: string | null,
    kind: K = "chat" as K): Promise<ResolvedKind<K>> {
    const data = await this.read(domain);
    const chosen = name ?? (kind === "chat" ? data.defaultModel : data.embeddingModel);
    const model = chosen === null ? undefined : data.models[chosen];
    if (!model || model.type !== kind)
      throw new RuntimeError(422, "MODEL_NOT_CONFIGURED", `The selected ${kind} model is not configured`);
    return resolvedModel(chosen!, model.connection, data.connections[model.connection]!, model) as ResolvedKind<K>;
  }
  async testDraft(domain: string, body: unknown): Promise<{ config: ResolvedModel; prompt: string }> {
    const { connectionName, connection, model, prompt } = runtimeModelTestRequestSchema.parse(body);
    const saved = isMaskedSecret(connection.apiKey) ? await this.read(domain) : emptyModelSettings();
    const apiKey = this.restoreKey(connectionName, connection.apiKey, saved);
    return { config: resolvedModel(model.model, connectionName, { ...connection, apiKey }, model), prompt };
  }
  async discoveryDraft(domain: string, body: unknown) {
    const draft = runtimeModelDiscoveryRequestSchema.parse(body);
    const saved = isMaskedSecret(draft.connection.apiKey) ? await this.read(domain) : emptyModelSettings();
    return { ...draft, connection: { ...draft.connection,
      apiKey: this.restoreKey(draft.connectionName, draft.connection.apiKey, saved) } };
  }
  async migrationMap(domain: string): Promise<ModelMigrationMap> {
    await this.read(domain);
    const row = (await this.store.pool.query(`SELECT references_map FROM ${this.store.table("model_migration")} WHERE domain_id=$1`, [domain])).rows[0];
    return { references: row?.references_map ?? {}, unavailablePrefix: unavailableReferencePrefix };
  }
  async importEmbedding(domain: string, body: unknown) {
    const input = legacyEmbeddingImportSchema.parse(body);
    if (isMaskedSecret(input.apiKey)) throw new RuntimeError(400, "INVALID_REQUEST", "Embedding import requires a literal key");
    return this.store.transaction(async c => {
      const settings = await this.current(c, domain);
      const row = (await c.query(`SELECT imported_embedding FROM ${this.store.table("model_migration")} WHERE domain_id=$1`, [domain])).rows[0];
      if (row?.imported_embedding) return { importedModelId: row.imported_embedding, embeddingModelId: settings.embeddingModel };
      const importedModelId = importLegacyEmbedding(settings, input);
      modelSettingsConfigurationSchema.parse(settings);
      await this.write(c, domain, settings);
      await c.query(`INSERT INTO ${this.store.table("model_migration")} (domain_id,imported_embedding) VALUES($1,$2)
        ON CONFLICT(domain_id) DO UPDATE SET imported_embedding=EXCLUDED.imported_embedding`, [domain, importedModelId]);
      return { importedModelId, embeddingModelId: settings.embeddingModel };
    });
  }
}
