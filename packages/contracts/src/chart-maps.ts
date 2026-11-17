import { chartMapResources } from "./chart-data/maps";

/**
 * Each bundled map resource's boundaries, by the resource names conversion and registration share. A resource's file is
 * loaded only when a chart draws that map: the boundaries are hundreds of kilobytes, so no page ships them for nothing.
 */
const files: Record<string, () => Promise<{ default: unknown }>> = {
  "china-provinces": () => import("../chart-maps/china-provinces.json"),
};

/**
 * A map resource's bundled boundaries. A resource that is not bundled has no stand-in: drawing it fails with the
 * resource name rather than fetching, caching or falling back to another map.
 */
export function chartMapGeojson(resource: string): Promise<unknown> {
  const load = Object.hasOwn(chartMapResources, resource) ? files[resource] : undefined;
  if (!load) return Promise.reject(new Error(`Map resource is not bundled: ${resource}`));
  return load().then((module) => module.default);
}
