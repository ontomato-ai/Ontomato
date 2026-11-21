export interface AssistantCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
  headers?: Record<string, string>;
  executionUserId?: string | null;
}
