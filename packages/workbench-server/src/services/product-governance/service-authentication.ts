import { buildBackendHeaders } from "../../utils/backend-client";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

export interface ProductOwner { domainId: string; userId: string }

export function productGovernanceServiceHeaders() {
  const token = environment.agentRuntime().queryServiceToken;
  if (!token) throw new HttpError(503, "Product governance service credential is not configured", "PRODUCT_GOVERNANCE_UNAVAILABLE");
  return { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": token };
}

export function productDefinitionOwnerHeaders(credentials: AssistantCredentials) {
  return buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, {
    ...credentials.headers,
    ...productGovernanceServiceHeaders(),
  });
}
