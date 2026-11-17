import { chartFile as create, main } from "../chart.mjs";
export const chartFile = (input) => create(input, "echarts");
if (import.meta.main) await main("echarts");
