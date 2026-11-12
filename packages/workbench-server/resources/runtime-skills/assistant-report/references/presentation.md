# Make the report into a presentation

Read the actual report before choosing the slide arguments. Keep the conclusions
and limitations faithful to it. Carry its conclusions, charts and tables into the
deck, splitting slides when needed. Write a JSON slide list in `work/slides.json`;
this is a plan for the deterministic helper, not another report or data store.
Use one point per slide. Text is plain text, not arbitrary Markdown or HTML.
Every chart and dataset embedded in the report must appear in the PPT; the helper
rejects the slide list if any are missing.

```json
{
  "report": "outputs/reports/sales/report.md",
  "title": "Sales review",
  "slides": [
    {"layout":"text","title":"Growth is concentrated in one region","bullets":["Use the report's verified finding.","Retain its scope and limitations."]},
    {"layout":"chart","title":"Compare regional sales","takeaway":"State the report's conclusion.","chart":"outputs/sales.chart.json"},
    {"layout":"table","title":"Verified regional figures","dataset":"outputs/sales.dataset.json"}
  ]
}
```

`title` and `layout` are required for each slide; `takeaway` is optional.
Text slides have `bullets`; chart slides name one `.chart.json`; table slides name
one original `.dataset.json`. The paths must already be referenced by the report
and are relative to the workspace, not the report directory. Do not transcribe
data values into this list, query again or copy a browser's filtered table state.
The helper reads the original ECharts option and dataset columns/rows. Column
labels carry the source units; do not remove or rewrite them. Values including
zero, false and null are retained. Full tables paginate automatically with their
column headings and source/truncation notes repeated. For a deliberate summary,
set `range: [start, end]` (zero-based, end exclusive) and a user-language `summary`
describing the selected scope. The helper labels the exact range and total row
count. Never silently drop rows or omit the dataset's truncation warning.

```sh
node skills/assistant-report/scripts/render.cjs work/slides.json
```

This writes `outputs/reports/<name>/report.pptx`, next to the report. Intermediate
plans stay in `work/`; the installed skill directory is read-only. Return a link
to the actual PPTX in the final reply body. The helper uses bundled ECharts SVG
SSR with animation disabled, then resvg WASM to render PNG for PptxGenJS. It does
not embed SVG. A broken chart, invalid source or missing font is an error to fix.
It depends on the runtime image's WenQuanYi Micro Hei and DejaVu Sans fonts
(`fonts-wqy-microhei`, `fonts-dejavu-core`); no packages are installed at runtime.

The host publishes its edition's chart theme with the package; chart brand rules
come from contracts. Do not invent or replace the platform palette. For Arabic
labels use `fontFamily: "DejaVu Sans"` in the chart's applicable label/text style;
Chinese labels use `WenQuanYi Micro Hei`.
