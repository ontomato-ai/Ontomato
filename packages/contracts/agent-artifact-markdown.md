# Agent artifact Markdown reference contract

Shared shell contract, approved 2026-10-28; implemented by
[the agent shell](agent-shell.md) in batch 3. Runtime provides files according to
[agent-runtime.md](agent-runtime.md). This contract owns the reference syntax,
its meaning, the chart file format and the shared prompt; the shell renders each
kind by default and hosts may override a renderer.

The host appends the common prompt text owned by contracts
(`src/agent-artifact-markdown-prompt.json`) once to each agent's system prompt,
alongside its business instructions.

The exported ARTIFACT_MARKDOWN_PROMPT constant is the only copy of this rule;
governance, retrieval and the main assistant consume it and do not rewrite it.
This does not restrict standard Markdown references in an external agent.

The shell resolves a closed Markdown destination to the authorized artifact
within the referencing message's run: `(runId, path)` selects that run's version of the file at the end of the run,
or the current version while the run is still running. It then dispatches by
extension: .chart.json → ECharts, .csv/.json → table, .png and other images →
image, .html → sandbox iframe, .md → Markdown. Unknown extensions use a file
card/download. A link's extension chooses content, not inline-versus-side
presentation. Ordinary web links retain their usual role. Renderer bytes come
from the authenticated host proxy, not arbitrary filesystem paths. No custom
Markdown directive or runtime business artifact type is needed.

A .chart.json file follows [the shared chart-data format](chart-data.md). Agents
create it through the echarts, leaflet or admin-choropleth-map skill; drawing
instructions live only in the shared prompt above. The host fills its metric
dataset and applies presentation rules before rendering. Historical plain option
files remain readable but are not reusable chart files.

Rendering rules verified in batch 3: an incomplete streamed reference shows a
placeholder until the parser settles it; artifact components are keyed by run
and path; tables paginate; HTML runs in an iframe with `sandbox="allow-scripts"`
only (no allow-same-origin). Streaming Markdown uses markstream-vue.
