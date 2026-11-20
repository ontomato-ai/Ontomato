import { z } from "zod";
import { applicationMetadataSchema } from "@ontomato/contracts/application-metadata";
import { productPanelUsedBySchema } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet } from "../../utils/backend-client";
import { grantedProductIds } from "../product-governance/grants";

export async function panelsUsingProjection(domainId: string, id: string, credentials: AssistantCredentials,
  client: Pick<PoolClient, "query"> = getPostgresPool()) {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, definition->>'name' AS name FROM ${t("product_panels")}
     WHERE domain_id=$1 AND EXISTS (
       SELECT FROM jsonb_each(definition#>'{manifest,slots}') AS slot
       WHERE slot.value->>'projectionId'=$2
       UNION ALL
       SELECT FROM jsonb_each(definition#>'{manifest,members}') AS member
       WHERE member.value#>>'{target,projectionId}'=$2
     ) ORDER BY name,id`, [domainId, id],
  );
  if (!rows.length) return { panels: [], hiddenCount: 0 };
  const visible = new Set(await grantedProductIds("use", credentials));
  const panels = rows.filter(panel => visible.has(panel.id));
  return { panels, hiddenCount: rows.length - panels.length };
}

const entrySchema = productPanelUsedBySchema.shape.applicationEntries.element;
const entryResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(entrySchema.omit({ entryId: true, applicationName: true }).extend({
    names: applicationMetadataSchema.shape.names,
    useId: entrySchema.shape.entryId,
  })),
});

export async function applicationEntriesUsingPanel(domainId: string, id: string, locale: string = "en") {
  const query = new URLSearchParams({ domainId, panelId: id });
  const response = await backendGet("application-entries-using-panel",
    `${config.dataQuery.baseUrl}/platform/applications/panel-uses/by-panel?${query}`,
    { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
  const { data } = entryResponseSchema.parse(JSON.parse(response.text));
  return { applicationEntries: data.map(({ useId, names, ...entry }) => ({
    ...entry, entryId: useId, applicationName: names[locale] ?? names.en,
  })) };
}
