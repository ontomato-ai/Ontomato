import {
  principalDirectoryRequestSchema,
  principalDirectoryResponseSchema,
  type PrincipalDirectoryRequest,
} from "@ontomato/contracts/principal-directory";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";

export async function readPrincipalDirectory(viewer: AssistantCredentials, request: PrincipalDirectoryRequest) {
  const response = await backendPost(
    "identity-principals",
    config.dataQuery.baseUrl + "/platform/identity/principals",
    principalDirectoryRequestSchema.parse(request),
    { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1 },
  );
  return principalDirectoryResponseSchema.parse(JSON.parse(response.text));
}
