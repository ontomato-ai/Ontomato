export const MODEL_ROLES = [
  "query",
  "coding",
  "general",
  "diagnosis",
  "knowledgeGovernance",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * Saved secrets are write-only (Java's SecretMask owns the rule): a read for the page returns `******`, followed by the
 * last four characters for API keys, and sending that value back on save or test keeps the stored secret.
 */
export const SECRET_MASK_PREFIX = "******";

export function isMaskedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(SECRET_MASK_PREFIX);
}

/** Model entry: displayName, maxTokens, and contextWindow are guaranteed after Java getModelSettings read normalization (defaults are maintained only in Java). */
export interface BackendModelConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  /** Masks (see isMaskedSecret); the keys themselves reach the workbench server only in ModelSettingsData.sealedApiKeys. */
  apiKeys: string[];
  modelName: string;
  contextWindow: number;
  maxTokens: number;
  timeout?: string;
  maxRetries?: number;
  temperature?: number;
  topP?: number;
  customRequestParameters?: Record<string, unknown>;
  organizationId?: string;
  projectId?: string;
}

export interface BackendAgentConfig {
  model: string | null;
  skilldir?: string;
}

export interface ModelSettingsData {
  models: BackendModelConfig[];
  agents: Record<ModelRole, BackendAgentConfig>;
  /** Model name to its keys sealed for the workbench server (Java ModelKeySeal); the page ignores it and never sends it back. */
  sealedApiKeys?: Record<string, string[]>;
}

/**
 * Parses an ISO-8601 duration string (time part, e.g. PT5M, PT300S, PT1H30M, PT0.5S) into seconds.
 * Throws an error for invalid format.
 */
export function parseIsoDurationSeconds(isoDuration: string): number {
  if (typeof isoDuration !== "string" || !isoDuration.trim()) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const trimmed = isoDuration.trim();
  const match = trimmed.match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/
  );
  if (
    !match ||
    (match[1] === undefined && match[2] === undefined && match[3] === undefined)
  ) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const hours = match[1] ? parseFloat(match[1]) : 0;
  const minutes = match[2] ? parseFloat(match[2]) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;

  return hours * 3600 + minutes * 60 + seconds;
}

