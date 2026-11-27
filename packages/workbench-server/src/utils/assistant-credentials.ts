export interface AssistantCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
  headers?: Record<string, string>;
  executionUserId?: string | null;
  /**
   * Present when this caller runs a preview. Every execution request Node sends for it to Java or a workflow carries
   * the preview identity, and each write entry refuses that identity itself.
   */
  executionKind?: "preview";
}

export function isQueryRuntimeGrant(token: string | undefined): boolean {
  return token?.startsWith("oq.") === true;
}
