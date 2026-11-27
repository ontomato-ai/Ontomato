import { z } from "zod";
import { applicationMetadataSchema, localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { productPanelUsedBySchema } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { findCurrentProducts, type CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet } from "../../utils/backend-client";
import { definitionVisibleInRange, usableCurrentIds, type DefinitionVisibilityRange } from "./access";
import { classesUsingDetailPanel } from "./object-detail";
import { findPanelUsers } from "./references";

async function panelsUsingTarget(
  domainId: string, kind: CurrentProductKind, id: string, visibleIds: (ids: string[]) => Promise<Set<string>>,
  client?: Pick<PoolClient, "query">, excluding?: string,
) {
  const rows = await findPanelUsers(domainId, kind, id, client, excluding);
  if (!rows.length) return { panels: [], hiddenCount: 0 };
  const visible = await visibleIds(rows.map(({ id }) => id));
  const panels = rows.filter(panel => visible.has(panel.id));
  return { panels, hiddenCount: rows.length - panels.length };
}

export function panelsUsingProjection(
  domainId: string, id: string, credentials: AssistantCredentials, client?: Pick<PoolClient, "query">,
) {
  return panelsUsingTarget(domainId, "projection", id, ids => usableCurrentIds("panel", domainId, ids, credentials, client), client);
}

function panelsUsingTargetInRange(
  domainId: string, kind: CurrentProductKind, id: string, range: DefinitionVisibilityRange, excluding?: string,
) {
  return panelsUsingTarget(domainId, kind, id, async ids => {
    const rows = await findCurrentProducts(domainId, "panel", ids);
    return new Set([...rows.values()].filter(row => definitionVisibleInRange(row, range, domainId)).map(row => row.id));
  }, undefined, excluding);
}

export function panelsUsingProjectionInRange(domainId: string, id: string, range: DefinitionVisibilityRange) {
  return panelsUsingTargetInRange(domainId, "projection", id, range);
}

export function panelsUsingPanelInRange(domainId: string, id: string, range: DefinitionVisibilityRange) {
  return panelsUsingTargetInRange(domainId, "panel", id, range, id);
}

export async function panelUsersInRange(domainId: string, id: string, range: DefinitionVisibilityRange, payload: unknown, locale?: string) {
  const applicationEntries = presentApplicationEntries(entryListSchema.parse(payload), locale);
  const [panels, classNames] = await Promise.all([
    panelsUsingPanelInRange(domainId, id, range),
    classesUsingDetailPanel(domainId, id),
  ]);
  return { ...panels, applicationEntries, classNames };
}

export async function panelUsers(
  domainId: string, id: string, credentials: AssistantCredentials, client?: Pick<PoolClient, "query">, excluding?: string,
) {
  const [panels, entries, classNames] = await Promise.all([
    panelsUsingTarget(domainId, "panel", id, ids => usableCurrentIds("panel", domainId, ids, credentials, client), client, excluding),
    applicationEntriesUsingPanel(domainId, id, credentials.locale),
    classesUsingDetailPanel(domainId, id, client),
  ]);
  return { ...panels, ...entries, classNames };
}

const entrySchema = productPanelUsedBySchema.shape.applicationEntries.element;
const entryListSchema = z.array(entrySchema.omit({ entryId: true, applicationName: true }).extend({
  names: applicationMetadataSchema.shape.names,
  useId: entrySchema.shape.entryId,
}));
const entryResponseSchema = z.object({ success: z.literal(true), data: entryListSchema });

function presentApplicationEntries(data: z.infer<typeof entryListSchema>, locale = "en") {
  return data.map(({ useId, names, ...entry }) => ({
    ...entry, entryId: useId, applicationName: localizedApplicationText(names, locale) ?? entry.applicationId,
  }));
}

async function applicationEntriesUsingPanel(domainId: string, id: string, locale: string = "en") {
  const query = new URLSearchParams({ domainId, panelId: id });
  const response = await backendGet("application-entries-using-panel",
    `${config.dataQuery.baseUrl}/platform/applications/panel-uses/by-panel?${query}`,
    { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
  const { data } = entryResponseSchema.parse(JSON.parse(response.text));
  return { applicationEntries: presentApplicationEntries(data, locale) };
}
