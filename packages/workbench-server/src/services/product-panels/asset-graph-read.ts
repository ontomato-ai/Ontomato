import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { isApplicationPanelUse, productPanelSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import { resolveLocale } from "../../i18n";
import { getPostgresPool } from "../../infrastructure/postgres";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { config } from "../../config/application";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { assistantName } from "../assistant/labels";
import { assistantStore } from "../assistant/store";
import { readDefinition } from "../business-definitions/definitions";
import { DashboardMetricClient } from "../dashboard/metric-client";
import type { ProductOwner } from "../product-governance/service-authentication";
import { applicationCatalogueClient } from "./application-catalogue";
import { buildProductAssetGraph, resolveObjectTypeLabel } from "./asset-graph";
import { readAccessibleCurrentDefinitions } from "./current";
import { currentProductRecord, type CurrentProductRow } from "../../infrastructure/product-current";
import { listObjectDetailPanelMappings } from "./object-detail";

/** The records the catalogues can show: an unreadable definition is left to its own page, as the catalogues do. */
function readableDefinitions<T>(rows: readonly CurrentProductRow[], schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
  return rows.flatMap(row => {
    const parsed = schema.safeParse(currentProductRecord(row, false));
    return parsed.success && parsed.data ? [parsed.data] : [];
  });
}

async function readApplications(viewer: AssistantCredentials) {
  const client = applicationCatalogueClient(viewer);
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.query({ scope: "visible", sort: "id", size: 100, cursor });
    for (const row of page.rows) ids.add(row.id);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return Promise.all([...ids].map(id => client.record(id)));
}

async function resolveGraphNames(owner: ProductOwner, graph: ProductGraph, viewer: AssistantCredentials, locale: string) {
  const headers = buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers);
  const post = async (path: string, body: unknown) =>
    JSON.parse((await backendPost("product-graph-label", config.dataQuery.baseUrl + path, body, { headers, retries: 1 })).text);
  let objectTypeNames: Promise<Map<string, string | undefined>> | undefined;
  const metrics = new DashboardMetricClient(owner.domainId, viewer);
  await Promise.all(graph.nodes.map(async node => {
    const id = node.name;
    let name: string | undefined;
    try {
      switch (node.kind) {
        case "metric":
          name = (await metrics.describe(id)).name;
          break;
        case "definition": {
          const definition = await readDefinition(owner, id);
          name = resolveObjectTypeLabel(definition.objectType, locale) ?? definition.name;
          break;
        }
        case "action":
          name = (await post("/action/queryById", { id })).data?.name;
          break;
        case "object-type": {
          const className = node.id.slice("object-type:".length);
          if (resolveObjectTypeLabel(className, locale) !== undefined) return;
          objectTypeNames ??= post("/admin/getMetas", {}).then(result => new Map<string, string | undefined>(
            (result.data?.classDef ?? []).map((item: { className: string; showName?: string; classDesc?: string }) =>
              [item.className, item.showName || item.classDesc]),
          ));
          name = (await objectTypeNames).get(className);
          break;
        }
        default:
          return;
      }
    } catch {
      // Keep the source ID when display metadata is unavailable.
      return;
    }
    if (name) node.name = name;
  }));
}

export async function readProductAssetGraph(owner: ProductOwner, viewer: AssistantCredentials) {
  const locale = resolveLocale(viewer.locale);
  const [panelRows, projectionRows, details, agents, objectDetailMappings] = await Promise.all([
    readAccessibleCurrentDefinitions(owner, viewer, "panel"),
    readAccessibleCurrentDefinitions(owner, viewer, "projection"),
    readApplications(viewer),
    assistantStore.agents(owner.domainId),
    listObjectDetailPanelMappings(owner.domainId, getPostgresPool()),
  ]);
  const projections = readableDefinitions(projectionRows, productProjectionSchema);
  const graph = buildProductAssetGraph({
    panels: readableDefinitions(panelRows, productPanelSchema),
    projections: projections.map(projection => ({
      ...projection, shared: projection.visibility === "domain",
    })),
    applications: details.map(detail => {
      const entries = detail.panelUses.filter(isApplicationPanelUse);
      return {
        id: detail.id,
        name: localizedApplicationText(detail.names, locale) ?? detail.id,
        framePanelId: detail.framePanelId,
        panelIds: entries.map(entry => entry.panelId),
        defaultAgentIds: entries.flatMap(({ defaultAgent }) => defaultAgent?.kind === "id" ? [defaultAgent.id] : []),
      };
    }),
    agents: agents.filter(agent => agent.enabled).map(agent => ({ id: agent.id, name: assistantName(agent, locale) })),
    objectDetailMappings,
    objectTypeLabel: className => resolveObjectTypeLabel(className, locale) ?? className,
  });
  await resolveGraphNames(owner, graph, viewer, locale);
  return {
    graph,
    maintainableApplicationIds: new Set(details.filter(detail => detail.canMaintain).map(detail => detail.id)),
  };
}
