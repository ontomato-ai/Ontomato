import { inject, type InjectionKey } from "vue";
import {
  isMaskedSecret,
  modelSettingsWriteSchema,
  type ModelApi,
  type ModelEntry,
  type ModelRetry,
  type ModelSettingsData,
  type ModelSettingsWrite,
} from "@ontomato/contracts/model-settings";
import type { RuntimeModelDiscoveryRequest } from "@ontomato/contracts/runtime-model-test";
import type { ModelChoice } from "@ontomato/contracts/model-selection";

/*
 * The model configuration page edits one draft of the domain's model settings and saves it as a whole: the contract
 * replaces the settings on every save. The draft keeps providers in display order and headers as editable rows;
 * `settingsWrite` turns it back into the contract's write body.
 */

/** pi's values for chat model fields that are left out (contract.md, "字段与引用"), shown as placeholders. */
export const PI_CHAT_DEFAULTS = { contextWindow: 128000, maxTokens: 16384 } as const;

export interface HeaderDraft {
  name: string;
  value: string;
}

export interface ProviderDraft {
  /** Provider ID: the key under `providers`; chosen when the provider is added and read-only afterwards. */
  id: string;
  /** The saved key's mask while the provider is saved; submitting it unchanged keeps the saved key. */
  savedKeyMask: string | null;
  name: string;
  baseUrl: string;
  api: ModelApi;
  /** The key to submit: the saved mask until a new key is entered. */
  apiKey: string;
  headers: HeaderDraft[];
  models: ModelEntry[];
}

export interface ModelSettingsDraft {
  providers: ProviderDraft[];
  defaultModelId: string | null;
  embeddingModelId: string | null;
  retry: ModelRetry;
}

