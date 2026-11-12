---
name: assistant-report
description: Write an evidence-based report and, when requested, turn that report into a PowerPoint presentation.
---

Write the report to outputs/reports/<name>/report.md and link it in the final reply
body. Use ordinary read/write/edit/bash tools. Keep drafts in work/. Explain the
question, observations, calculations, sources, limitations and conclusions. Use
verified dataset files, preserve units and truncation warnings, and reference
original charts/data with workspace-relative outputs/ paths under the host's
Markdown rule. Do not invent facts or publish a second report body.

After completing a report, include “Make into PPT” in the same .follow-ups.json
card as the other suggestions (at most three total). Use the user's language for
label and question; the question must name the actual report, e.g. “Please turn
outputs/reports/sales/report.md into PPT.” Set datasetPaths to [] for this item.
Reference the card in the final reply body using the host's follow-up format.

When the user requests PPT, read references/presentation.md, read the report and
write a slide list in work/. Run:
`node skills/assistant-report/scripts/render.cjs work/slides.json`
Link outputs/reports/<name>/report.pptx in the final reply body. No publication
command, second model, runtime package installation or network access is needed.
