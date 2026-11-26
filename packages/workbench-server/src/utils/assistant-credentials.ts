export interface AssistantCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
  headers?: Record<string, string>;
  executionUserId?: string | null;
}

export function isQueryRuntimeGrant(token: string | undefined): boolean {
  return token?.startsWith("oq.") === true;
}
