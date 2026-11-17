import { z } from "zod";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { currentProductGrants, withProductGrants } from "./grants";
import type { ProductOwner } from "./store";

export async function canUseNativeAgent(owner: ProductOwner, credentials: AssistantCredentials, agentId: string, profileId: string): Promise<boolean> {
  return withProductGrants(owner, async () => {
    const grants = currentProductGrants(owner).use;
    if (!grants.has(profileId) || !grants.has(agentId)) return false;
    const response = await backendPost("platform-agent-identity", `${config.dataQuery.baseUrl}/agent-principals/check-user-scoped`, { id: agentId }, {
      headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1,
    });
    return z.object({ allowed: z.boolean() }).parse(JSON.parse(response.text)).allowed;
  });
}
