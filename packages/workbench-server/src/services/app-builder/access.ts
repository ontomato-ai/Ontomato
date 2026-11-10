import { z } from "zod";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const navigationResponseSchema = z.object({
  success: z.literal(true),
  data: applicationCatalogSchema,
});

export async function assertAppBuilderAccess(credentials: AssistantCredentials): Promise<void> {
  const api = getApiConfig();
  let applications;
  try {
    const response = await backendGet(
      "application-navigation",
      buildUrl(api, "/platform/applications?purpose=navigation"),
      { ...credentials, timeoutMs: api.timeout, retries: 1 },
    );
    applications = navigationResponseSchema.parse(JSON.parse(response.text)).data;
  } catch (error) {
    throw new HttpError(
      502,
      "Unable to read the application catalog",
      "APPLICATION_CATALOG_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!applications.some((application) => application.id === "app-builder")) {
    throw new HttpError(403, "Application access denied", "FORBIDDEN");
  }
}
