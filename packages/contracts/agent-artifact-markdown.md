# Agent artifact Markdown reference contract

Shared shell contract, approved 2026-10-28 from the approved artifact reference
convention. Runtime provides files according to [agent-runtime.md](agent-runtime.md).
This batch establishes the reference and shared prompt owner; batch 3 implements
the Vue shell, parser integration and renderers. No browser implementation is
claimed here.

The host appends the common prompt text owned by contracts once to each agent's
system prompt, alongside its business instructions:

> Reference produced files with workspace-relative outputs/ paths. Use Markdown
> image syntax ![title](outputs/path) for inline content and Markdown link syntax
> [title](outputs/path) for a file card opened in the side panel. Choose one form
> for each intended presentation. Do not embed full dataset contents in the reply.

The exported ARTIFACT_MARKDOWN_PROMPT constant is consumed by governance and
retrieval; the later main assistant will use the same owner. Hosts do not independently rewrite the rule. The contract owns
syntax/meaning; each shell host owns concrete renderers. This does not restrict
standard Markdown references in an external agent.

The shell resolves a closed Markdown destination to the authorized artifact at
the message's run boundary (the final version when stopped, or current version while running), then dispatches by extension: .chart.json →
ECharts, .csv/.json → table, .png → image, .html → sandbox iframe, .md → Markdown.
Unknown extensions use a file card/download. A link's extension chooses content,
not inline-versus-side presentation. Ordinary web links retain their usual role.
Renderer URLs come from the authenticated host proxy, not arbitrary filesystem
paths. No custom Markdown directive or runtime business artifact type is needed.

Batch 3 must verify incomplete streamed nodes before choosing a renderer, stable
component identity by resolved path/artifact, table pagination and HTML iframe
sandboxing with allow-scripts only (no allow-same-origin). The approved research
candidate is markstream-vue; a small streaming-node PoC precedes adoption. These
are batch 3 acceptance items, not extra work in this harness replacement.
