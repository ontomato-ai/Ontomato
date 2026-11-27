---
name: assistant-report
description: Deliver a requested analysis as an evidence-based report, or turn an existing report into a PowerPoint presentation when explicitly requested.
---

Create a report when explicitly requested or when the analysis assistant's host instructions
define a substantive analysis request as report delivery. Simple questions and explicit chat-only
requests do not need a report. Write the report to outputs/reports/<name>/report.md and link
it in the final reply body. Use ordinary read/write/edit/bash tools. Keep drafts
in work/. Explain the question, observations, calculations, sources, limitations
and conclusions. Use only verified dataset files and charts that support the
report's findings, preserving units and truncation warnings, and embed those
referenced artifacts using image syntax: ![title](outputs/...). Do not embed
unused datasets or charts, and do not put data file paths in inline code or
table text. Use the original files and workspace-relative outputs/ paths under
the host's Markdown rule. Do not invent facts or publish a second report body.

Organize around business questions, not one section per queried field. Start with a short
decision summary: key finding, scope, material limit and useful next action. Follow with only
the relevant size, structure, distribution or comparison sections, then limitations and actions.
Place each supporting table or chart next to its finding. A final evidence appendix may link
additional sources actually used; do not attach every retrieved file. Keep scope, time, units,
denominator and missing coverage beside the affected claim. Separate current populations from
historical archives and people counts from appointment/relationship record counts. Do not infer
age or qualification structure for one population from another. Do not call an assumption-based
possible range a confidence interval, or a suspected field interpretation a proven fact.
Matching a grouped sum to a total establishes reconciliation, not nonmissing values: check
the null/unknown group explicitly before claiming a field is complete. Do not infer completeness
from a metric name or from categories that may omit unknown records.

Return a concise chat summary and the report link, with at most three takeaways and one material
limitation. The report's source references support that summary: do not repeat the full body or
append its dataset cards in chat. Revise the existing report for follow-ups on the same objective,
preserving its sources and correcting superseded claims. PPT remains a separate explicit request.

## Review before delivery

Before linking a finished report, read it back and check the claims that determine its conclusion.
Use `work/report-review.json` as a short working record, not another user-facing deliverable:
`{"report":"outputs/reports/<name>/report.md","scope":"...","claims":[{"claim":"...","sources":["outputs/...dataset.json"],"calculation":"...","finding":"supported|qualified|removed","reason":"..."}],"changes":["..."]}`.
Each numeric headline names its source population, time and denominator. Recompute derived
figures from the actual files with executable arithmetic; record the expression and result.
Check missing values, truncation and duplicate identities before treating a count as people or
using a table for a population-wide share. "supported" describes your review, not an independent
certification. A host `unverified` diagnostic remains unverified.
Do not introduce unsupported statements such as "this is typical of universities" or "all
ratios are distorted". Describe only the observed difference and the specific comparison it
does not support. Recommendations are proposed actions, not proof of a suspected cause.

For a semantic or causal claim, distinguish direct evidence from an assumption or hypothesis.
If evidence is insufficient, qualify or remove that claim rather than marking the whole report
unusable. Never create data, invent comparisons or rerun a query just to make a claim look verified.
Check that source links resolve to real files and that chat and report use the same figures and
limits. The final reply must not call this process a verified audit or proof of correctness.

When a new or revised report is ready and the `present` tool is available, present the report's
outputs/ path so the user sees it beside the conversation, then write the final reply.

## Revise the same objective

Read the existing report and its cited sources before editing. Keep the same report path for the
same objective, including a shorter summary or an added dimension. Record the requested change
and preserved scope in the working review. A wording-only revision uses no new retrieval. A scope
change reuses data only when it can actually select that population; do not relabel all-record
figures as current-active figures. Retrieve only the missing subset or dimension with unchanged
conditions carried forward. Preserve supported sections, replace superseded claims and remove
obsolete or unused source links; never append a contradictory second conclusion.

If a requested addition is unavailable, explain that specific gap and preserve the existing
supported report. In chat link the updated report once and briefly state what changed and any
remaining limitation. Do not regenerate a PPT on a report revision unless requested; a previous
PPT is based on the earlier report and must not be described as updated.

After completing a report, say in one sentence in the final reply, in the user's
language, that the report can be turned into a PPT. Generate PPT only when the
user's message requests it; do not generate one proactively.
When the user requests PPT, read references/presentation.md, read the report and
write a slide list in work/. Run:
`node skills/assistant-report/scripts/render.cjs work/slides.json`
Keep the existing report path; do not create symbolic links or rename the report.
Link the generated `.pptx` next to that report in the final reply body. No publication
command, second model, runtime package installation or network access is needed.
