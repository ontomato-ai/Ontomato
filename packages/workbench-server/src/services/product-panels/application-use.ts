import { z } from "zod";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { applicationEntryResolutionSchema } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const responseSchema = z.object({ success: z.literal(true), data: applicationEntryResolutionSchema });

export async function requirePanelEntry(credentials: AssistantCredentials, { applicationId, useId }: PanelUseRef) {
  const query = new URLSearchParams({ applicationId, useId });
  const response = await backendGet(
    "resolve-panel-entry", `${config.dataQuery.baseUrl}/platform/applications/resolve-entry?${query}`,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  const { data } = responseSchema.parse(JSON.parse(response.text));
  if (data.applicationId !== applicationId || data.use.id !== useId)
    throw new HttpError(502, "The entry owner returned another application or use", "PANEL_ENTRY_SOURCE_MISMATCH");
  return data;
}

export async function requirePanelUse(credentials: AssistantCredentials, ref: PanelUseRef) {
  try {
    return (await requirePanelEntry(credentials, ref)).use;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(403, "Panel use is not available", "FORBIDDEN");
    throw error;
  }
}
