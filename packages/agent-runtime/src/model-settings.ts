import { z } from "zod";
import type { PoolClient } from "pg";
import {
  MODEL_ROLES, isMaskedSecret, maskModelKey, modelEntrySchema, modelAgentsSchema,
  modelSettingsWriteSchema,
  type BackendModelConfig, type ModelSettingsData,
} from "@ontomato/contracts/model-settings";
import { openSealedModelKey, sealModelKey } from "@ontomato/contracts/model-key-seal";
import { runtimeModelTestRequestSchema } from "@ontomato/contracts/runtime-model-test";
import { RuntimeStore } from "./store";
import { RuntimeError } from "./errors";
import type { ResolvedModel } from "./model";

const storedSettingsSchema = z.object({ models: z.array(modelEntrySchema), agents: modelAgentsSchema });

function agents(references: Record<string, string | null>): ModelSettingsData["agents"] {
  return Object.fromEntries(MODEL_ROLES.map(role => [role, { model: references[role] ?? null }])) as ModelSettingsData["agents"];
}

/** A mask retains one saved key in the same model; equal tails consume keys in stored order. */
function restoreKeys(model: BackendModelConfig, stored: BackendModelConfig[]) {
  const unused = [...(stored.find(row => row.name === model.name)?.apiKeys ?? [])];
  return model.apiKeys.map(key => {
    if (key.startsWith("enc:v1:"))
      throw new RuntimeError(400, "INVALID_REQUEST", "Enter an API key, not ciphertext");
    if (!isMaskedSecret(key)) return key;
    const index = unused.findIndex(value => maskModelKey(value) === key);
    if (index < 0)
      throw new RuntimeError(400, "INVALID_REQUEST", "The masked key does not match a saved value; enter it again");
    return unused.splice(index, 1)[0]!;
  });
}

/** One model library per platform domain, shared by all authenticated hosts. */
export class RuntimeModelSettings {
  constructor(
    private readonly store: RuntimeStore,
    private readonly token: string | undefined,
    private readonly seed: { baseUrl?: string; apiKey?: string; modelName?: string } = {},
  ) {}

  private keys(data: ModelSettingsData, transform: (value: string) => string): ModelSettingsData {
    return { ...data, models: data.models.map(model => ({ ...model, apiKeys: model.apiKeys.map(transform) })) };
  }
  private open(data: unknown) {
    return this.keys(storedSettingsSchema.parse(data), value => openSealedModelKey(value, this.token));
  }
  private initial(): ModelSettingsData {
    const { baseUrl, apiKey, modelName } = this.seed;
    const complete = !!(baseUrl?.trim() && apiKey?.trim() && modelName?.trim());
    return storedSettingsSchema.parse({
      models: complete ? [{ name: "default", baseUrl, apiKeys: [apiKey!.trim()], modelName,
        timeout: "PT300S", temperature: 0, topP: 0.1, logRequests: true, logResponses: true }] : [],
      agents: agents(Object.fromEntries(MODEL_ROLES.map(role => [role, complete ? "default" : null]))),
    });
  }
  private async write(c: PoolClient, domainId: string, data: ModelSettingsData) {
    await c.query(`INSERT INTO ${this.store.table("model_settings")} (domain_id,settings) VALUES($1,$2::jsonb)
      ON CONFLICT(domain_id) DO UPDATE SET settings=EXCLUDED.settings`,
    [domainId, JSON.stringify(this.keys(data, value => sealModelKey(value, this.token)))]);
  }
  private async current(c: PoolClient, domainId: string): Promise<ModelSettingsData> {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify([this.store.schema, "model_settings", domainId])]);
    const row = (await c.query(`SELECT settings FROM ${this.store.table("model_settings")} WHERE domain_id=$1`, [domainId])).rows[0];
    if (row) return this.open(row.settings);
    const data = this.initial();
    await this.write(c, domainId, data);
    return data;
  }
  private read(domainId: string) {
    return this.store.transaction(c => this.current(c, domainId));
  }
  async get(domainId: string): Promise<ModelSettingsData> {
    const data = await this.read(domainId);
    return this.keys(data, maskModelKey);
  }
  async save(domainId: string, body: unknown): Promise<ModelSettingsData> {
    const input = modelSettingsWriteSchema.parse(body);
    return this.store.transaction(async c => {
      const previous = await this.current(c, domainId);
      const first = previous.models.length === 0 && input.models.length === 1 ? input.models[0]!.name : null;
      const restored = modelSettingsWriteSchema.parse({ ...input,
        models: input.models.map(model => ({ ...model, apiKeys: restoreKeys(model, previous.models) })),
      });
      const data = {
        models: restored.models,
        agents: agents(Object.fromEntries(MODEL_ROLES.map(role => [role, input.agents[role] ?? first]))),
      };
      await this.write(c, domainId, data);
      return this.keys(data, maskModelKey);
    });
  }
  async resolve(domainId: string, role: string): Promise<ResolvedModel> {
    const data = await this.read(domainId);
    const reference = Object.hasOwn(data.agents, role) ? data.agents[role as keyof typeof data.agents].model : null;
    const model = data.models.find(model => model.name === reference);
    if (!model) throw new RuntimeError(422, "MODEL_NOT_CONFIGURED", "No model is configured for this role");
    const { apiKeys, ...configuration } = model;
    return { ...configuration, apiKey: apiKeys[0] ?? "" };
  }
  async testDraft(domainId: string, body: unknown) {
    const { model, prompt } = runtimeModelTestRequestSchema.parse(body);
    let stored: BackendModelConfig[] = [];
    if (model.apiKeys.some(isMaskedSecret)) {
      const row = (await this.store.pool.query(`SELECT settings FROM ${this.store.table("model_settings")} WHERE domain_id=$1`, [domainId])).rows[0];
      if (row) stored = this.open(row.settings).models;
    }
    const apiKeys = restoreKeys(model, stored);
    const { apiKeys: _keys, ...configuration } = model;
    return { config: { ...configuration, apiKey: apiKeys[0] ?? "" }, prompt };
  }
}
