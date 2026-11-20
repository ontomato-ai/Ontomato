import type { PoolClient } from "pg";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { CHART_SOURCE_IN_USE } from "@ontomato/contracts/product-panels";
import { HttpError } from "../../utils/errors";

interface ChartProjectionReferences {
  find(client: PoolClient, domainId: string, cardKeys: readonly string[]): Promise<string[]>;
  remove(client: PoolClient, cards: readonly { domainId: string; primaryKey: string }[]): Promise<void>;
}

let chartProjections: ChartProjectionReferences;

export function installDashboardChartProjectionReferences(references: ChartProjectionReferences) {
  chartProjections = references;
}

export async function requireUnusedChartSources(client: PoolClient, domainId: string, dashboardId: string, cardIds: readonly string[]) {
  if (!cardIds.length) return;
  const projectionIds = await chartProjections.find(client, domainId,
    cardIds.map(cardId => dashboardCardPrimaryKey({ dashboardId, cardId })));
  if (projectionIds.length)
    throw new HttpError(409, "Chart source is in use", CHART_SOURCE_IN_USE, { projectionIds });
}

export async function deleteChartProjectionsForDashboards(client: PoolClient,
  dashboards: readonly { domainId: string; dashboardId: string; cardIds: readonly string[] }[],
) {
  const cards = dashboards.flatMap(({ domainId, dashboardId, cardIds }) =>
    cardIds.map(cardId => ({ domainId, primaryKey: dashboardCardPrimaryKey({ dashboardId, cardId }) })));
  if (cards.length) await chartProjections.remove(client, cards);
}
