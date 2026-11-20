import { z } from "zod";
import { applicationMetadataSchema } from "@ontomato/contracts/application-metadata";
import { productPanelUsedBySchema } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import type { CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet } from "../../utils/backend-client";
import { grantedProductIds } from "../product-governance/grants";
import { classesUsingDetailPanel } from "./object-detail";
import { findPanelUsers } from "./references";

async function panelsUsingTarget(
  domainId: string, kind: CurrentProductKind, id: string, credentials: AssistantCredentials, client?: Pick<PoolClient, "query">,
) {
  const rows = await findPanelUsers(domainId, kind, id, client);
  if (!rows.length) return { panels: [], hiddenCount: 0 };
  const visible = new Set(await grantedProductIds("use", credentials));
  const panels = rows.filter(panel => visible.has(panel.id));
  return { panels, hiddenCount: rows.length - panels.length };
}

export function panelsUsingProjection(
  domainId: string, id: string, credentials: AssistantCredentials, client?: Pick<PoolClient, "query">,
) {
  return panelsUsingTarget(domainId, "projection", id, credentials, client);
}

export async function panelUsers(
  domainId: string, id: string, credentials: AssistantCredentials, client?: Pick<PoolClient, "query">,
) {
  const [panels, entries, classNames] = await Promise.all([
    panelsUsingTarget(domainId, "panel", id, credentials, client),
    applicationEntriesUsingPanel(domainId, id, credentials.locale),
    classesUsingDetailPanel(domainId, id, client),
  ]);
  return { ...panels, ...entries, classNames };
}

const entrySchema = productPanelUsedBySchema.shape.applicationEntries.element;
const entryResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(entrySchema.omit({ entryId: true, applicationName: true }).extend({
    names: applicationMetadataSchema.shape.names,
    useId: entrySchema.shape.entryId,
  })),
});

async function applicationEntriesUsingPanel(domainId: string, id: string, locale: string = "en") {
  const query = new URLSearchParams({ domainId, panelId: id });
  const response = await backendGet("application-entries-using-panel",
    `${config.dataQuery.baseUrl}/platform/applications/panel-uses/by-panel?${query}`,
    { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
  const { data } = entryResponseSchema.parse(JSON.parse(response.text));
  return { applicationEntries: data.map(({ useId, names, ...entry }) => ({
    ...entry, entryId: useId, applicationName: names[locale] ?? names.en,
  })) };
}
