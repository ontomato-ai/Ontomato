export interface AssistantCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
  headers?: Record<string, string>;
  executionUserId?: string | null;
  /**
   * Present when this caller runs a preview. It is a marker inside the credentials, not a header: only a request to a
   * business-data write entry turns it into the header its Java owner refuses, so the reads, definitions, models and
   * platform objects this caller asks for travel unmarked.
   */
  executionKind?: "preview";
}

export function isQueryRuntimeGrant(token: string | undefined): boolean {
  return token?.startsWith("oq.") === true;
}
