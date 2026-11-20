import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { chartProjectionTemplateSchema, dashboardMetricDescriptionSchema, dashboardMetricOutputSchema } from "@ontomato/contracts/dashboard";
import { panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { chartProjectionSourcePath } from "@ontomato/contracts/panel-client-requests";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

/*
 * A source card's chart reads in a panel's frame, for the registered chart projection the frame read (M2 design 2.1):
 * the drawing is the card's chart file and its saved parameters, handed over by the dashboard owner for this
 * projection; the output is the projection's MetricView, run as the reader at the revision its description names, with
 * the values this panel binds laid over the card's parameters. On the platform's own read the card's owner answers the
 * same two reads; here the frame asks the owners directly, until every caller reads through the platform (design 4.2,
 * step 4). Nothing is cached, kept or written back.
 */

/**
 * A bound value as a MetricView parameter takes it: an object by its primary key, a checked list by its keys in order,
 * anything else as it is.
 */
function parameterValue(value: RuntimeJsonValue): RuntimeJsonValue {
  if (Array.isArray(value)) return value.map(parameterValue);
  const object = panelObjectRefSchema.safeParse(value);
  return object.success ? object.data.primaryKey : value;
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const dashboardCardAdapters: PlatformObjectAdapterFactory = (requests) => {
  const body = async (response: Promise<Response>): Promise<unknown> => (await response).json();
  const template = async (chart: { id: string }) =>
    chartProjectionTemplateSchema.parse(await body(requests.request(chartProjectionSourcePath(chart.id), {}, "")));
  return [{
    objectType: DASHBOARD_CARD,
    metric: {
      template,
      async result(chart, parameters) {
        const [card, description] = await Promise.all([
          template(chart),
          body(requests.request("/ontology/query/metrics/describe", json({ id: chart.metricId }), "/data-query"))
            .then((answer) => dashboardMetricDescriptionSchema.parse(answer)),
        ]);
        // An input with no value leaves the card's own parameter.
        const bound = Object.entries(parameters).filter(([, value]) => value !== null);
        const merged = { ...card.parameters, ...Object.fromEntries(bound.map(([name, value]) => [name, parameterValue(value)])) };
        return dashboardMetricOutputSchema.parse(await body(requests.request("/ontology/query/metrics/execute",
          json({ id: chart.metricId, revision: description.revision, parameters: merged }), "/data-query")));
      },
    },
  }];
};
