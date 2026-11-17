import { chartFile as create, main } from "../chart.mjs";
import { assertRegions } from "../regions.mjs";
export const chartFile = (input) => create(input, "admin-choropleth-map", assertRegions);
if (import.meta.main) await main("admin-choropleth-map", assertRegions);
