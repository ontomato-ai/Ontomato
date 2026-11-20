import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { ontologyParameterTypeSchema, type OntologyParameterType } from "@ontomato/contracts/panel-manifest";
import {
  chartProjectionSchema, METRIC_CHART_COMPONENT, productProjectionInputSchema,
  type ChartProjectionSource, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { currentProductRecord, currentProductTables, findCurrentProduct } from "../../infrastructure/product-current";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { dashboardChartSources } from "../dashboard/chart-sources";
import { grantedProductIds, requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { insertCurrentProduct } from "./current";
import { notifyProductDefinitionChanged } from "./definition-stream";

function chartProjectionId(domainId: string, source: ChartProjectionSource) {
  const key = JSON.stringify([domainId, source.dashboardId, source.cardId]);
  return "metric-chart-" + createHash("sha256").update(key).digest("hex");
}

const parameterSchema = z.object({
  name: z.string().min(1), type: z.string(), classNames: z.array(z.string()).nullish(),
});
const scalarTypes: ReadonlyMap<string, "string" | "number" | "date"> = new Map([
  ["TYPE_STRING", "string"], ["TYPE_NUMBER", "number"], ["TYPE_TIME", "date"],
]);

function panelInputs(definitions: Record<string, unknown>[]) {
  const entries: [string, OntologyParameterType][] = [];
  for (const definition of definitions) {
    const { name, type, classNames } = parameterSchema.parse(definition);
    const scalar = scalarTypes.get(type);
    if (scalar) entries.push([name, { kind: "scalar", type: scalar }]);
    else if (type === "TYPE_ONTOOBJ" && classNames?.length === 1) {
      entries.push([name, ontologyParameterTypeSchema.parse({ kind: "object", objectType: classNames[0] })]);
    }
  }
  return Object.fromEntries(entries);
}

function chartUnavailable() {
  return new HttpError(404, "Referenced chart projection not found", "PRODUCT_UNAVAILABLE");
}

async function requireChartProjection(owner: ProductOwner, credentials: AssistantCredentials, id: string, verb: "use" | "edit") {
  await requireProductGrant(id, verb, credentials);
  const row = await findCurrentProduct(owner.domainId, "projection", id);
  if (!row || row.definition.componentId !== METRIC_CHART_COMPONENT) throw chartUnavailable();
  return chartProjectionSchema.parse(currentProductRecord(row, verb === "edit"));
}

function association(projection: z.infer<typeof chartProjectionSchema>) {
  return { source: projection.chartSource, dashboardOwnerId: projection.ownerId, metricId: projection.metricId };
}

export function createChartProjectionService(dashboards: typeof dashboardChartSources) {
  return {
    async register(owner: ProductOwner, credentials: AssistantCredentials, source: ChartProjectionSource) {
      const id = chartProjectionId(owner.domainId, source);
      const { projection, created } = await transaction(async client => {
        await lockProducts(client, owner);
        const card = await dashboards.forRegistration(owner, source, credentials, client);
        const existing = await findCurrentProduct(owner.domainId, "projection", id, client);
        if (existing) {
          if (existing.definition.componentId !== METRIC_CHART_COMPONENT)
            throw new HttpError(409, "Chart identity already belongs to another projection", "PRODUCT_ID_CONFLICT");
          await requireProductGrant(id, "use", credentials);
          const editable = (await grantedProductIds("edit", credentials)).includes(id);
          const projection = chartProjectionSchema.parse(currentProductRecord(existing, editable));
          if (projection.ownerId !== owner.userId || projection.metricId !== card.metricId ||
            projection.chartSource.dashboardId !== source.dashboardId || projection.chartSource.cardId !== source.cardId)
            throw new HttpError(409, "Chart registration no longer matches the source card", "CHART_SOURCE_MISMATCH");
          return { projection, created: false };
        }
        const inputs = panelInputs(card.parameterDefs);
        const cardSource = {
          object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(source) } },
        };
        const input: ProductProjectionInput = productProjectionInputSchema.parse({
          name: card.name, description: "", visibility: "private", componentId: METRIC_CHART_COMPONENT,
          chartSource: source, metricId: card.metricId, inputs, outputs: {}, config: {},
          data: {
            template: { source: cardSource, read: "chartTemplate", params: {} },
            result: {
              source: cardSource, read: "result",
              params: Object.fromEntries(Object.keys(inputs).map(name => [name, { input: name }])),
            },
          },
        });
        const row = await insertCurrentProduct(client, owner, credentials, "projection", id, input);
        return { projection: chartProjectionSchema.parse(currentProductRecord(row, true)), created: true };
      });
      if (created) await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind: "projection", id } });
      return projection;
    },
    async lookup(owner: ProductOwner, credentials: AssistantCredentials, source: ChartProjectionSource) {
      await dashboards.requireReadable(owner, source);
      const id = chartProjectionId(owner.domainId, source);
      const row = await findCurrentProduct(owner.domainId, "projection", id);
      if (row?.definition.componentId !== METRIC_CHART_COMPONENT) return null;
      await requireProductGrant(id, "use", credentials);
      return id;
    },
    async read(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
      const projection = await requireChartProjection(owner, credentials, id, "use");
      return dashboards.read(owner.domainId, association(projection));
    },
    async edit(owner: ProductOwner, credentials: AssistantCredentials, id: string, content: Parameters<typeof dashboards.edit>[2]) {
      const projection = await requireChartProjection(owner, credentials, id, "edit");
      const updated = await dashboards.edit(owner.domainId, association(projection), content, credentials);
      await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind: "projection", id } });
      return updated;
    },
  };
}

export async function findChartProjectionsForCards(client: PoolClient, domainId: string, dashboardId: string, cardIds: readonly string[]) {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM ${t(currentProductTables.projection)}
     WHERE domain_id=$1 AND definition->>'componentId'=$2
       AND definition#>>'{chartSource,dashboardId}'=$3 AND definition#>>'{chartSource,cardId}'=ANY($4::text[])`,
    [domainId, METRIC_CHART_COMPONENT, dashboardId, cardIds],
  );
  return rows.map(row => row.id);
}

export async function deleteChartProjectionsForDashboards(client: PoolClient, dashboards: readonly { domainId: string; dashboardId: string }[]) {
  await client.query(
    `DELETE FROM ${t(currentProductTables.projection)} AS projection
     USING unnest($1::text[], $2::text[]) AS source(domain_id, dashboard_id)
     WHERE projection.domain_id=source.domain_id AND definition->>'componentId'=$3
       AND definition#>>'{chartSource,dashboardId}'=source.dashboard_id`,
    [dashboards.map(source => source.domainId), dashboards.map(source => source.dashboardId), METRIC_CHART_COMPONENT],
  );
}
