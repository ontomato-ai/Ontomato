import type { ChartProjectionSource } from "@ontomato/contracts/product-panels";
import {
  parseDashboardCardPrimaryKey, type DashboardChartEntry, type DashboardDetail, type DashboardMetricReference,
} from "@ontomato/contracts/dashboard";
import type { PoolClient } from "pg";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { getOwnedDashboard } from "./access";
import { DashboardMetricClient } from "./metric-client";
import { getDashboard, saveDashboard } from "./store";
import { validateDashboardChartDrawing } from "./validation";

type DashboardOwner = { userId: string; domainId: string };
type RegisteredSource = {
  source: ChartProjectionSource;
  dashboardOwnerId: string;
  metricId: string;
};
type Drawing = DashboardChartEntry["chartFile"]["content"];

function findChart(detail: DashboardDetail, cardId: string) {
  return detail.groups.flatMap(group => group.charts).find(card => card.id === cardId);
}

async function ownChart(owner: DashboardOwner, source: ChartProjectionSource, lock?: PoolClient) {
  const detail = await getOwnedDashboard(owner.userId, owner.domainId, source.dashboardId, lock);
  const card = findChart(detail, source.cardId);
  if (!card) throw new HttpError(404, "Dashboard chart card not found", "NOT_FOUND");
  return card;
}

async function registeredChart(domainId: string, association: RegisteredSource, lock?: PoolClient) {
  const { source, dashboardOwnerId, metricId } = association;
  const detail = await getDashboard(dashboardOwnerId, domainId, source.dashboardId, lock);
  if (!detail) throw new HttpError(404, "Chart source dashboard no longer exists", "CHART_SOURCE_UNAVAILABLE");
  const card = findChart(detail, source.cardId);
  if (!card) throw new HttpError(404, "Chart source card no longer exists", "CHART_SOURCE_UNAVAILABLE");
  if (card.query.metricId !== metricId)
    throw new HttpError(409, "Source card no longer uses the projection's MetricView", "CHART_SOURCE_MISMATCH");
  return { detail, card };
}

export const dashboardChartSources = {
  async requireReadable(owner: DashboardOwner, source: ChartProjectionSource) {
    await ownChart(owner, source);
  },
  async forRegistration(owner: DashboardOwner, source: ChartProjectionSource, credentials: AssistantCredentials, client: PoolClient) {
    const card = await ownChart(owner, source, client);
    const metric = await new DashboardMetricClient(owner.domainId, credentials).describe(card.query.metricId);
    return { name: card.name, metricId: card.query.metricId, parameterDefs: metric.parameterDefs };
  },
  async read(domainId: string, association: RegisteredSource) {
    const { card } = await registeredChart(domainId, association);
    return { chartFile: card.chartFile, parameters: card.query.parameters };
  },
  async edit(domainId: string, association: RegisteredSource, content: Drawing, credentials: AssistantCredentials) {
    return transaction(async client => {
      const { detail, card } = await registeredChart(domainId, association, client);
      await validateDashboardChartDrawing(card, content, new DashboardMetricClient(domainId, credentials));
      card.chartFile.content = content;
      await saveDashboard(detail.ownerId, domainId, detail, client);
      return { chartFile: card.chartFile };
    });
  },
};

export function createDashboardCardReadAdapter(owner: DashboardOwner, viewer: AssistantCredentials) {
  const association = (primaryKey: string, metricId: string): RegisteredSource => ({
    source: parseDashboardCardPrimaryKey(primaryKey),
    dashboardOwnerId: owner.userId,
    metricId,
  });

  return {
    chartTemplate(primaryKey: string, metricId: string) {
      return dashboardChartSources.read(owner.domainId, association(primaryKey, metricId));
    },
    async result(primaryKey: string, metricId: string, parameters: DashboardMetricReference["parameters"]) {
      const { card } = await registeredChart(owner.domainId, association(primaryKey, metricId));
      const metric = new DashboardMetricClient(owner.domainId, viewer);
      const { revision } = await metric.describe(metricId);
      return metric.execute({ ...card.query, parameters: { ...card.query.parameters, ...parameters } }, revision);
    },
  };
}
