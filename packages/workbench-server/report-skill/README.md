# Report presentation build

`render.mjs` owns the helper. Run `pnpm --filter @ontomato/workbench-server build:report-skill`
(or `build:skills`) to generate `resources/runtime-skills/assistant-report/{scripts,vendor,licenses}`.
These generated UTF-8 files are ignored by git and built automatically during Docker image builds,
local dev startup, and tests; neither runtime startup nor a sandbox installs packages or builds code.
PptxGenJS, JSZip, the product Markdown parser and contracts are bundled into CJS.
ECharts is a CJS text asset and resvg WASM is base64 text. Licenses travel with them.

The workbench publisher adds `resources/chart-theme.json` from the installed
edition's existing export theme. The bundle imports `chartBrandColors` from its
contracts owner. No palette is maintained here.

Fonts belong to the agent-runtime image: `fonts-wqy-microhei` and
`fonts-dejavu-core`. The fixed paths are relative to `/usr/share/fonts/truetype`.
For a local sample only, extract the same Debian packages and pass their
`usr/share/fonts/truetype` as `--font-root`. There is one root and no search or
fallback. The generated package needs Node 24, not browser or workbench modules.
