# Chart skills

One source for the `echarts`, `leaflet` and `admin-choropleth-map` skills: each skill's committed
`scripts/index.mjs` is a self-contained runtime package built from `chart.mjs` and its entry. The files
call `legacyChartToFile` and `validateChartFile` from `@ontomato/contracts/chart-data`; they carry no
second chart implementation and no bundled drawing library.

Rebuild all three committed packages after changing the source:

`pnpm --filter @ontomato/workbench-server build:chart-skill`

`scripts/chart-skill.node-test.mjs` fails when a committed package is stale.
