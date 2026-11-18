---
name: assistant-report
description: Write an evidence-based report and, when requested, turn that report into a PowerPoint presentation.
---

Write the report to outputs/reports/<name>/report.md and link it in the final reply
body. Use ordinary read/write/edit/bash tools. Keep drafts in work/. Explain the
question, observations, calculations, sources, limitations and conclusions. Use
verified dataset files and preserve units and truncation warnings. Embed every
chart and dataset in the report using image syntax: ![title](outputs/...). Do not
put data file paths in inline code or table text. Use the original files and
workspace-relative outputs/ paths under the host's Markdown rule. Do not invent
facts or publish a second report body.

After completing a report, say in one sentence in the final reply, in the user's
language, that the report can be turned into a PPT. Generate PPT only when the
user's message requests it; do not generate one proactively.
When the user requests PPT, read references/presentation.md, read the report and
write a slide list in work/. Run:
`node skills/assistant-report/scripts/render.cjs work/slides.json`
Link outputs/reports/<name>/report.pptx in the final reply body. No publication
command, second model, runtime package installation or network access is needed.
