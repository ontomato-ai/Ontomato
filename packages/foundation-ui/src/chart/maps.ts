import { registerMap } from "echarts/core";
import { chartMapGeojson } from "@ontomato/contracts/chart-maps";

/**
 * The map resources the page has registered. ECharts keeps a registered map for the page's lifetime, so this records
 * the same fact once rather than caching boundaries of its own.
 */
const registered = new Map<string, Promise<void>>();

/**
 * Registers the bundled boundaries of every map the option draws, once per resource per page. The boundaries are
 * several hundred kilobytes and only a chart that draws a map needs them, so each resource is fetched on first use
 * instead of being shipped with every page. A resource the platform does not bundle fails here with its name rather
 * than being fetched from elsewhere, cached or replaced by another map.
 */
export function registerChartMaps(option: Record<string, any>): Promise<void> | null {
  const names = [
    ...([option.geo].flat().map((geo) => geo?.map)),
    ...([option.series].flat().map((series) => series?.map)),
  ].filter((name): name is string => typeof name === "string");
  const pending = names.map((name) => {
    if (!registered.has(name)) registered.set(name, chartMapGeojson(name).then((geojson) => { registerMap(name, geojson as any); }));
    return registered.get(name)!;
  });
  return pending.length ? Promise.all(pending).then(() => undefined) : null;
}
