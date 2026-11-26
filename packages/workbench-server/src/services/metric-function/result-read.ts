import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";

/** A selected object fills a metric parameter with its primary key, and a list keeps the order of its values. */
export function metricResultParameters(params: Readonly<Record<string, RuntimeJsonValue>>) {
  function parameterValue(value: RuntimeJsonValue): RuntimeJsonValue {
    if (Array.isArray(value)) return value.map(parameterValue);
    const object = panelObjectRefSchema.safeParse(value);
    return object.success ? object.data.primaryKey : value;
  }
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name, parameterValue(value)]));
}
