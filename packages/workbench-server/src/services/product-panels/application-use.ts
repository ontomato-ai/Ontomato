import { z } from "zod";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { applicationEntryResolutionSchema, isApplicationPanelUse, type ApplicationEntryResolution, type ApplicationEntryResolutionQuery } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { platformHomeStore, type PlatformHomeOwner } from "../platform-home/store";

const responseSchema = z.object({ success: z.literal(true), data: applicationEntryResolutionSchema });
const registeredResponseSchema = z.object({
  success: z.literal(true),
  data: applicationEntryResolutionSchema.pick({ applicationId: true, use: true, framePanelId: true }),
});

export async function personalEntry<T extends Pick<ApplicationEntryResolution, "applicationId" | "use">>(entry: T, owner?: PlatformHomeOwner): Promise<T> {
  if (entry.applicationId === "home" && entry.use.id === "home" && owner && isApplicationPanelUse(entry.use)) {
    const homePanelId = await platformHomeStore.homePanelId(owner);
    if (homePanelId !== null) return { ...entry, use: { ...entry.use, panelId: homePanelId } };
  }
  return entry;
}

function requireMatchingRef(entry: Pick<ApplicationEntryResolution, "applicationId" | "use">, ref: PanelUseRef) {
  if (entry.applicationId !== ref.applicationId || entry.use.id !== ref.useId)
    throw new HttpError(502, "The entry owner returned another application or use", "PANEL_ENTRY_SOURCE_MISMATCH");
}

export async function requirePanelEntry(
  credentials: AssistantCredentials,
  ref: ApplicationEntryResolutionQuery,
  owner?: PlatformHomeOwner,
) {
  const query = new URLSearchParams("path" in ref ? { path: ref.path }
    : { applicationId: ref.applicationId, useId: ref.useId });
  const response = await backendGet(
    "resolve-panel-entry", `${config.dataQuery.baseUrl}/platform/applications/resolve-entry?${query}`,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  ).catch(error => {
    if ("applicationId" in ref && error instanceof HttpError && error.status === 404)
      throw new HttpError(404, "No registered panel entrance matches the supplied applicationId and useId. "
        + "Use the applicationId and useId listed under Available entrances in the panel skill.", error.code);
    if (error instanceof HttpError && error.status === 403)
      throw new HttpError(403, "The initiating user does not have access to this panel entrance.", error.code);
    throw error;
  });
  const { data } = responseSchema.parse(JSON.parse(response.text));
  if ("applicationId" in ref) requireMatchingRef(data, ref);
  return personalEntry(data, owner);
}

/** Internal routing facts. The consumer separately checks access to the panel and its members. */
export async function readRegisteredPanelEntry(credentials: AssistantCredentials, ref: PanelUseRef, owner: PlatformHomeOwner) {
  const { token, locale, apiKey, headers } = credentials;
  const query = new URLSearchParams({ applicationId: ref.applicationId, useId: ref.useId });
  const reply = await backendGet("registered-panel-entry",
    `${config.dataQuery.baseUrl}/platform/applications/registered-entry?${query}`,
    { headers: buildBackendHeaders(token, undefined, locale, apiKey, {
      ...headers, "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
    }), retries: 1 });
  const { data } = registeredResponseSchema.parse(JSON.parse(reply.text));
  requireMatchingRef(data, ref);
  return personalEntry(data, owner);
}

export async function requirePanelUseEntry(
  credentials: AssistantCredentials,
  ref: PanelUseRef,
  owner?: PlatformHomeOwner,
) {
  const entry = await requirePanelEntry(credentials, ref, owner);
  if (!isApplicationPanelUse(entry.use))
    throw new HttpError(404, "This entry has no content panel", "PANEL_ENTRY_UNAVAILABLE");
  return { ...entry, use: entry.use };
}

export async function requirePanelUse(
  credentials: AssistantCredentials,
  ref: PanelUseRef,
  owner?: PlatformHomeOwner,
) {
  return (await requirePanelUseEntry(credentials, ref, owner)).use;
}
