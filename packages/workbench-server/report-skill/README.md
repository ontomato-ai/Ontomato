# Report presentation build

`render.mjs` owns the helper. After changing it or its pinned build dependencies,
run `pnpm --filter @ontomato/workbench-server build:report-skill` and commit the
generated `resources/runtime-skills/assistant-report/{scripts,vendor,licenses}`
with the source, as with the shared analyst client's standalone distributions.
These committed UTF-8 files go through the existing skill publisher and image
resource copy; neither startup nor a sandbox installs packages or builds code.
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
