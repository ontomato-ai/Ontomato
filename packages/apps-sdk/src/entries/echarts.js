// ECharts, complete: `import * as echarts from "echarts"`. Plain JavaScript because ECharts types its package as a
// UMD namespace (`export =`), which TypeScript cannot re-export with `export *`; the module itself is ESM.
export * from "echarts";
