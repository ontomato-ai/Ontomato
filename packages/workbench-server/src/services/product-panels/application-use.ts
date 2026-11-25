import { z } from "zod";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { applicationEntryResolutionSchema } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { platformHomeStore, type PlatformHomeOwner } from "../platform-home/store";

const responseSchema = z.object({ success: z.literal(true), data: applicationEntryResolutionSchema });

export async function requirePanelEntry(
  credentials: AssistantCredentials,
  { applicationId, useId }: PanelUseRef,
  owner?: PlatformHomeOwner,
) {
  const query = new URLSearchParams({ applicationId, useId });
  const response = await backendGet(
    "resolve-panel-entry", `${config.dataQuery.baseUrl}/platform/applications/resolve-entry?${query}`,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  ).catch(error => {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(404, "No registered panel entrance matches the supplied applicationId and useId. "
        + "Use the applicationId and useId listed under Available entrances in the panel skill.", error.code);
    if (error instanceof HttpError && error.status === 403)
      throw new HttpError(403, "The initiating user does not have access to this panel entrance.", error.code);
    throw error;
  });
  const { data } = responseSchema.parse(JSON.parse(response.text));
  if (data.applicationId !== applicationId || data.use.id !== useId)
    throw new HttpError(502, "The entry owner returned another application or use", "PANEL_ENTRY_SOURCE_MISMATCH");
  if (applicationId === "home" && useId === "home" && owner) {
    const homePanelId = await platformHomeStore.homePanelId(owner);
    if (homePanelId !== null) {
      return { ...data, use: { ...data.use, panelId: homePanelId } };
    }
  }
  return data;
}

export async function requirePanelUseEntry(
  credentials: AssistantCredentials,
  ref: PanelUseRef,
  owner?: PlatformHomeOwner,
) {
  try {
    return await requirePanelEntry(credentials, ref, owner);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(403, error.message, "FORBIDDEN");
    throw error;
  }
}

export async function requirePanelUse(
  credentials: AssistantCredentials,
  ref: PanelUseRef,
  owner?: PlatformHomeOwner,
) {
  return (await requirePanelUseEntry(credentials, ref, owner)).use;
}
