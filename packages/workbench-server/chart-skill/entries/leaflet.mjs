import { chartFile as create, main } from "../chart.mjs";
export const chartFile = (input) => create(input, "leaflet");
if (import.meta.main) await main("leaflet");
