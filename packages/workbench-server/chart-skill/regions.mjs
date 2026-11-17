import { chartMapGeojson } from "@ontomato/contracts/chart-maps";
import { MAP_RESOURCE } from "./chart.mjs";

/** Data region values must be the bundled boundary property's own values; every missing value is reported. */
export async function assertRegions(rows, field, property) {
  const { features } = await chartMapGeojson(MAP_RESOURCE);
  const known = new Set(features.map((feature) => String(feature?.properties?.[property])));
  const missing = [...new Set(rows.map((row) => String(row[field])).filter((name) => !known.has(name)))];
  if (missing.length) throw new Error(`Regions absent from ${MAP_RESOURCE} (${property}): ${missing.join(", ")}`);
}
