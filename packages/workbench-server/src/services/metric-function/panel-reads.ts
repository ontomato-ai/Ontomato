import type { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { dashboardMetricDescriptionSchema, dashboardMetricOutputSchema, type DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import type { ProductOwner } from "../product-governance/grants";

/*
 * The metric owner's named reads for a panel. `result` runs one selected metric as the reader and answers its output:
 * the metric's declared columns, its rows, and the truncation that marks a partial result. The owner's query surface
 * judges everything: whether the reader may run the metric, the reader's data permissions, and the parameter values
 * against the metric's current definition. A metric runs at the revision its description names, so a definition changed
 * between the two calls is the owner's conflict rather than rows of another definition.
 */

/** The values of a result read, each named by the metric's own parameter it fills. */
export type MetricResultParams = Readonly<Record<string, RuntimeJsonValue>>;

/**
 * An object chosen in a panel fills a metric parameter with its primary key, and a checked list of objects with their
 * keys in order; any other value goes as it is.
 */
function parameterValue(value: RuntimeJsonValue): RuntimeJsonValue {
  if (Array.isArray(value)) return value.map(parameterValue);
  const object = panelObjectRefSchema.safeParse(value);
  return object.success ? object.data.primaryKey : value;
}

export function createMetricReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  // A failed run is the owner's answer, not a transport fault worth running the query again for.
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  async function post<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await backendPost(name, base + path, body, options);
    return schema.parse(JSON.parse(response.text));
  }
  return {
    async result(primaryKey: string, params: MetricResultParams): Promise<DashboardMetricOutput> {
      const { revision } = await post(
        "metric-describe", "/ontology/query/metrics/describe", { id: primaryKey }, dashboardMetricDescriptionSchema,
      );
      const parameters = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, parameterValue(value)]));
      return post(
        "metric-execute", "/ontology/query/metrics/execute", { id: primaryKey, revision, parameters }, dashboardMetricOutputSchema,
      );
    },
  };
}
