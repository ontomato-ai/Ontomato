import { z } from "zod";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { applicationPanelUsesResponseSchema } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const responseSchema = z.object({ success: z.literal(true), data: applicationPanelUsesResponseSchema });

export async function requirePanelUse(credentials: AssistantCredentials, { applicationId, useId }: PanelUseRef) {
  const response = await backendGet(
    "panel-use", `${config.dataQuery.baseUrl}/platform/applications/${encodeURIComponent(applicationId)}/panel-uses`,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  const { data } = responseSchema.parse(JSON.parse(response.text));
  const use = data.panelUses.find(entry => entry.id === useId);
  if (!use) throw new HttpError(403, "Panel use is not available", "FORBIDDEN");
  return use;
}
