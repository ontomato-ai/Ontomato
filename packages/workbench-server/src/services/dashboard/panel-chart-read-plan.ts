import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { dashboardMetricOutputSchema, type DashboardMetricReference } from "@ontomato/contracts/dashboard";
import { DASHBOARD_CARD, METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { ProductOwner } from "../product-governance/service-authentication";
import { metricResultParameters } from "../metric-function/result-read";
import { requireChartReadRegistration } from "../product-panels/chart-sources";
import type { prepareProjectionDataRead } from "../product-panels/data-reads";
import type { JavaPanelRead } from "../product-panels/java-panel-reads";
import { createDashboardCardReadSource, dashboardCardMetricQuery } from "./chart-sources";
import { requireMatchingOutput } from "./metric-data";
import { prepareDashboardCardMetadataRead } from "./panel-reads";

interface MetricReadPlan {
  call: NonNullable<JavaPanelRead["call"]>;
  present(payload: unknown): unknown;
}

function metricCall({ metricId, parameters }: Pick<DashboardMetricReference, "metricId" | "parameters">): NonNullable<JavaPanelRead["call"]> {
  return { type: METRIC_VIEW, name: "result", parameters: { primaryKey: metricId, parameters } };
}

/** These single-item reads share the metric owner's explicit caller-scoped registrations. */
export async function preparePanelMetricQuery(
  viewer: ProductOwner,
  projection: ProductProjection,
  { selection, params }: Pick<Awaited<ReturnType<typeof prepareProjectionDataRead>>, "selection" | "params">,
  locale?: string,
): Promise<MetricReadPlan | undefined> {
  const { typeId, method, primaryKey } = selection;
  if (typeId === METRIC_VIEW && method === "result") {
    return {
      call: metricCall({ metricId: primaryKey!, parameters: metricResultParameters(runtimeJsonObjectSchema.parse(params)) }),
      present: payload => dashboardMetricOutputSchema.parse(payload),
    };
  }
  if (typeId === DASHBOARD_CARD && (method === "form" || method === "metricSource"))
    return prepareDashboardCardMetadataRead(viewer, primaryKey!, method, params, locale);
  if (typeId !== DASHBOARD_CARD || method !== "result") return;
  const key = primaryKey!;
  const source = createDashboardCardReadSource(viewer);
  const registration = "metricId" in projection && projection.metricId !== undefined
    ? requireChartReadRegistration(projection, key)
    : undefined;
  const parameters = runtimeJsonObjectSchema.parse(params);
  const card = await (registration ? source.registeredCard(key, registration) : source.ownedCard(key));
  return {
    call: metricCall(dashboardCardMetricQuery(card, parameters)),
    present(payload) {
      const output = dashboardMetricOutputSchema.parse(payload);
      if (!registration) requireMatchingOutput(card, output);
      return output;
    },
  };
}

/** The located placement selects the owner read. Java will decide USE before executing its call. */
export async function preparePanelMetricRead(
  viewer: ProductOwner,
  projection: ProductProjection,
  prepared: Awaited<ReturnType<typeof prepareProjectionDataRead>>,
  locale?: string,
): Promise<{ call?: JavaPanelRead["call"]; present(payload: unknown): unknown } | undefined> {
  const { typeId, method, primaryKey } = prepared.selection;
  if (typeId !== DASHBOARD_CARD || method !== "chartTemplate")
    return preparePanelMetricQuery(viewer, projection, prepared, locale);
  const key = primaryKey!;
  const source = createDashboardCardReadSource(viewer);
  const template = "metricId" in projection && projection.metricId !== undefined
    ? await source.chartTemplate(key, requireChartReadRegistration(projection, key))
    : await source.ownedChartTemplate(key);
  return { present: () => template };
}
