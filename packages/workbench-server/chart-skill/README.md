# Chart skills

One source for the `echarts`, `leaflet` and `admin-choropleth-map` skills: each skill's generated
`scripts/index.mjs` is a self-contained runtime package built from `chart.mjs` and its entry. The files
call `legacyChartToFile`, `validateChartFile` and `fillChartFile` from `@ontomato/contracts/chart-data`;
they carry no second chart implementation and no bundled drawing library.

The choropleth package also bundles the platform's `china-provinces` boundary resource and its
provenance under `licenses/`, because it checks every region name before writing a file. The other two
packages do not carry boundaries.

Generated outputs under `skills/executable/visualization/{echarts,leaflet,admin-choropleth-map}/{scripts,licenses}`
are ignored by git and built automatically during Docker image builds, local dev startup, and tests:

`pnpm --filter @ontomato/workbench-server build:chart-skill`