export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** Split at the first slash: model IDs may contain slashes, provider IDs never do. */
export function splitModelRef(ref: string): { providerId: string; modelId: string } {
  const slash = ref.indexOf("/");
  return { providerId: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

/** A model's display name, as the runtime names it in the model options. */
export function modelName(model: ModelEntry): string {
  return model.name ?? model.id;
}

export function draftFromSettings(data: ModelSettingsData): ModelSettingsDraft {
  return {
    providers: Object.entries(data.providers).map(([id, provider]) => ({
      id,
      savedKeyMask: isMaskedSecret(provider.apiKey) ? provider.apiKey : null,
      name: provider.name ?? "",
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: provider.apiKey,
      headers: Object.entries(provider.headers ?? {}).map(([name, value]) => ({ name, value })),
      models: provider.models.map((model) => ({ ...model })),
    })),
    defaultModelId: data.defaultModelId,
    embeddingModelId: data.embeddingModelId,
    retry: { provider: { ...data.retry.provider } },
  };
}

function providerFields(provider: ProviderDraft) {
  const headers = provider.headers.filter((header) => header.name.trim() !== "");
  return {
    ...(provider.name.trim() ? { name: provider.name.trim() } : {}),
    baseUrl: provider.baseUrl.trim(),
    api: provider.api,
    apiKey: provider.apiKey,
    ...(headers.length > 0
      ? { headers: Object.fromEntries(headers.map((header) => [header.name.trim(), header.value])) }
      : {}),
  };
}

/** The whole settings as the save endpoint takes them. */
export function settingsWrite(draft: ModelSettingsDraft): ModelSettingsWrite {
  return {
    providers: Object.fromEntries(
      draft.providers.map((provider) => [provider.id, { ...providerFields(provider), models: provider.models }])
    ),
    defaultModelId: draft.defaultModelId,
    embeddingModelId: draft.embeddingModelId,
    retry: draft.retry,
  };
}

/** The unsaved provider as the check and discovery endpoints take it (no models). */
export function draftConnection(draft: ModelSettingsDraft, provider: ProviderDraft): RuntimeModelDiscoveryRequest {
  return { providerId: provider.id, provider: providerFields(provider), retry: draft.retry };
}

export function findModel(draft: ModelSettingsDraft, ref: string | null): ModelEntry | null {
  if (!ref) return null;
  const { providerId, modelId } = splitModelRef(ref);
  return draft.providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId) ?? null;
}

/** Every model of the draft as a selection choice, in display order. */
export function draftChoices(draft: ModelSettingsDraft): ModelChoice[] {
  return draft.providers.flatMap((provider) =>
    provider.models.map((model) => ({ ref: modelRef(provider.id, model.id), name: modelName(model), type: model.type }))
  );
}

/**
 * Whether a provider ID may be added: checked with the contract's own write rules (ID format and reserved IDs) on a
 * settings body holding only that provider, so the page keeps no copy of those rules.
 */
export function providerIdAccepted(id: string): boolean {
  const result = modelSettingsWriteSchema.safeParse({
    providers: { [id]: { baseUrl: "https://example.com", api: "openai-completions", apiKey: "key", models: [] } },
    defaultModelId: null,
    embeddingModelId: null,
    retry: { provider: { timeoutMs: 1, maxRetries: 0, maxRetryDelayMs: 0 } },
  });
  return result.success;
}

/**
 * Point the domain defaults that named `from` at `to` (a renamed model), then unset a default whose model is gone or
 * no longer of its type: the save rejects such a default, and the page has told the user before removing or retyping.
 */
export function retargetDefaults(draft: ModelSettingsDraft, from: string | null, to: string | null): void {
  if (from !== null && from !== to) {
    if (draft.defaultModelId === from) draft.defaultModelId = to;
    if (draft.embeddingModelId === from) draft.embeddingModelId = to;
  }
  if (findModel(draft, draft.defaultModelId)?.type !== "chat") draft.defaultModelId = null;
  if (findModel(draft, draft.embeddingModelId)?.type !== "embedding") draft.embeddingModelId = null;
}

/** The page's one draft, shared with the panels that edit it; it is replaced in place when the settings are read. */
export const modelDraftKey: InjectionKey<ModelSettingsDraft> = Symbol("model-settings-draft");

export function useModelDraft(): ModelSettingsDraft {
  const draft = inject(modelDraftKey);
  if (!draft) throw new Error("Model panels must be mounted inside the model configuration page");
  return draft;
}

/** Why the draft cannot be saved: a message key with its parameters, and where to show it. */
export interface DraftProblem {
  key: string;
  params: Record<string, string>;
  /** The provider to select; absent for problems of the defaults or the retry settings. */
  providerId?: string;
  tab: "providers" | "defaults" | "retry";
}

/**
 * The first reason the draft would be rejected, found with the contract's write schema and named for people; null
 * when it can be saved. Duplicate header names are checked first: the write body would silently keep the last one.
 */
export function draftProblem(draft: ModelSettingsDraft): DraftProblem | null {
  for (const provider of draft.providers) {
    const names = provider.headers.map((h) => h.name.trim()).filter((name) => name !== "");
    const repeated = names.find((name, i) => names.indexOf(name) !== i);
    if (repeated) return { key: "admin.draftProblems.headerRepeated", params: { name: repeated }, providerId: provider.id, tab: "providers" };
  }
  const result = modelSettingsWriteSchema.safeParse(settingsWrite(draft));
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const [area, providerId, field, index] = issue.path.map(String);
  const detail = { detail: issue.message };
  if (area === "defaultModelId") return { key: "admin.draftProblems.defaultModel", params: {}, tab: "defaults" };
  if (area === "embeddingModelId") return { key: "admin.draftProblems.embeddingModel", params: {}, tab: "defaults" };
  if (area !== "providers" || providerId === undefined) return { key: "admin.draftProblems.retry", params: detail, tab: "retry" };
  const provider = draft.providers.find((p) => p.id === providerId);
  const at = { provider: provider?.name || providerId, ...detail };
  const place = { providerId, tab: "providers" as const };
  if (field === "models") {
    const model = provider?.models[Number(index)];
    const params = { ...at, model: model ? modelName(model) : String(index) };
    const key = issue.path[4] === "type" ? "admin.draftProblems.embeddingApi" : "admin.draftProblems.model";
    return { key, params, ...place };
  }
  const known = ["baseUrl", "apiKey", "headers"];
  return { key: known.includes(field ?? "") ? `admin.draftProblems.${field}` : "admin.draftProblems.provider", params: at, ...place };
}
