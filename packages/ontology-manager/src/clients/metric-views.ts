import type { InjectionKey } from "vue";
import type { ManagerRequest } from "../api";

/** One read of a published MetricView. */
export interface MetricViewRead {
  id: string;
  /** Merged over the defaults the MetricView's own definition declares. */
  parameters: Record<string, unknown>;
}

/**
 * Reads published MetricViews, the only read entry for business data. The Manager's object views and the apps built on
 * the SDK use this one client, each over its own request layer.
 */
export function createMetricViewsClient(request: Pick<ManagerRequest, "post" | "text">) {
  async function read(input: MetricViewRead) {
    const definition = await request.post("/metricView/queryById", { id: input.id });
    const parameters = definition.data?.function?.queryPackage?.manifest?.parameterDefs
      ?? definition.data?.function?.parameters ?? [];
    const defaults = Object.fromEntries(parameters
      .filter((parameter: { name: string; value?: unknown }) => Object.hasOwn(parameter, "value") && parameter.value !== null)
      .map((parameter: { name: string; value: unknown }) => [parameter.name, parameter.value]));
    const response = await request.post("/metricView/execute", { id: input.id, param: { ...defaults, ...input.parameters } });
    if (response.truncated === true || response.partial === true || response.complete === false)
      throw new Error(response.truncationHint || request.text("ovIncompleteResults"));
    return response.data;
  }

  return { read };
}

export type MetricViewsClient = ReturnType<typeof createMetricViewsClient>;

/** Where a page provides the client to the components that bind a MetricView by property. */
export const metricViewsKey: InjectionKey<MetricViewsClient> = Symbol("metric-views");
